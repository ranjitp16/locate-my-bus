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

A VS Code devcontainer is defined in `.devcontainer/`. It spins up a C++ Ubuntu container (port 3000 forwarded for Express, which now serves both the API and the built SPA — Vite is build-only and there is no separate dev server) and a Postgres 17 container (port 5434→5432). On `postCreate`, it installs system deps (`protobuf-compiler`, `libprotobuf-dev`, `libcurl4-openssl-dev`, `libpqxx-dev`), installs Node 22 via nvm, and runs `make get-protobuf-headers`. Environment variables come from `.development.env` (loaded into shell on container start).

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
                    Browser (React 18 SPA, MapAdapter → Azure Maps,
                             polls /live every 15 s)
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

**Public landing snapshot** (`GET /api/landing`): un-auth'd endpoint that returns `{ totals, agencies }`. `totals` = `{ agencies, routes, busesLive, polls24h, errorRatePct, avgLatencyMs }` over the last 24 h. Each agency row carries `{ id, name, routes, busesLive, stale, errorRatePct, avgLatencyMs }` so the Landing eyebrow + trust stats + tracked-agencies strip, and the per-agency cards on `/dash/agencies`, can all render real numbers without exposing the access key. Backed by aggregates over `poll_iteration` + `feed_execution`.

**Dashboard endpoints** (`/api/dashboard/*`, all auth'd): `stats`, `iterations`, `executions/:id`, `analytics`, `latency`. Postgres NUMERIC columns (percentages, averages) are explicitly coerced to JS numbers in the handler before serialising — `pg`'s default returns them as strings, which broke `.toFixed()` on the client.

### Frontend (`web/client/` → `web/public/dist/`)

Single-page React 18 + TypeScript app built with Vite. Source lives in `web/client/src/`; the production build emits to `web/public/dist/` which Express serves as static + SPA catch-all.

**Design system** (`src/assets/tokens.css`): CSS custom properties for color/spacing/type. Type stack is Bricolage Grotesque (display) + Manrope (UI) + JetBrains Mono (data, labels, numbers). Default accent is electric blue (`--signal: #3B82F6`). Theme toggle persists in `localStorage` under `lmb-theme` and is applied as `data-theme="dark|light"` on `<html>` via `ThemeProvider`.

**Routing**: React Router. Routes match the existing URL paths:
- `/` → `pages/Landing.tsx` — editorial landing wired to `GET /api/landing`. Eyebrow ("Live · N agency · M routes"), trust stats (polls/24h, error rate, refresh, license), and the tracked-agencies grid all render real DB-backed numbers. Mobile gets a hamburger drawer (`MobileNavSheet`) since `DesktopShell` isn't used below 900px. The illustrated hero card + `MiniMap` are intentionally decorative — the bus icon there has a static translucent-blue puck (no pulse).
- `/view-map` → `pages/MapPage.tsx` — live tracker. Talks to a `MapAdapter` (see "Map adapter abstraction" below) so the page never imports Azure SDK types directly. 15 s polling of `/live/:agency_id/:route_id`; per-bus marker SVG is `renderToStaticMarkup(<BusMark .../>)` (single source of truth, see "Map markers" below). Top-bar route badge opens a route picker popover; gear opens a settings popover (map style / app theme / `routes: running|all` filter). Bottom sheet collapses; first-time visitors land with the sheet open, returning visitors (with persisted agency) land collapsed. Supports `?mode=plan` to deep-link into the trip-plan sheet.
- `/dash/agencies` → `pages/AgenciesPage.tsx` — `/api/agencies` for metadata + `/api/landing` for per-agency stats (routes / avg latency / error rate / `stale` flag). Live/Stale tag is dynamic; success banner auto-dismisses after 4 s; add-agency form clears on success and keeps values on failure; skeleton cards during initial fetch. Uses shared `useAccessKey` + `AccessKeyRow`.
- `/dash/monitor` → `pages/MonitorPage.tsx` — Raw + Analytics tabs, fully wired to `/api/dashboard/{stats,iterations,analytics,latency}`. Daemon uptime is derived client-side from `stats.oldest_iteration_at`. Per-agency latency histogram filters `/api/dashboard/latency` by the selected `agency_id`. The access-key prompt uses a **local draft + Unlock button** instead of binding the input to the parent state — otherwise every keystroke fires four authed fetches and a 401 wipes the input mid-type.

**Code-split**: each page is `React.lazy()`-loaded. Azure Maps SDK is `import()`-ed only inside `AzureMapAdapter.init()`. Landing's payload stays small (no `react-dom/server` either — that lives in `MapPage`'s chunk).

