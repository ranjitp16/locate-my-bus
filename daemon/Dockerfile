# ── Build stage ──────────────────────────────────────────────────────────────
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    g++ \
    pkg-config \
    cmake \
    git \
    libprotobuf-dev \
    libcurl4-openssl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Build libpqxx from source with C++20 so the ABI matches our compilation flags
RUN git clone --depth 1 --branch 7.8.1 https://github.com/jtv/libpqxx.git /tmp/libpqxx && \
    cmake -S /tmp/libpqxx -B /tmp/libpqxx/build \
        -DBUILD_SHARED_LIBS=ON \
        -DCMAKE_CXX_STANDARD=20 \
        -DCMAKE_BUILD_TYPE=Release \
        -DSKIP_BUILD_TEST=ON && \
    cmake --build /tmp/libpqxx/build -j$(nproc) && \
    cmake --install /tmp/libpqxx/build

WORKDIR /project
COPY daemon/ ./daemon/

RUN g++ daemon/main.cpp daemon/assets/transit_realtime.pb.cc \
    -std=c++20 \
    -I. \
    $(pkg-config --cflags --libs protobuf) \
    -lcurl -lpqxx -lpq \
    -o vehiclePosition_d

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    libprotobuf32t64 \
    libcurl4t64 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy the C++20-compiled libpqxx from the build stage
COPY --from=builder /usr/local/lib/libpqxx*.so* /usr/local/lib/
RUN ldconfig

COPY --from=builder /project/vehiclePosition_d /usr/local/bin/vehiclePosition_d

CMD ["vehiclePosition_d"]
