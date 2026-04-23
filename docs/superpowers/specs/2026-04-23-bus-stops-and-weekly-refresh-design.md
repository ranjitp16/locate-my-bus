# Bus Stops & Weekly Refresh — Design Spec

## Overview

Two features sharing a unified onboarding pipeline:

1. **Bus stop data** — import `stops.txt` and `stop_times.txt` from GTFS static feeds during onboarding, display stop markers on the map when a bus is pinned.
2. **Weekly refresh** — purge all non-agency data and re-onboard every agency once per week at 4 AM AST, triggered by the C++ daemon and also available as a manual dashboard button.

## 1. Database Schema

Two new tables appended to `db/schema/init.sql`:

### `public.stop`

| Column              | Type             | Constraints                                      |
|---------------------|------------------|--------------------------------------------------|
| id                  | VARCHAR(45)      | NOT NULL, PK (agency_id, id)                     |
| agency_id           | UUID             | NOT NULL, FK → agency(id) ON DELETE CASCADE      |
| code                | VARCHAR(45)      |                                                  |
| name                | VARCHAR(500)     |                                                  |
| description         | VARCHAR(1000)    |                                                  |
| lat                 | DOUBLE PRECISION |                                                  |
| lon                 | DOUBLE PRECISION |                                                  |
| location_type       | VARCHAR(10)      |                                                  |
| wheelchair_boarding | VARCHAR(10)      |                                                  |

Follows the same composite PK pattern as `route`, `shape`, `trip`.

### `public.stop_time`

| Column         | Type         | Constraints                                             |
|----------------|--------------|---------------------------------------------------------|
| agency_id      | UUID         | NOT NULL, FK → agency(id) ON DELETE CASCADE             |
| trip_id        | VARCHAR(45)  | NOT NULL, FK → trip(agency_id, id) ON DELETE CASCADE    |
| stop_id        | VARCHAR(45)  | NOT NULL, FK → stop(agency_id, id) ON DELETE CASCADE    |
| arrival_time   | VARCHAR(10)  |                                                         |
| departure_time | VARCHAR(10)  |                                                         |
| stop_sequence  | VARCHAR(10)  | NOT NULL                                                |
| pickup_type    | VARCHAR(10)  |                                                         |
| drop_off_type  | VARCHAR(10)  |                                                         |
| timepoint      | VARCHAR(10)  |                                                         |

- PK: `(agency_id, trip_id, stop_id, stop_sequence)`
- Arrival/departure times are `VARCHAR(10)` (not `TIME`) because GTFS allows values past midnight like `25:30:00`.

## 2. Onboarding Pipeline

### Import order

```
agency.txt → routes.txt → shapes.txt → trips.txt → stops.txt → stop_times.txt
```

Stops must exist before stop_times (FK dependency). Trips must exist before stop_times (filtering + FK).

### New handlers in `web/repository/addAgency.js`

**`handleWriteFromStops`** — follows the `handleWriteFromShapes` pattern:
- Parses `stops.txt` from the GTFS static zip
- Maps GTFS columns to DB columns, stripping the `stop_` prefix where it exists (e.g., `stop_name` → `name`, `stop_lat` → `lat`, `stop_code` → `code`, `stop_desc` → `description`). Note: `location_type` and `wheelchair_boarding` have no `stop_` prefix in GTFS — they match the DB column names directly.
- Appends `agency_id` for each agency
- Returns a set of imported stop IDs per agency (needed by `handleWriteFromStopTimes` for filtering)
- Bulk inserts via existing `bulkInsert()` with `BATCH_SIZE = 5000`
- Uses `getFileContents()` for parsing and column validation

**`handleWriteFromStopTimes`** — follows the `handleWriteFromTrip` pattern:
- Parses `stop_times.txt` from the GTFS static zip
- Filters rows to only those where `trip_id` exists in the `trip` table for this agency (same filtering approach trips use for routes)
- Also filters to only `stop_id`s present in the set returned by `handleWriteFromStops` for this agency
- Appends `agency_id`
- Bulk inserts via existing `bulkInsert()`
- Uses `getFileContentsFromTrip()` style parsing (no prefix stripping — columns match DB names directly)

### Service layer changes in `web/service/addAgency.js`

Two new calls added to `onBoardAgency()` after the trip import:

```js
let stopIdsByAgency = await handleWriteFromStops(client, 'stops.txt', 'stop', decompressed, listOfGuid, static_feed_url);
await handleWriteFromStopTimes(client, 'stop_times.txt', 'stop_time', decompressed, listOfGuid, stopIdsByAgency, static_feed_url);
```