**Persistent state keys** (all `localStorage` unless noted):
- `lmb-theme` — `dark | light` (set pre-paint by an inline script in `index.html` to avoid theme flash)
- `lmb-map-style` — Azure style id; defaults to `road` (light) / `night` (dark) if unset
- `lmb-agency-id`, `lmb-route-id` — last picked agency / route on `/view-map`
- `lmb-show-all-routes` — `1 | 0`; toggles `/routes/:id/0|1` filter
- `dash-access-key` — `sessionStorage` (cleared on tab close), via `lib/useAccessKey.ts`

**Shared components**:
- `components/BusGlyph.tsx` — `BusMark` (the illustrated side-view bus) + `BusIconG` (inline glyph for buttons). `BusMark` takes `bearing` (compass degrees, rotates the body; the route number text stays unrotated for legibility), `pinned` (draws a static translucent puck behind), and `idSeed` (override the gradient id prefix so multiple SSR'd markers don't share `<linearGradient>` ids).
- `components/MiniMap.tsx` — decorative SVG map used on Landing. Route polyline travels only along grid roads; bus positions are hardcoded points on that polyline.
- `components/DesktopShell.tsx` — top nav used on Landing / Agencies / Monitor desktop layouts. Each tab has an icon (Home / BusIconG / Flag / Activity).
- `components/MobileNavSheet.tsx` — hamburger trigger + slide-down drawer with the same four nav targets + theme toggle. Used in mobile headers everywhere except `/view-map` (the map page intentionally keeps the back arrow + context badge + gear; nav lives in the gear popover and the back button takes you home).
- `components/AccessKeyRow.tsx` — password-style input for the dashboard access key. Shared between Agencies and Monitor; both pages read/write via `lib/useAccessKey.ts`.
- `components/atoms.tsx` — `FAB`, `LiveDot`, `Tag`.
- `components/Icons.tsx` — stroke-based icon set.

Responsive split is driven by `lib/useMediaQuery.ts` :: `useIsDesktop()` (`min-width: 900px`).

**Map adapter abstraction** (`lib/maps/`):
- `adapter.ts` declares `MapAdapter` — `init` / `dispose` / `setStyle` / `setCamera` / `addMarker` / `updateMarker` / `removeMarker` / `hasMarker` / `listMarkerIds` / `getZoom`. Types are provider-neutral (`LatLng` not `[lng, lat]`).
- `azureAdapter.ts` is the only implementation today. Owns the lazy `import('azure-maps-control')`, the atlas CSS import, the `[lng, lat]` quirk, and the `proxyAuthOptions` / `proxyTransformRequest` from `lib/azureMaps.ts`. Marker bookkeeping (id → `HtmlMarker` + wrapping `HTMLDivElement`) stays inside the adapter.
- `MapPage.tsx` calls `adapter.*` only — zero `atlas.*` references in the page. Swapping providers = drop a new adapter (Mapbox, Leaflet, MapLibre…) and change the one import line.

**Map markers** (`/view-map`): each marker's innerHTML is `renderToStaticMarkup(<BusMark size={42} route={routeId} pinned={...} bearing={...} idSeed={`v${vehicle_id}`} />)`. `idSeed=vehicle_id` ensures gradient ids are globally unique across independently-rendered SSR fragments. The marker sync effect always re-renders innerHTML so bearing updates on every poll. The standalone string template (`busMarkSvgString.ts`) was deleted — `BusMark` is the single source of truth across Landing illustrations and live map markers.

**Provider-agnostic types** (`lib/azureMaps.ts`): `Vehicle` / `Agency` / `Route` types live here for historical reasons; they're not Azure-specific. The Azure-specific proxy helpers (`proxyAuthOptions`, `proxyTransformRequest`) are also in this file but only `azureAdapter.ts` imports them. Other call sites import the types.

**Shared hooks** (`lib/`):
- `useLandingData(refreshKey?)` — fetches `/api/landing` once per `refreshKey` change. Returns `null` while loading so callers can show skeletons.
- `useAccessKey()` — `sessionStorage`-backed `[key, setKey]` tuple. Used by Agencies + Monitor.
- `useMediaQuery` — `useIsDesktop()` desktop/mobile split.

**Conventions**: inline `style={{...}}` per the design's prototype style (no CSS modules / Tailwind). Never use `dangerouslyInnerHTML` with user input. The Azure Maps SDK is configured to proxy every `atlas.microsoft.com` request through `/api/azure-maps/*` (transformRequest in `lib/azureMaps.ts`), so the subscription key never reaches the browser. Numeric Postgres columns must be coerced to `Number` server-side before serialising — `pg` returns NUMERIC as strings and `.toFixed()` etc. silently break.

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
