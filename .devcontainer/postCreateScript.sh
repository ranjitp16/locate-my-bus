#!/bin/bash
set -e
export $(grep -v '^#' .env | xargs)
sudo apt-get update
sudo apt-get update && sudo apt-get install -y protobuf-compiler libprotobuf-dev libcurl4-openssl-dev
make get-protobuf-headers
make build