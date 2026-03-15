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

run-dev:
	npm run dev

docker:
	docker build \
	--platform linux/amd64,linux/arm64 \
	-t ranjitnovascotia/locate-my-bus:latest \
	-f ./daemon/Dockerfile .

docker-web:
	docker build \
	--platform linux/amd64,linux/arm64 \
	-t ranjitnovascotia/locate-my-bus:web \
	-f ./web/Dockerfile .

run-docker:
	docker run \
	-e POSTGRES_HOST=$(POSTGRES_HOST) \
	-e POSTGRES_USER=$(POSTGRES_USER) \
	-e POSTGRES_PASSWORD=$(POSTGRES_PASSWORD) \
	-e POSTGRES_DB=$(POSTGRES_DB) \
	-d \
	--network locate-my-bus_devcontainer_default \
	ranjitnovascotia/locate-my-bus:latest

run-docker-web:
	@test -n "$(DELETE_ACCESS_KEY)" || (echo "ERROR: DELETE_ACCESS_KEY is not set. Export it before running this target." && exit 1)
	docker run \
	-e POSTGRES_HOST=$(POSTGRES_HOST) \
	-e POSTGRES_USER=$(POSTGRES_USER) \
	-e POSTGRES_PASSWORD=$(POSTGRES_PASSWORD) \
	-e POSTGRES_DB=$(POSTGRES_DB) \
	-e DELETE_ACCESS_KEY=$(DELETE_ACCESS_KEY) \
	-d \
	-p 3000:3000 \
	ranjitnovascotia/locate-my-bus:web