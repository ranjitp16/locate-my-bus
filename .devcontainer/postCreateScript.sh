#!/bin/bash
set -e
echo 'export $(grep -v \"^#\" /workspace/.development.env | xargs)' >> ~/.bashrc && source ~/.bashrc
sudo apt-get update
sudo apt-get install -y protobuf-compiler libprotobuf-dev libcurl4-openssl-dev libpqxx-dev
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 22
make get-protobuf-headers
make build