run-loop-29:
	while true; do ./daemon/build/vehiclePosition_d | grep "Vehicle: 29"; sleep 60; done

get-protobuf-headers:
	wget "https://gtfs.org/documentation/realtime/gtfs-realtime.proto"
	sleep 5
	mv gtfs-realtime.proto ./daemon/assets/transit_realtime.proto
	protoc --cpp_out=. ./daemon/assets/transit_realtime.proto
	

build: 
	mkdir -p ./daemon/build
	g++ ./daemon/main.cpp ./daemon/assets/transit_realtime.pb.cc \
	    -I. \
		$(shell pkg-config --cflags --libs protobuf) \
	    -lcurl -lpqxx -lpq\
	    -o ./daemon/build/vehiclePosition_d

run: 
	./daemon/build/vehiclePosition_d

docker:
	docker build \
	--platform linux/amd64,linux/arm64 \
	-t ranjitnovascotia/locate-my-bus:latest \
	-f ./daemon/Dockerfile .

run-docker:
	docker run -e POSTGRES_HOST=postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=locate_my_bus -d --network locate-my-bus_devcontainer_default ranjitnovascotia/locate-my-bus:latest

run-dev:
	npm run dev