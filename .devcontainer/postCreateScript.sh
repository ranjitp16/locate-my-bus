#!/bin/bash
set -e
echo 'export $(grep -v \"^#\" /workspace/.env | xargs)' >> ~/.bashrc && source ~/.bashrc
sudo apt-get update
sudo apt-get update && sudo apt-get install -y protobuf-compiler libprotobuf-dev libcurl4-openssl-dev
make get-protobuf-headers
make build