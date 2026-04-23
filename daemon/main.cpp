#pragma once
#include <iostream>
#include <cstdlib>
#include "assets/transit_realtime.pb.h"
#include <fstream>
#include <curl/curl.h>
#include <random>
#include <sstream>
#include <iomanip>
#include <pqxx/pqxx>
#include <chrono>
#include <format>
#include <thread>
#include <future>
#include <unordered_set>
#include <unordered_map>
#include <optional>
#include <atomic>
#include <csignal>

using namespace std;
using namespace transit_realtime;

static atomic<bool> g_running{true};
static void handle_signal(int) { g_running = false; }

const string url_path = "https://gtfs.halifax.ca/realtime/Vehicle/VehiclePositions.pb";
const string fileName = "./daemon/assets/VehiclePositions.pb";

size_t write_data(void* ptr, size_t size, size_t nmemb, void* stream) {
    stringstream* out = static_cast<stringstream*>(stream);
    out->write(static_cast<char*>(ptr), size * nmemb);
    return size * nmemb;
}

inline string generate_uuid_v4() {
      random_device rd;
      mt19937 gen(rd());
      uniform_int_distribution<uint32_t> dis(0, 0xFFFFFFFF);

      auto r1 = dis(gen), r2 = dis(gen), r3 = dis(gen), r4 = dis(gen);

      // Set version 4 and variant bits
      r2 = (r2 & 0xFFFF0FFF) | 0x00004000;
      r3 = (r3 & 0x3FFFFFFF) | 0x80000000;

      ostringstream ss;
      ss << hex << setfill('0')
         << setw(8) << r1 << '-'
         << setw(4) << (r2 >> 16) << '-'
         << setw(4) << (r2 & 0xFFFF) << '-'
         << setw(4) << (r3 >> 16) << '-'
         << setw(4) << (r3 & 0xFFFF)
         << setw(8) << r4;
      return ss.str();
}

// curl_global_init/cleanup must be called once from main() for thread safety.
// Each call here uses its own CURL handle so concurrent calls are safe.
stringstream downloadFile(
	const string& url_path,
	const string& api_key_for_header,
	int64_t& out_download_time_us
){
	CURL* curl;
	CURLcode res;
	stringstream result;

	curl = curl_easy_init();
	if (!curl) {
		throw runtime_error("curl_easy_init() failed");
	}

	struct curl_slist* headers = nullptr;
	if(!api_key_for_header.empty()){
		headers = curl_slist_append(headers, ("apikey: " + api_key_for_header).c_str());
		curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
	}

	curl_easy_setopt(curl, CURLOPT_URL, url_path.c_str());
	curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
	curl_easy_setopt(curl, CURLOPT_WRITEDATA, &result);

	auto dl_start = chrono::duration_cast<chrono::microseconds>(
		chrono::system_clock::now().time_since_epoch()
	).count();

	res = curl_easy_perform(curl);

	auto dl_end = chrono::duration_cast<chrono::microseconds>(
		chrono::system_clock::now().time_since_epoch()
	).count();

	out_download_time_us = dl_end - dl_start;

	curl_slist_free_all(headers);

	if(res != CURLE_OK){
		cerr << "Err downloading the file: " << curl_easy_strerror(res) << endl;
		curl_easy_cleanup(curl);
		throw runtime_error("Error downloading the file: " + string(curl_easy_strerror(res)));
	}
	curl_easy_cleanup(curl);

	return result;
}

struct DownloadResult {
	FeedMessage feed;
	int64_t download_time_us;
};

// Downloads and parses a single GTFS-RT feed. Intended to run on a worker thread.
DownloadResult downloadAndParse(const string& url, const string& api_key) {
	int64_t dt = 0;
	stringstream ss = downloadFile(url, api_key, dt);
	FeedMessage feed;
	if (!feed.ParseFromIstream(&ss)) {
		throw runtime_error("Failed to parse feed message from: " + url);
	}
	return {move(feed), dt};
}

