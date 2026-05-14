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

### Web (Node.js Express + React SPA)

Single dev server. `npm run dev` (or `make run-dev`) builds the SPA into `web/public/dist/`, then starts Express via nodemon on port 3000. Express serves the API and the built SPA from the same origin — no Vite dev server, no second port.

```sh
npm install                            # server deps (one-time)
npm --prefix web/client install        # client deps (one-time)
npm run dev                            # build SPA + run Express on :3000
```

The React app lives in `web/client/` (Vite + React 18 + TypeScript). Vite is used in build mode only. To iterate on UI without restarting Express, run `npm --prefix web/client run build -- --watch` in another terminal — Express picks up the updated `dist/` automatically.

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

A VS Code devcontainer is defined in `.devcontainer/`. It spins up a C++ Ubuntu container (ports 3000 for Express and 5173 for Vite forwarded to host) and a Postgres 17 container (port 5434→5432). On `postCreate`, it installs system deps (`protobuf-compiler`, `libprotobuf-dev`, `libcurl4-openssl-dev`, `libpqxx-dev`), installs Node 22 via nvm, and runs `make get-protobuf-headers`. Environment variables come from `.development.env` (loaded into shell on container start).

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
- Parses `agency.txt`, `routes.txt`, `shapes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `calendar.txt`, `calendar_dates.txt` in sequence inside a single DB transaction.
- Column mapping is driven by `information_schema.columns` — the code queries the DB schema at runtime to know which columns to insert. This means the DB schema is the source of truth for what gets imported.
- Bulk inserts use batches of 5 000 rows (`BATCH_SIZE = 5000` in repository).

**Auth**: `authMiddleware` checks the `x-access-key` header against `process.env.DELETE_ACCESS_KEY`. Applied to `POST /api/agencies/add`, `DELETE /api/agencies/delete/:id`, all `/api/dashboard/*`, and `POST /api/daemon/kill`.

**Daemon control**: `POST /api/daemon/kill` restarts the daemon container via the Docker socket (`/var/run/docker.sock`) — finds containers by image name `ranjitnovascotia/locate-my-bus:latest`, kills and restarts them.

### Frontend (`web/client/` → `web/public/dist/`)

Single-page React 18 + TypeScript app built with Vite. Source lives in `web/client/src/`; the production build emits to `web/public/dist/` which Express serves as static + SPA catch-all.

**Design system** (`src/assets/tokens.css`): CSS custom properties for color/spacing/type. Type stack is Bricolage Grotesque (display) + Manrope (UI) + JetBrains Mono (data, labels, numbers). Default accent is electric blue (`--signal: #3B82F6`). Theme toggle persists in `localStorage` under `lmb-theme` and is applied as `data-theme="dark|light"` on `<html>` via `ThemeProvider`.

**Routing**: React Router. Routes match the existing URL paths:
- `/` → `pages/Landing.tsx` — editorial landing, hero live tracker, route tape (mostly hardcoded for now)
- `/view-map` → `pages/MapPage.tsx` — Azure Maps SDK v3 loaded lazily; 15s polling of `/live/:agency_id/:route_id`; bus markers are `atlas.HtmlMarker` with SVG content from `components/busMarkSvgString.ts`; design chrome (top bar, FAB cluster, bottom sheet) wrapped around the live map
- `/dash/agencies` → `pages/AgenciesPage.tsx` — wired to `/api/agencies*` with `x-access-key` from `sessionStorage['dash-access-key']`; daemon restart via `/api/daemon/kill`
- `/dash/monitor` → `pages/MonitorPage.tsx` — Raw + Analytics tabs; currently rendered with placeholder data (live wiring to `/api/dashboard/*` is a follow-up)

**Code-split**: each page is `React.lazy()`-loaded; Azure Maps SDK is `import()`-ed only inside `MapPage`. Landing's payload stays small.

**Shared components**: `components/BusGlyph.tsx` (the custom illustrated bus), `components/Icons.tsx`, `components/atoms.tsx` (FAB, LiveDot, Tag), `components/MiniMap.tsx` (decorative SVG map for Landing), `components/DesktopShell.tsx` (top nav used on all desktop layouts). Responsive split is driven by `lib/useMediaQuery.ts` :: `useIsDesktop()` (`min-width: 900px`).

**Conventions**: inline `style={{...}}` per the design's prototype style (no CSS modules / Tailwind). Never use `dangerouslyInnerHTML` with user input. The Azure Maps SDK is configured to proxy every `atlas.microsoft.com` request through `/api/azure-maps/*` (transformRequest in `lib/azureMaps.ts`), so the subscription key never reaches the browser.

**CSP** (in `helmet` config): same-origin scripts and styles, `'unsafe-inline'` for inline React styles, Google Fonts whitelisted, Azure Maps requests are same-origin (proxied), `workerSrc` includes `blob:` for the SDK's MapLibre workers.

### Database (`db/schema/init.sql`)

Schema is applied once manually. The file contains both `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` statements (columns added iteratively) — run it only on a fresh DB or expect errors on the `ALTER` lines if tables already exist.

Key relationships:
- `agency` ← `route` (cascade delete)
- `route` ← `trip`, `shape` ← `shape_point` (cascade delete)
- `live_vehicle_position` FKs to `agency`, `route`, and `trip` — vehicles not matching known routes/trips are silently dropped by the daemon.
- `stop` / `stop_time` — bus stops and scheduled arrival/departure times (imported from GTFS `stops.txt` and `stop_times.txt`).
- `calendar` / `calendar_date` — GTFS service day schedules and exceptions (weekday/weekend/holiday). Used by trip planner to filter to trips running today.
- Performance indexes on `stop(agency,lat,lon)`, `stop_time(agency,stop_id)`, `trip(agency,route_id)`, `trip(agency,service_id)`, `live_vehicle_position(agency,route_id,trip_id)`.

### Trip planner (`web/service/tripPlanner.js` + `web/repository/tripPlanner.js`)

Schedule-based route search with pruning. Finds direct routes, 1-transfer, and 2-transfer options scored by walking distance, transfer count, and total time. Calendar-aware (filters by active service_id for today). Performance guards: 8s timeout, iteration caps, result caps, stop-time cache, batch transfer stop computation via in-memory set intersection. Provider-agnostic: geocoding and walking directions go through normalized server endpoints (`/api/maps/geocode`, `/api/maps/walk-route`) that abstract Azure Maps API response formats.
