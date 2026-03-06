# Locate My Bus

Real-time bus tracking for Halifax Transit. A C++ daemon fetches GTFS-RT vehicle position data every 30 seconds, stores it in PostgreSQL, and a Node.js/Express server exposes it to a Leaflet.js map in the browser.

![Screenshot](./images/screenshot.png)

---

## Architecture

```
Halifax Transit GTFS-RT API
        │
        ▼
  C++ Daemon (every 30s)
  - Downloads VehiclePositions.pb
  - Parses protobuf feed
  - Upserts into PostgreSQL (ON CONFLICT vehicle_id DO UPDATE)
        │
        ▼
   PostgreSQL DB
   └── public.vehicle_position
        │
        ▼
  Node.js / Express server
  - GET /:route_id → queries DB, returns JSON
  - Serves static Leaflet.js frontend
        │
        ▼
  Browser (Leaflet.js map)
  - Polls /1 every 30 seconds
  - Renders vehicle markers
```

---

## Getting Started

This project uses Dev Containers so your local environment stays clean. If you use Dev Containers you can skip the Prerequisites section.

### Prerequisites

`protoc` is required to generate the protobuf headers the daemon depends on.

- **macOS**
  ```sh
  brew install protobuf
  ```
- **Linux**
  ```sh
  sudo apt update && sudo apt install -y protobuf-compiler
  ```
- **Windows**
  Download the latest `protoc-*-win64.zip` from [github.com/protocolbuffers/protobuf/releases](https://github.com/protocolbuffers/protobuf/releases), extract it, and add the `bin` folder to your `PATH`.

You also need a running PostgreSQL instance. The schema is in `db/schema/init.sql`. Connection details default to:

```
host=postgres port=5432 dbname=locate_my_bus user=postgres password=postgres
```

Override these via environment variables (see `.development.env`).

### Installation

1. Clone the repo
   ```sh
   git clone git@github.com:ranjitp16/locate-my-bus.git && cd locate-my-bus
   ```

2. Open the Dev Container **or** build manually:
   ```sh
   make get-protobuf-headers && make build
   ```

3. Apply the database schema:
   ```sh
   psql -U postgres -d locate_my_bus -f db/schema/init.sql
   ```

4. Start the daemon (polls Halifax Transit every 30 s):
   ```sh
   make run
   ```

5. In a separate terminal, start the web server:
   ```sh
   npm run dev
   ```

6. Open `http://localhost:3000` in your browser.

---

## How It Works

- The daemon deduplicates on `vehicle_id` using PostgreSQL's `ON CONFLICT … DO UPDATE`, so the table always holds the latest position per vehicle — no duplicate rows.
- The frontend fetches `/1` (route 1) every 30 seconds, clears old markers, and re-renders the updated positions.
- Vehicle popups show route ID, vehicle ID, age of the reading, speed, and bearing.

---

## License

Distributed under the MIT License. See `LICENSE.txt` for more information.

## Contact

Ranjit Pandey — [@know_me](https://ranjitpandey.dev) — [contact@ranjitpandey.dev](mailto:contact@ranjitpandey.dev)

## Further Reading

- [GTFS Realtime Reference](https://gtfs.org/documentation/realtime/proto/)
