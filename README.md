# Locate My Bus

**Live demo: [bus.ranjitpandey.dev](https://bus.ranjitpandey.dev)**

Real-time bus tracking and trip planning for any GTFS-RT compatible transit agency. A C++ daemon fetches live vehicle position data every 15 seconds, stores it in PostgreSQL, and a Node.js/Express server exposes it to a React 18 + TypeScript single-page app. The map view talks to a provider-neutral `MapAdapter` (Azure Maps today; swap by dropping in a new adapter), and the SPA ships live agencies dashboards, a poll-monitor dashboard, and a multi-transfer trip planner.

![Screenshot](./images/screenshot.png)

---

## Architecture

```
GTFS Static Feed (zip)          GTFS-RT Feed (protobuf)
        │                                │
        ▼                                ▼
  Agency Onboarding (Node.js)    C++ Daemon (every 15s)
  - Parses agency.txt            - Fetches unique feeds in parallel
  - Parses routes.txt            - Parses protobuf feeds async
  - Inserts into PostgreSQL      - Replaces live_vehicle_position
        │                                │
        └──────────────┬─────────────────┘
                       ▼
                  PostgreSQL DB
                  ├── public.agency
                  ├── public.route
                  ├── public.live_vehicle_position
                  ├── public.shape / shape_point
                  ├── public.trip
                  ├── public.stop / stop_time
                  ├── public.calendar / calendar_date
                  ├── public.poll_iteration
                  └── public.feed_execution
                       │
                       ▼
           Node.js / Express server
           - GET /live/:agency_id/:route_id → JSON
           - GET /routes/:agency_id/:filter → JSON (filter: 1=running, 0=all)
           - GET /api/agencies              → JSON
           - GET /api/landing               → totals + per-agency stats (public)
           - POST /api/agencies/add         → onboard agency
           - DELETE /api/agencies/delete/:id
           - GET /api/trip-plan/:agency_id  → trip planner
           - GET /api/maps/geocode          → geocoding (provider-agnostic)
           - GET /api/maps/walk-route       → walking directions (provider-agnostic)
           - GET /api/dashboard/*           → monitoring stats
           - Serves the built React SPA from /web/public/dist
                       │
                       ▼
           Browser (React 18 + TypeScript SPA, Vite-built)
           - Landing wired to /api/landing (no fake numbers)
           - /view-map talks to a MapAdapter (Azure today)
              · top-bar route picker, gear popover for map style /
                app theme / running-vs-all routes filter
              · collapsible bottom sheet, agency details inline
              · bus markers rotate by GTFS head_bearing
              · pinning a bus draws its trip polyline + stops,
                fetches a walking path from the user → nearest stop
              · pinned bus interpolates between poll positions over 2s
              · agency / route / map style / filter persist in localStorage
           - /dash/agencies: live per-agency routes / avg latency /
              error rate, add / delete / restart-daemon
           - /dash/monitor: real-time poll & feed analytics
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

You also need a running PostgreSQL instance. The schema is in `db/schema/init.sql`. Connection details are configured via environment variables:

```
POSTGRES_HOST=localhost
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=locate_my_bus
DELETE_ACCESS_KEY=<secret>    # required to add/delete agencies
AZURE_MAPS_KEY=<key>          # Azure Maps subscription key (proxied server-side)
```

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

4. Start the web server:
   ```sh
   npm run dev
   ```

5. Open `http://localhost:3000` and go to **Manage Agencies** to onboard a transit agency by providing its GTFS static and RT feed URLs.

6. Start the daemon (it will poll all agencies stored in the DB every 15 s):
   ```sh
   make run
   ```

7. Go to **View Map**, select an agency and route — live positions appear within 15 seconds.

### Docker

Both the daemon and web server have Dockerfiles.

```sh
# Build images
make docker        # daemon  → ranjitnovascotia/locate-my-bus:latest
make docker-web    # web     → ranjitnovascotia/locate-my-bus:web

# Run
make run-docker
make run-docker-web
```

---

## API

| Method   | Path                              | Auth | Description                              |
|----------|-----------------------------------|------|------------------------------------------|
| `GET`    | `/live/:agency_id/:route_id`      | —    | Live vehicle positions for a route       |
| `GET`    | `/routes/:agency_id/:filter`      | —    | Routes for an agency (`1`=running, `0`=all) |
| `GET`    | `/api/agencies`                   | —    | List all onboarded agencies              |
| `GET`    | `/api/landing`                    | —    | Public landing snapshot: totals + per-agency stats over 24h |
| `POST`   | `/api/agencies/add`               | ✓    | Onboard a new agency                     |
| `DELETE` | `/api/agencies/delete/:id`        | ✓    | Remove an agency and its data            |
| `GET`    | `/api/dashboard/stats`            | ✓    | Aggregate poll stats                     |
| `GET`    | `/api/dashboard/iterations`       | ✓    | Last 50 poll iterations                  |
| `GET`    | `/api/dashboard/executions/:id`   | ✓    | Per-agency breakdown for an iteration    |
| `GET`    | `/api/dashboard/analytics`        | ✓    | Feed analytics and slow-feed detection   |
| `GET`    | `/api/dashboard/latency`          | ✓    | Download latency history per agency      |
| `GET`    | `/api/trip-plan/:agency_id`       | —    | Trip planner (query: originLat/Lng, destLat/Lng) |
| `GET`    | `/api/maps/geocode`               | —    | Address search (provider-agnostic)       |
| `GET`    | `/api/maps/walk-route`            | —    | Walking directions (provider-agnostic)   |
| `GET`    | `/api/shape/:agency_id/:trip_id`  | —    | Trip shape (lat/lng points)              |
| `GET`    | `/api/stops/:agency_id/:trip_id`  | —    | Ordered stops on a trip                  |

Auth-protected routes require the `x-access-key` header to match `DELETE_ACCESS_KEY`.

**POST `/api/agencies/add` body:**
```json
{
  "static_feed_url": "https://example.com/gtfs.zip",
  "rt_feed_url":     "https://example.com/VehiclePositions.pb"
}
```

---

## How It Works

- **Agency onboarding** downloads the GTFS static zip, parses `agency.txt`, `routes.txt`, `shapes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `calendar.txt`, and `calendar_dates.txt`, and inserts them into PostgreSQL in a single transaction.
- **The daemon** reads all agencies from the DB every 15 seconds, groups them by unique `rt_feed_url`, downloads each distinct feed in parallel (bounded by CPU core count), and replaces positions in `live_vehicle_position` with a DELETE + bulk INSERT per agency. Per-poll metrics are written to `poll_iteration` and `feed_execution` for monitoring.
- **The SPA** (React 18 + TypeScript, Vite-built, code-split per route) polls `/live/:agency_id/:route_id` every 15 seconds and re-renders markers. The map page (`/view-map`) talks exclusively to a provider-neutral `MapAdapter` (`web/client/src/lib/maps/adapter.ts`); the Azure implementation (`azureAdapter.ts`) owns the lazy SDK import, CSS, and `[lng, lat]` quirks. Swap providers by writing a new adapter and changing one import line. Bus markers are rendered via `renderToStaticMarkup(<BusMark .../>)` with `bearing` (rotates to match GTFS `head_bearing`) and an `idSeed` so gradient ids never collide across SSR'd marker SVGs.
- **User experience on the map** — pinning a bus draws its trip polyline + ordered stop dots (click or hover a stop for name / scheduled arrival / accessibility). Geolocation drops a pulsing blue dot; a green walking path is fetched from `/api/maps/walk-route` between you and the nearest stop on the pinned trip. The pinned bus's position is interpolated frame-by-frame over 2s on each poll (other buses snap). Map style (Road / Grayscale / Night / Satellite), app theme, the running-vs-all routes filter, and last-picked agency/route all persist in `localStorage`.
- **Dashboards** — `/dash/agencies` shows real per-agency route count, average latency, error rate, and a Live/Stale tag from `/api/landing`; `/dash/monitor` is fully wired to `/api/dashboard/{stats,iterations,analytics,latency}` with a daemon uptime derived from `oldest_iteration_at`, a sparkline of recent execution times, per-agency download-latency histograms, and slow-event detection. Both pages share a `useAccessKey` hook backed by `sessionStorage` and a local-draft Unlock prompt so typing doesn't blow up authed fetches on every keystroke.
- **Trip planner** — enter a destination (type an address or drop a pin) and the system finds optimal transit routes from your current location. Supports direct routes and up to 2 transfers. Results are ranked by walking distance, transfers, and total time. Each trip option shows a step-by-step timeline with leave time, boarding time, alighting time, and arrival time. Walking legs use the same provider-agnostic `/api/maps/walk-route` proxy as the map page; bus legs render the trip shape trimmed to the boarding→alighting segment. The planner respects GTFS calendar data and tags routes without a live bus as "(scheduled)."

---

## License

Distributed under the MIT License. See `LICENSE.txt` for more information.

## Contact

Ranjit Pandey — [@know_me](https://ranjitpandey.dev) — [contact@ranjitpandey.dev](mailto:contact@ranjitpandey.dev)

## Further Reading

- [GTFS Realtime Reference](https://gtfs.org/documentation/realtime/proto/)
- [GTFS Static Reference](https://gtfs.org/documentation/schedule/reference/)
