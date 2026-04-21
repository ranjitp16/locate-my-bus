# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Daemon (C++)

```sh
# One-time: fetch and compile protobuf definitions
make get-protobuf-headers

# Build the daemon binary
make build
# Equivalent to:
# g++ ./daemon/main.cpp ./daemon/assets/transit_realtime.pb.cc -I. $(pkg-config --cflags --libs protobuf) -lcurl -lpqxx -lpq -o ./daemon/build/vehiclePosition_d

# Run
make run
```

### Web server (Node.js)

```sh
npm install
npm run dev        # nodemon web/index.js, port 3000
```

### Database

```sh
psql -U postgres -d locate_my_bus -f db/schema/init.sql
```

### Docker

```sh
make docker        # builds daemon image
make docker-web    # builds web image
make run-docker
make run-docker-web   # requires DELETE_ACCESS_KEY env var
```

### Required environment variables

```
POSTGRES_HOST
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
DELETE_ACCESS_KEY   # required by web server and docker-web
AZURE_MAPS_KEY      # Azure Maps subscription key — proxied via /api/azure-maps, never sent to client
```

### Devcontainer

A VS Code devcontainer is defined in `.devcontainer/`. It spins up a C++ Ubuntu container (port 8080→3000) and a Postgres 17 container (port 5434→5432). On `postCreate`, it installs system deps (`protobuf-compiler`, `libprotobuf-dev`, `libcurl4-openssl-dev`, `libpqxx-dev`), installs Node 22 via nvm, and runs `make get-protobuf-headers`. Environment variables come from `.development.env` (loaded into shell on container start).

The devcontainer Docker network is `locate-my-bus_devcontainer_default` — used by `make run-docker` to attach the daemon container to the same network as Postgres.

### Debug make target

```sh
make run-loop-29    # tail output from vehicle 29 every 60s (dev/debug only)
```

---

## Architecture

Two independent processes share a PostgreSQL database:

```
GTFS Static zip ──► Node.js onboarding (agency/route/shape/trip tables)
GTFS-RT protobuf ──► C++ daemon (live_vehicle_position, polls every 15 s)
                           │
                      PostgreSQL
                           │
                    Node.js/Express (port 3000)
                           │
                    Browser (Azure Maps SDK v3, polls /live every 15 s)
```

### Daemon (`daemon/main.cpp`)

Single-file C++ program. The `main()` function opens one persistent `pqxx::connection` and calls `mainLogic()` in an infinite loop with a 15-second sleep.

`mainLogic()` per iteration:
1. Fetches all agencies from `public.agency`.
2. Groups work by unique `rt_feed_url`: launches one async libcurl download + protobuf parse per distinct feed URL (in bounded batches capped at `hardware_concurrency()`), then reuses the resolved `FeedMessage` for every agency that references that URL.
3. For each agency, loads valid `route_id` and `trip_id` sets from the DB and filters the shared feed to vehicles relevant to that agency.
4. Builds a bulk `INSERT` statement for all matching vehicles, then `DELETE`s the previous positions for that agency and inserts the new batch — all inside a single `pqxx::work` transaction.

SQL is built by hand (string concatenation). There is no ORM. Values are inserted directly into the query string for the bulk insert; use `txn.exec_params` only for parameterised single-row queries.

The protobuf schema lives in `daemon/assets/transit_realtime.proto` (fetched from gtfs.org) and is compiled to `transit_realtime.pb.h/.cc` via `protoc`. Commit the generated `.pb.cc` file; regenerate only when the proto changes.

### Web server (`web/index.js`)

Express 5, single file. Uses a `pg.Pool` for all queries. No ORM.

**Onboarding flow** (`POST /api/agencies/add` → `web/service/addAgency.js` → `web/repository/addAgency.js`):
- Downloads the GTFS static zip as a stream using `unzipper` + `request`.
- Parses `agency.txt`, `routes.txt`, `shapes.txt`, `trips.txt` in sequence inside a single DB transaction.
- Column mapping is driven by `information_schema.columns` — the code queries the DB schema at runtime to know which columns to insert. This means the DB schema is the source of truth for what gets imported.
- Bulk inserts use batches of 5 000 rows (`BATCH_SIZE = 5000` in repository).

**Auth**: `authMiddleware` checks the `x-access-key` header against `process.env.DELETE_ACCESS_KEY`. Applied to `POST /api/agencies/add`, `DELETE /api/agencies/delete/:id`, all `/api/dashboard/*`, and `POST /api/daemon/kill`.

**Daemon control**: `POST /api/daemon/kill` restarts the daemon container via the Docker socket (`/var/run/docker.sock`) — finds containers by image name `ranjitnovascotia/locate-my-bus:latest`, kills and restarts them.

### Frontend (`web/public/`)

The map uses **Azure Maps SDK v3** via a thin adapter pattern:

- `map.html` — main map page; all map calls go through `window.mapAdapter`; polls `/live/:agency_id/:route_id` every 15 s; marker click pins the map to that bus; zoom/center persisted in `localStorage`; light/dark theme via `data-theme` on `<html>` stored in `localStorage`. Shows route shape polyline via `/api/shape/:agency_id/:trip_id` when a bus is pinned. Auto-pins nearest bus when user location is active.
- `assets/map-adapter-azure.js` — IIFE that exposes `window.mapAdapter` with 14 methods (`init`, `setView`, `getZoom`, `onClick`, `onMoveEnd`, `updateBusMarkers`, `onMarkerClick`, `onMarkerPopupOpen`, `onMarkerPopupClose`, `drawRoute`, `clearRoute`, `closeOpenPopup`, `setUserLocation`, `clearUserLocation`). Handles all Azure Maps SDK calls internally — `map.html` never calls Atlas APIs directly.
  - Bus markers are `atlas.HtmlMarker` instances reused across polls (keyed by `vehicle_id`) so the pinned bus can animate along the route shape via `requestAnimationFrame`.
  - Route shape is rendered as an SVG overlay (not a WebGL layer) to allow CSS `stroke-dasharray` animation; reprojected on each map `move` event via `map.positionsToPixels()`.
  - At most one popup is open at a time (`_openPopup` state); popup content is preserved (not replaced) across polls for the pinned bus so the live age counter DOM reference stays valid.
- `addAgency.html` — agency management UI; access key stored in `sessionStorage` as `dash-access-key`.
- `dashboard.html` — ops dashboard; served at `/dash/monitor`.
- Bootstrap 5.3.3 + Font Awesome 6.5.1 loaded from CDN with SRI hashes.
- Never use `innerHTML` with user-supplied data — always use DOM APIs or `textContent`.
- CSP (in `helmet` config) allows `atlas.microsoft.com` for Azure Maps scripts, styles, fonts, images, and connections; `workerSrc` includes `blob:` for MapLibre GL workers.

### Database (`db/schema/init.sql`)

Schema is applied once manually. The file contains both `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` statements (columns added iteratively) — run it only on a fresh DB or expect errors on the `ALTER` lines if tables already exist.

Key relationships:
- `agency` ← `route` (cascade delete)
- `route` ← `trip`, `shape` ← `shape_point` (cascade delete)
- `live_vehicle_position` FKs to `agency`, `route`, and `trip` — vehicles not matching known routes/trips are silently dropped by the daemon.
