run-loop-29:
	while true; do ./test | grep "Vehicle: 29"; sleep 60; done

get-protobuf-headers:
	wget "https://gtfs.org/documentation/realtime/gtfs-realtime.proto"
	sleep 5
	mv gtfs-realtime.proto transit_realtime.proto
	protoc --cpp_out=. transit_realtime.proto
	

build: 
	g++ test.cpp transit_realtime.pb.cc \
	    $(shell pkg-config --cflags --libs protobuf) \
	    -lcurl \
	    -o test

run: 
	./test 