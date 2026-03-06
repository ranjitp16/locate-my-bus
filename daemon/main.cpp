#pragma once
#include <iostream>
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
	string url_path
){

	CURL* curl;
	CURLcode res;
	stringstream result;

	curl_global_init(CURL_GLOBAL_DEFAULT);
	curl = curl_easy_init();
	
	if(curl){
		// fstream file(fileName, fstream::out | fstream::binary);
		// if(!file.is_open()) {
			// 	cerr << "Error creating the file." << endl;
			// 	throw runtime_error("Error creating the file.");
			// }
		
		
		curl_easy_setopt(curl, CURLOPT_URL, url_path.c_str());
		curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
		curl_easy_setopt(curl, CURLOPT_WRITEDATA, &result);

		auto startTime = chrono::duration_cast<chrono::microseconds>(
      	chrono::system_clock::now().time_since_epoch()
  		).count();
		cout << "start Downloading the vehicle Position..." << startTime; 

		res = curl_easy_perform(curl);

		auto endTime = chrono::duration_cast<chrono::microseconds>(
      	chrono::system_clock::now().time_since_epoch()
  		).count();

		cout << "end Downloading the vehicle Position..." << endTime ; 

		cout<< "Download took " << endTime - startTime << " microsecond"<<endl;

		if(res != CURLE_OK){
			cerr << "Err downloading the file" << curl_easy_strerror(res) << endl;
			throw runtime_error("Error downloading the file: " + string(curl_easy_strerror(res)));
		}
		curl_easy_cleanup(curl);
	}

	curl_global_cleanup();

	return result;
}

string getValueFromTag(char* args[], string tag){

 	for(int i = 0; args[i] != nullptr; i++){
		if(strcmp(args[i], tag.c_str()) == 0){
			if(args[i+1] != nullptr) return args[i+1];
			cerr<<"Argument expected after "<< tag << endl;
			throw invalid_argument("Argument expected after " + tag);
		}
	}
	return ""; 
}

bool isFileProvidedAlredy(char* args[]){
	return !getValueFromTag(args, "-f").empty();
}

int mainLogic(int argc, char* args[], pqxx::connection* conn){
	auto startTime = chrono::duration_cast<chrono::microseconds>(
      chrono::system_clock::now().time_since_epoch()
  	).count();

	cout << "Program start time: " << startTime << endl;

	string url = getValueFromTag(args, "-u");
	string out_path = getValueFromTag(args, "-o");

	// download the file if its not passed already
	// fstream file; 
	stringstream ss;
	
	// = isFileProvidedAlredy(args) 
	// ? file(getValueFromTag(args, "-f") , ios::in | ios::binary)
	// : downloadFile(
	// 	!url.empty() ? url : url_path, 
	// 	!out_path.empty() ? out_path : ::fileName
	// );

	if (isFileProvidedAlredy(args)) {
      ifstream file(getValueFromTag(args, "-f"), ios::in | ios::binary);
      ss << file.rdbuf();
  	} else {
      ss = downloadFile(!url.empty() ? url : url_path);
  	}

	// ifstream file(fileName, ios::binary);

	// if(!file.is_open()){
	// 	cerr<< "error reading the file"<< endl;
	// 	return 1;
	// }

	FeedMessage feed;
	if (!feed.ParseFromIstream(&ss)) {
        	cerr << "Failed to parse feed message." << endl;
        	return 1;
    }


	// -----------------------

	try {
        
        // Start a transaction
        pqxx::work txn(*conn);


		string insertQ = "INSERT INTO public.vehicle_position(id, route_id, route_short_name, lon, lat, vehicle_id, \"timestamp\", vehicle_distance_traveled, speed) VALUES ";
		string insertV = "";

		map<string, FeedEntity> vehicles;

		for (int i = 0; i < feed.entity_size(); i++) {
			FeedEntity entity = feed.entity(i);
			if (entity.has_vehicle()) {
				string vid = entity.vehicle().vehicle().id();
				vehicles[vid] = entity;
			}
		}

		for (const auto& [vid, entity] : vehicles) {
      // build insert here
  
			// FeedEntity entity = feed.entity(i);

			if (entity.has_vehicle()) {
				if (!insertV.empty()) insertV += ", ";

				long ts = chrono::duration_cast<chrono::seconds>(chrono::system_clock::now().time_since_epoch()).count();

				insertV += "('" + generate_uuid_v4() + "',"
					+ "'" + entity.vehicle().trip().route_id() + "',"
					+ "'" + entity.vehicle().trip().route_id() + "',"
					+ to_string(entity.vehicle().position().longitude()) + ","
					+ to_string(entity.vehicle().position().latitude()) + ","
					+ "'" + entity.vehicle().vehicle().id() + "',"
					+ "TO_TIMESTAMP(" + to_string(ts) + "),"
					+ to_string(entity.vehicle().position().odometer()) + ","
					+ to_string(entity.vehicle().position().speed()) + ")";
			}
		}

		string onConflict = "ON CONFLICT (vehicle_id) DO UPDATE SET lat = EXCLUDED.lat,lon = EXCLUDED.lon, speed = EXCLUDED.speed,\"timestamp\" = EXCLUDED.\"timestamp\", vehicle_distance_traveled = EXCLUDED.vehicle_distance_traveled";
// cout<< insertQ + insertV + onConflict +";"<<endl;
		pqxx::result rows = txn.exec(insertQ + insertV + onConflict +";");

        // for (const auto& row : rows) {
        //     cout << row["id"].as<int>() << " | "
        //               << row["name"].as<string>() << "\n";
        // }

        txn.commit();

    } catch (const exception& e) {
        cerr << "Error: " << e.what() << "\n";
        return 1;
    }

	auto endTime = chrono::duration_cast<chrono::microseconds>(
      chrono::system_clock::now().time_since_epoch()
  	).count();

  	cout << "Program End time: " << endTime << endl;
  	cout << "Time to execute " << endTime - startTime <<endl;  
	return 0;
}


int main(int argc, char* args[]){

	// Connection string
	pqxx::connection conn(
		"host=postgres "
		"port=5432 "
		"dbname=locate_my_bus "
		"user=postgres "
		"password=postgres"
	);

	if (conn.is_open()) {
		cout << "Connected to: " << conn.dbname() << "\n";
    }

	int i = 0 ;
	while(true){
		cout<< "itteration: " << i++ << endl;
		mainLogic(argc, args, &conn);
		this_thread::sleep_for(chrono::seconds(30));
	}
	
}
