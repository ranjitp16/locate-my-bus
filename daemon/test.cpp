#include<iostream>
#include "assets/transit_realtime.pb.h"
#include<fstream>
#include<curl/curl.h>

using namespace std;
using namespace transit_realtime;

size_t write_data(void* ptr, size_t size, size_t nmemb, void* stream) {
    std::ofstream* out = static_cast<std::ofstream*>(stream);
    out->write(static_cast<char*>(ptr), size * nmemb);
    return size * nmemb;
}

string downloadFile(
	const string url_path = "https://gtfs.halifax.ca/realtime/Vehicle/VehiclePositions.pb", 
	const string fileName = "./daemon/assets/VehiclePositions.pb"
){

	CURL* curl;
	CURLcode res;

	curl_global_init(CURL_GLOBAL_DEFAULT);
	curl = curl_easy_init();

	if(curl){
		fstream file(fileName, fstream::out | fstream::binary);
		if(!file.is_open()) {
			cerr << "Error creating the file." << endl;
			throw runtime_error("Error creating the file.");
		}
		
		curl_easy_setopt(curl, CURLOPT_URL, url_path.c_str());
		curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
		curl_easy_setopt(curl, CURLOPT_WRITEDATA, &file);

		res = curl_easy_perform(curl);

		if(res != CURLE_OK){
			cerr << "Err downloading the file" << curl_easy_strerror(res) << endl;
			throw runtime_error("Error downloading the file: " + string(curl_easy_strerror(res)));
		}

		file.close();
		curl_easy_cleanup(curl);
	}

	curl_global_cleanup();

	return fileName;

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

int main(int argc, char* args[]){
	// download the file if its not passed already
	string fileName = isFileProvidedAlredy(args) ? getValueFromTag(args, "-f") : downloadFile();

	ifstream file(fileName, ios::binary);

	if(!file.is_open()){
		cerr<< "error reading the file"<< endl;
		return 1;
	}

	FeedMessage feed;
	if (!feed.ParseFromIstream(&file)) {
        	std::cerr << "Failed to parse feed message." << std::endl;
        	return 1;
    }

	for (int i = 0; i < feed.entity_size(); i++) {
        	FeedEntity entity = feed.entity(i);
        
        	if (entity.has_vehicle()) {
            		std::cout << "Vehicle: "<< entity.vehicle().trip().route_id() <<" Position: " 
                      	<< entity.vehicle().position().latitude() << ", "
                      	<< entity.vehicle().position().longitude() << ", " 
		      	<< entity.vehicle().position().odometer()<< ", "
		      	<< entity.vehicle().position().speed()<< ", "
			<< std::endl;
        	}
    }
}