All within the existing single transaction per agency.

## 3. API Endpoint for Stops

### `GET /api/stops/:agency_id/:trip_id`

No auth required. Returns stops for a specific trip, ordered by `stop_sequence`.

Joins `stop_time` with `stop` to return both schedule and location data:

```json
[
  {
    "stop_id": "1234",
    "name": "Main St & 1st Ave",
    "code": "S1234",
    "lat": 44.648,
    "lon": -63.573,
    "arrival_time": "08:15:00",
    "departure_time": "08:16:00",
    "stop_sequence": "1",
    "wheelchair_boarding": "1"
  }
]
```

Follows the same pattern as `GET /api/shape/:agency_id/:trip_id`.

## 4. Frontend — Map Stop Markers

### Trigger

When a bus is pinned (same trigger that draws the route polyline), fetch stops in parallel with the shape request.

### Marker style

Small dot markers — white circles with blue border placed along the route at each stop's lat/lon coordinates. Minimal and unobtrusive so the bus marker and route polyline remain visually dominant.

### Marker interaction

- Clicking a stop marker opens a popup showing:
  - Stop name
  - "Scheduled: 08:15 AM" (arrival time, labeled as scheduled)
  - Stop code (if available)
  - Wheelchair accessibility indicator (if available)
- Clicking a stop marker does NOT close the pinned bus popup — both popups can be visible simultaneously
- Stop markers are `atlas.HtmlMarker` instances for consistency with existing bus markers

### Mobile first

- Dot markers must have adequate tap target size for touch interaction
- Stop popups must render well on small screens (responsive width, no overflow)

### Lifecycle

- Stop markers are rendered when a bus is pinned
- Stop markers are cleared when the bus is unpinned (alongside `clearRoute` for the polyline)
- New adapter methods: `updateStopMarkers(stops)` and `clearStopMarkers()`

## 5. Weekly Refresh

### API endpoint: `POST /api/agencies/refresh`

Protected by `authMiddleware` (requires `x-access-key` header).

Logic:
1. `TRUNCATE` all non-agency tables in one statement with CASCADE to handle FK dependencies: `TRUNCATE route, shape, shape_point, trip, stop, stop_time, live_vehicle_position, poll_iteration, feed_execution CASCADE`
2. Fetch all agencies from the `agency` table
3. For each agency, call the existing `onBoardAgency()` with the agency's stored `rt_feed_url`, `static_feed_url`, and `api_key_in_header`
4. Return `200` with a summary: `{ refreshed: <count>, errors: [...] }`

Errors during individual agency re-onboarding are caught and collected — one failing agency does not block the others.

### Daemon trigger (`daemon/main.cpp`)

- On startup, record `last_refresh_timestamp` as the current time
- On each main loop iteration (every 15s), check:
  - Has 7 days elapsed since `last_refresh_timestamp`?
  - Is the current hour 08:00 UTC? (This is a fixed UTC offset targeting ~4 AM Atlantic time. No daylight saving adjustment — 08:00 UTC is 4 AM AST / 5 AM ADT, both acceptable low-traffic windows.)
- When both conditions are met:
  - Make an HTTP POST to `http://<web_host>:3000/api/agencies/refresh` with the `x-access-key` header via libcurl
  - Log the result
  - Update `last_refresh_timestamp` regardless of success/failure (to avoid retry storms)

### Dashboard button (`web/public/dashboard.html`)

- "Refresh All Agencies" button on the dashboard page
- Calls `POST /api/agencies/refresh` with the stored access key from `sessionStorage`
- Shows a spinner/progress indicator during refresh
- Displays success/error result

## 6. Files Changed

| File | Change |
|------|--------|
| `db/schema/init.sql` | Append `CREATE TABLE` for `stop` and `stop_time` |
| `web/repository/addAgency.js` | Add `handleWriteFromStops`, `handleWriteFromStopTimes`, export them |
| `web/service/addAgency.js` | Import and call the two new handlers in `onBoardAgency()` |
| `web/index.js` | Add `GET /api/stops/:agency_id/:trip_id` and `POST /api/agencies/refresh` |
| `web/public/map.html` | Fetch stops on bus pin, render stop markers, handle stop popups |
| `web/public/assets/map-adapter-azure.js` | Add `updateStopMarkers()`, `clearStopMarkers()` to `mapAdapter` |
| `web/public/dashboard.html` | Add "Refresh All Agencies" button |
| `daemon/main.cpp` | Add weekly refresh check + HTTP POST to refresh endpoint |
