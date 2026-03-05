run-loop-29:
	while true; do ./daemon/build/vehiclePosition_d | grep "Vehicle: 29"; sleep 60; done

get-protobuf-headers:
	wget "https://gtfs.org/documentation/realtime/gtfs-realtime.proto"
	sleep 5
	mv gtfs-realtime.proto ./daemon/assets/transit_realtime.proto
	protoc --cpp_out=. ./daemon/assets/transit_realtime.proto
	

build: 
	g++ ./daemon/test.cpp ./daemon/assets/transit_realtime.pb.cc \
	    -I. \
		$(shell pkg-config --cflags --libs protobuf) \
	    -lcurl \
	    -o ./daemon/build/vehiclePosition_d

run: 
	./daemon/build/vehiclePosition_d