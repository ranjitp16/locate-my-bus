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
#include <unordered_set>

using namespace std;
using namespace transit_realtime;

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

stringstream downloadFile(
	string url_path,
	string api_key_for_header
){

	CURL* curl;
	CURLcode res;
	stringstream result;

	curl_global_init(CURL_GLOBAL_DEFAULT);
	curl = curl_easy_init();
	
	if(curl){
		
		if(!api_key_for_header.empty()){
			struct curl_slist* headers = nullptr;
			headers = curl_slist_append(headers, ("apikey: " + api_key_for_header).c_str());
			curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
		}

		curl_easy_setopt(curl, CURLOPT_URL, url_path.c_str());
		curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
		curl_easy_setopt(curl, CURLOPT_WRITEDATA, &result);

		auto startTime = chrono::duration_cast<chrono::microseconds>(
      	chrono::system_clock::now().time_since_epoch()
  		).count();
		cout << "start Downloading the vehicle Position: " << startTime <<endl; 

		res = curl_easy_perform(curl);

		auto endTime = chrono::duration_cast<chrono::microseconds>(
      	chrono::system_clock::now().time_since_epoch()
  		).count();

		cout << "end Downloading the vehicle Position: " << endTime << endl; 

		cout<< "Download took " << endTime - startTime << " microsecond" <<endl;

		if(res != CURLE_OK){
			cerr << "Err downloading the file" << curl_easy_strerror(res) << endl;
			throw runtime_error("Error downloading the file: " + string(curl_easy_strerror(res)));
		}
		curl_easy_cleanup(curl);
	}

	curl_global_cleanup();

	return result;
}



int mainLogic(int argc, char* args[], pqxx::connection* conn){

	vector<pair<string, pair<string,string>>> agencies; // <uuid, <rt_feed_url, api_key>>
	try
	{
		// try fetching agencies from database
		{
			pqxx::nontransaction ntxn(*conn);
			auto result = ntxn.exec("SELECT * FROM public.agency ORDER BY rt_feed_url");
			for (const auto& row : result) {
				pair<string, string> url_and_api_pair = 
					make_pair(
						row["rt_feed_url"].as<string>(), 
						row["api_key_in_header"].as<string>("")
					);

				agencies.emplace_back(
					row["id"].as<string>(),
					url_and_api_pair
				);
			}
		} // ntxn destroyed here, conn is clean
		cout << "Fetched " << agencies.size() << " " << "agencies from the database, initiating fetch-n-parse" << endl;
	}
	catch(const std::exception& e)
	{
		std::cerr << e.what() << '\n';
	}
	

	// Add an identifier to see if the we can re-use the already existing stream, as many angencies share the rt_feed.
	stringstream ss;
	FeedMessage feed;
	string last_rt_feed_url = "";
	string last_agency = "";

	// itterate over agencies and fetch rt feed to parse and upserts the feed
    for (const auto& [agency_id, rt_feed_url_and_api_pair] : agencies) {
		auto startTime = chrono::duration_cast<chrono::microseconds>(
			chrono::system_clock::now().time_since_epoch()
		).count();
		
		string rt_feed_url = rt_feed_url_and_api_pair.first;
		string api_key = rt_feed_url_and_api_pair.second;
		
		cout << "Program start time: " << startTime << " rt_feed: " << rt_feed_url << ", api_key(if any): " << api_key  << endl;
		
		
		try {
			
			if(rt_feed_url != last_rt_feed_url){
				cout << "fetching : " << rt_feed_url<<endl; 
				last_rt_feed_url = rt_feed_url;
				last_agency = agency_id;
				ss = downloadFile(
					!rt_feed_url.empty() ? rt_feed_url : throw invalid_argument("rt_feed_url can not be null"),
					api_key // empty handled in the method;
				);
				if (!feed.ParseFromIstream(&ss)) {
					throw runtime_error("Failed to parse feed message.");
				}
			}
			else {
				cout << "Re-using feed from : " << last_agency << endl;
			}
			
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

			// Start a transaction
			pqxx::work txn(*conn);

			auto busRoutes = txn.exec_params("SELECT id FROM public.route WHERE agency_id = $1", agency_id);

			for (const auto& row : busRoutes) {
				busRoutesInThisAgency.emplace(row["id"].as<string>());
			}

			auto busTrips = txn.exec_params("SELECT id FROM public.trip WHERE agency_id = $1", agency_id);

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

					// filter out records where the route or trip are not in the db
					if (route_id.empty() || busRoutesInThisAgency.find(route_id) == busRoutesInThisAgency.end())
						continue;
					if (trip_id.empty() || busTripsInThisAgency.find(trip_id) == busTripsInThisAgency.end())
						continue;
					if (!insertV.empty()) insertV += ", ";

					insertV += "('" + generate_uuid_v4() + "',"
						+ "'" + agency_id + "',"
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
				txn.exec_params("DELETE FROM public.live_vehicle_position WHERE agency_id = $1", agency_id);
				pqxx::result rows = txn.exec(insertQ + insertV +";");
			}

			txn.commit();
			
		} catch (const exception& e) {
			cerr << "Error while fetching and parsing the protobuf: " << e.what() << "\n";
			return 1;
		} 
		
			
			
			auto endTime = chrono::duration_cast<chrono::microseconds>(
			chrono::system_clock::now().time_since_epoch()
			).count();
	
			cout << "Program End time: " << endTime << " | Time to execute " << endTime - startTime <<endl;  
		
	}
	return 0;
}


int main(int argc, char* args[]){

	auto e = [](const char* v) { return v ? v : throw invalid_argument("essential env vars not set"); };

	string PG_HOST = e(getenv("POSTGRES_HOST"));
	string PG_USER = e(getenv("POSTGRES_USER"));
	string PG_PASSWD = e(getenv("POSTGRES_PASSWORD"));
	string PG_DB = e(getenv("POSTGRES_DB"));

	// Connection string
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

	int i = 0 ;
	while(true){
		cout<< "Itteration: " << i++ << endl;
		mainLogic(argc, args, &conn);
		this_thread::sleep_for(chrono::seconds(15));
		cout << "========================================" << endl;
	}
	
}