struct AgencyInfo {
	string id;
	string rt_feed_url;
	string api_key;
};

struct FeedExecutionRecord {
	string agency_id;
	bool is_cache_hit;
	int64_t program_start_us;
	int64_t program_end_us;
	optional<int64_t> download_time_us;
	string status;
	optional<string> error_message;
};

int mainLogic(int argc, char* args[], pqxx::connection* conn){

	// 1. Fetch all agencies from the database
	vector<AgencyInfo> agencies;
	try {
		pqxx::nontransaction ntxn(*conn);
		auto result = ntxn.exec("SELECT * FROM public.agency ORDER BY rt_feed_url");
		for (const auto& row : result) {
			agencies.push_back({
				row["id"].as<string>(),
				row["rt_feed_url"].as<string>(),
				row["api_key_in_header"].as<string>("")
			});
		}
	} catch (const exception& e) {
		cerr << "Error fetching agencies: " << e.what() << '\n';
		return 1;
	}

	// 2. Insert poll_iteration row and get back its generated id
	int64_t poll_iteration_id = -1;
	try {
		pqxx::work pi_txn(*conn);
		auto pi_result = pi_txn.exec_params(
			"INSERT INTO public.poll_iteration (started_at, agency_count, total_executions) "
			"VALUES (NOW(), $1, $2) RETURNING id",
			(int)agencies.size(),
			(int)agencies.size()
		);
		poll_iteration_id = pi_result[0][0].as<int64_t>();
		pi_txn.commit();
	} catch (const exception& e) {
		cerr << "Error inserting poll_iteration: " << e.what() << "\n";
		return 1;
	}

	// 3. Collect unique rt_feed_urls, tracking which agency owns each.
	//    feedOwner maps url -> agency_id of the first (non-cache-hit) agency.
	vector<pair<string, string>> uniqueFeeds; // (url, api_key)
	unordered_map<string, string> feedOwner;  // url -> agency_id
	for (const auto& agency : agencies) {
		if (feedOwner.find(agency.rt_feed_url) == feedOwner.end()) {
			feedOwner[agency.rt_feed_url] = agency.id;
			uniqueFeeds.emplace_back(agency.rt_feed_url, agency.api_key);
			cout << "fetching : " << agency.rt_feed_url << endl;
		} else {
			cout << "Re-using feed from : " << feedOwner[agency.rt_feed_url] << endl;
		}
	}

	// 4. Resolve downloads in bounded batches before the per-agency DB loop.
	//    Batch size is capped at hardware_concurrency() to avoid unbounded threads.
	unordered_map<string, DownloadResult> feeds;
	size_t maxConcurrent = thread::hardware_concurrency();
	if (maxConcurrent == 0) maxConcurrent = 4;

	for (size_t batchStart = 0; batchStart < uniqueFeeds.size(); batchStart += maxConcurrent) {
		size_t batchEnd = min(batchStart + maxConcurrent, uniqueFeeds.size());
		unordered_map<string, future<DownloadResult>> feedFutures;
		for (size_t i = batchStart; i < batchEnd; ++i) {
			const string& url     = uniqueFeeds[i].first;
			const string& api_key = uniqueFeeds[i].second;
			feedFutures.emplace(url, async(launch::async, downloadAndParse, url, api_key));
		}
		for (auto& [url, fut] : feedFutures) {
			try {
				feeds.emplace(url, fut.get());
			} catch (const exception& e) {
				cerr << "Error downloading/parsing feed " << url << ": " << e.what() << "\n";
				// URL absent from feeds; agencies using it will record an error below
			}
		}
	}

	// 5. Process DB writes for each agency using its resolved feed
	vector<FeedExecutionRecord> feed_executions;
	feed_executions.reserve(agencies.size());

	for (const auto& agency : agencies) {
		auto startTime = chrono::duration_cast<chrono::microseconds>(
			chrono::system_clock::now().time_since_epoch()
		).count();

		bool is_cache_hit = (feedOwner[agency.rt_feed_url] != agency.id);
		string status = "success";
		string error_message = "";

		auto it = feeds.find(agency.rt_feed_url);
		if (it == feeds.end()) {
			auto endTime = chrono::duration_cast<chrono::microseconds>(
				chrono::system_clock::now().time_since_epoch()
			).count();
			feed_executions.push_back({agency.id, is_cache_hit, startTime, endTime, nullopt, "error", string("feed unavailable")});
			continue;
		}

		const FeedMessage& feed = it->second.feed;
		optional<int64_t> dl_time = is_cache_hit ? nullopt : optional<int64_t>(it->second.download_time_us);

		try {
			string insertQ = "INSERT INTO public.live_vehicle_position(id, agency_id, route_id, route_short_name, lon, lat, vehicle_id, \"timestamp\", vehicle_distance_traveled, speed, head_bearing, trip_id) VALUES ";
			string insertV = "";

			map<string, FeedEntity> vehicles;
			for (int i = 0; i < feed.entity_size(); i++) {
				FeedEntity entity = feed.entity(i);
				if (entity.has_vehicle()) {
					string vid = entity.vehicle().vehicle().id();
					vehicles[vid] = entity;
				}
			}

			unordered_set<string> busRoutesInThisAgency;
			unordered_set<string> busTripsInThisAgency;

			pqxx::work txn(*conn);

			auto busRoutes = txn.exec_params("SELECT id FROM public.route WHERE agency_id = $1", agency.id);
			for (const auto& row : busRoutes) {
				busRoutesInThisAgency.emplace(row["id"].as<string>());
			}

			auto busTrips = txn.exec_params("SELECT id FROM public.trip WHERE agency_id = $1", agency.id);
			for (const auto& row : busTrips) {
				busTripsInThisAgency.emplace(row["id"].as<string>());
			}

			for (const auto& [vid, entity] : vehicles) {
				if (entity.has_vehicle()) {

					long ts = chrono::duration_cast<chrono::seconds>(chrono::system_clock::now().time_since_epoch()).count();

					string route_id = entity.vehicle().trip().route_id();
					string lat = to_string(entity.vehicle().position().latitude());
					string lon = to_string(entity.vehicle().position().longitude());
					string vehicle_id = entity.vehicle().vehicle().id();
					string odometry = to_string(entity.vehicle().position().odometer());
					string speed = to_string(entity.vehicle().position().speed());
					string bearing = to_string(entity.vehicle().position().bearing());
					string trip_id = entity.vehicle().trip().trip_id();

					if (route_id.empty() || busRoutesInThisAgency.find(route_id) == busRoutesInThisAgency.end())
						continue;
					if (trip_id.empty() || busTripsInThisAgency.find(trip_id) == busTripsInThisAgency.end())
						continue;
					if (!insertV.empty()) insertV += ", ";

					insertV += "('" + generate_uuid_v4() + "',"
						+ "'" + agency.id + "',"
						+ "'" + route_id + "',"
						+ "'" + route_id + "',"
						+ lon + ","
						+ lat + ","
						+ "'" + vehicle_id + "',"
						+ "TO_TIMESTAMP(" + to_string(ts) + "),"
						+ odometry + ","
						+ speed + ","
						+ bearing + ","
						+ "'" + trip_id + "')";
				}
			}

			if(!insertV.empty())
			{
				txn.exec_params("DELETE FROM public.live_vehicle_position WHERE agency_id = $1", agency.id);
				txn.exec(insertQ + insertV + ";");
			}

			txn.commit();

		} catch (const exception& e) {
			cerr << "Error processing agency " << agency.id << ": " << e.what() << "\n";
			status = "error";
			error_message = e.what();
		}

		auto endTime = chrono::duration_cast<chrono::microseconds>(
			chrono::system_clock::now().time_since_epoch()
		).count();

		feed_executions.push_back({
			agency.id,
			is_cache_hit,
			startTime,
			endTime,
			dl_time,
			status,
			error_message.empty() ? nullopt : optional<string>(error_message)
		});
	}

	// 6. Single batch insert for all feed_execution rows
	try {
		pqxx::work fe_txn(*conn);
		auto stream = pqxx::stream_to::table(
			fe_txn,
			{"public", "feed_execution"},
			{"id", "poll_iteration_id", "agency_id", "is_cache_hit", "program_start_us", "program_end_us", "download_time_us", "status", "error_message"}
		);
		int64_t fe_id = 1;
		for (const auto& fe : feed_executions) {
			stream.write_row(make_tuple(fe_id++, poll_iteration_id, fe.agency_id, fe.is_cache_hit, fe.program_start_us, fe.program_end_us, fe.download_time_us, fe.status, fe.error_message));
		}
		stream.complete();
		fe_txn.commit();
	} catch (const exception& e) {
		cerr << "Error batch inserting feed_executions: " << e.what() << "\n";
	}

	return 0;
}


void attemptWeeklyRefresh(const string& web_host, const string& access_key) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        cerr << "[refresh] curl_easy_init() failed\n";
        return;
    }

    string url = "http://" + web_host + ":3000/api/agencies/refresh";
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("x-access-key: " + access_key).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    stringstream response;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, "");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 300L); // 5 min timeout for full re-onboard

    CURLcode res = curl_easy_perform(curl);
    if (res == CURLE_OK) {
        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        cout << "[refresh] Weekly refresh completed. HTTP " << http_code
             << " Response: " << response.str() << "\n";
    } else {
        cerr << "[refresh] Weekly refresh failed: " << curl_easy_strerror(res) << "\n";
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
}

int main(int argc, char* args[]){

	auto e = [](const char* v) { return v ? v : throw invalid_argument("essential env vars not set"); };

	string PG_HOST = e(getenv("POSTGRES_HOST"));
	string PG_USER = e(getenv("POSTGRES_USER"));
	string PG_PASSWD = e(getenv("POSTGRES_PASSWORD"));
	string PG_DB = e(getenv("POSTGRES_DB"));

	pqxx::connection conn(
		"host=" + PG_HOST + " "
		"port=5432 "
		"dbname=" + PG_DB + " "
		"user=" + PG_USER + " "
		"password=" + PG_PASSWD + " "
	);

	if (conn.is_open()) {
		cout << "Connected to: " << conn.dbname() << "\n";
	}

	signal(SIGTERM, handle_signal);
	signal(SIGINT,  handle_signal);

	curl_global_init(CURL_GLOBAL_DEFAULT);

	// Weekly refresh state
	auto last_refresh = chrono::system_clock::now();
	string web_host = PG_HOST; // In devcontainer, web and daemon share the same docker network
	// Override with WEB_HOST env var if set
	const char* web_host_env = getenv("WEB_HOST");
	if (web_host_env) web_host = web_host_env;
	string access_key = getenv("DELETE_ACCESS_KEY") ? getenv("DELETE_ACCESS_KEY") : "";

	while(g_running){
		// Check for weekly refresh: 7 days elapsed AND current UTC hour is 08 (4 AM AST)
		{
			auto now = chrono::system_clock::now();
			auto elapsed = chrono::duration_cast<chrono::hours>(now - last_refresh).count();
			time_t now_t = chrono::system_clock::to_time_t(now);
			struct tm utc_tm;
			gmtime_r(&now_t, &utc_tm);

			if (elapsed >= 168 && utc_tm.tm_hour == 8) { // 168 hours = 7 days
				cout << "[refresh] Weekly refresh triggered at UTC hour " << utc_tm.tm_hour << "\n";
				attemptWeeklyRefresh(web_host, access_key);
				last_refresh = now; // Update regardless of success/failure
			}
		}

		mainLogic(argc, args, &conn);
		this_thread::sleep_for(chrono::seconds(15));
	}

	curl_global_cleanup();
}
