# Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trip planning mode to the map page where users set a destination (address or pin) and get optimal transit route options with walking legs, live bus positions, and transfer points.

**Architecture:** Server-side trip planner queries existing `stop`, `stop_time`, `trip`, `route` tables to find direct and transfer routes (up to 2 transfers) scored by total time. Frontend adds a trip mode toggle that swaps the controls panel for a bottom sheet with geocoding input and trip results. Map adapter renders multi-leg trips as colored SVG overlays.

**Tech Stack:** Node.js/Express backend with `pg` pool (existing), Azure Maps Geocoding API (via existing proxy), vanilla JS frontend with Azure Maps SDK v3.

**Spec:** `docs/superpowers/specs/2026-04-25-trip-planner-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `web/repository/tripPlanner.js` | Create | DB queries: nearby stops, route-stop index, transfer stops, live vehicles |
| `web/service/tripPlanner.js` | Create | Trip planning algorithm: scoring, ranking, direct/1-transfer/2-transfer search |
| `web/index.js` | Modify | Add `GET /api/trip-plan/:agency_id` endpoint |
| `web/public/assets/map.css` | Modify | Bottom sheet, trip option cards, destination pin, geocode dropdown styles |
| `web/public/assets/map-adapter-azure.js` | Modify | `setDestinationPin`, `clearDestinationPin`, `drawTripPlan`, `clearTripPlan`, `showTripBuses` |
| `web/public/map.html` | Modify | Trip mode toggle, bottom sheet HTML, geocoding logic, trip result rendering |

---

### Task 1: Repository — DB Queries for Trip Planning

**Files:**
- Create: `web/repository/tripPlanner.js`

This task builds all the database queries the trip planner needs. Each function takes a `pool` instance and returns query results.

- [ ] **Step 1: Create `web/repository/tripPlanner.js` with `getStopsNearPoint`**

```js
// web/repository/tripPlanner.js

/**
 * Returns all stops for an agency within radiusMeters of (lat, lng).
 * Uses Haversine approximation in SQL for speed.
 */
async function getStopsNearPoint(pool, agencyId, lat, lng, radiusMeters) {
    const { rows } = await pool.query(
        `SELECT id, name, code, lat, lon
         FROM public.stop
         WHERE agency_id = $1
           AND lat IS NOT NULL AND lon IS NOT NULL
           AND (
               6371000 * acos(
                   LEAST(1.0, cos(radians($2)) * cos(radians(lat))
                   * cos(radians(lon) - radians($3))
                   + sin(radians($2)) * sin(radians(lat)))
               )
           ) <= $4`,
        [agencyId, lat, lng, radiusMeters]
    );
    return rows;
}

module.exports = { getStopsNearPoint };
```

- [ ] **Step 2: Add `getRouteStopIndex`**

This query joins `stop_time` with `trip` to get every (route, trip, stop, time, sequence) tuple for a set of stop IDs — the core data for the algorithm.

```js
/**
 * For a set of stop IDs, returns all route/trip/time/sequence info.
 * Results grouped by route_id for easy lookup.
 */
async function getRouteStopIndex(pool, agencyId, stopIds) {
    if (!stopIds.length) return [];
    const { rows } = await pool.query(
        `SELECT t.route_id, t.id AS trip_id, t.shape_id,
                st.stop_id, st.arrival_time, st.departure_time,
                st.stop_sequence::int AS stop_sequence
         FROM public.stop_time st
         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
         WHERE st.agency_id = $1
           AND st.stop_id = ANY($2)
         ORDER BY t.route_id, t.id, st.stop_sequence::int`,
        [agencyId, stopIds]
    );
    return rows;
}
```

Add to module.exports.

- [ ] **Step 3: Add `getTransferStops`**

Finds stops served by both of two routes — needed for transfer point detection.

```js
/**
 * Finds stops that are served by both routeId1 and routeId2.
 * Returns stop IDs with their lat/lon and schedule info for both routes.
 */
async function getTransferStops(pool, agencyId, routeId1, routeId2) {
    const { rows } = await pool.query(
        `SELECT DISTINCT st1.stop_id, s.name, s.lat, s.lon
         FROM public.stop_time st1
         JOIN public.trip t1 ON t1.agency_id = st1.agency_id AND t1.id = st1.trip_id
         JOIN public.stop_time st2 ON st2.agency_id = st1.agency_id AND st2.stop_id = st1.stop_id
         JOIN public.trip t2 ON t2.agency_id = st2.agency_id AND t2.id = st2.trip_id
         JOIN public.stop s ON s.agency_id = st1.agency_id AND s.id = st1.stop_id
         WHERE st1.agency_id = $1
           AND t1.route_id = $2
           AND t2.route_id = $3
           AND s.lat IS NOT NULL AND s.lon IS NOT NULL`,
        [agencyId, routeId1, routeId2]
    );
    return rows;
}
```

Add to module.exports.

- [ ] **Step 4: Add `getRouteInfo` and `getLiveVehicle`**

```js
/**
 * Returns route metadata (name, color) for display.
 */
async function getRouteInfo(pool, agencyId, routeId) {
    const { rows } = await pool.query(
        `SELECT id, short_name, long_name, color
         FROM public.route
         WHERE agency_id = $1 AND id = $2`,
        [agencyId, routeId]
    );
    return rows[0] || null;
}

/**
 * Finds the live vehicle for a given trip, if one exists.
 */
async function getLiveVehicle(pool, agencyId, routeId, tripId) {
    const { rows } = await pool.query(
        `SELECT vehicle_id, lat, lon, timestamp
         FROM public.live_vehicle_position
         WHERE agency_id = $1 AND route_id = $2 AND trip_id = $3
         LIMIT 1`,
        [agencyId, routeId, tripId]
    );
    return rows[0] || null;
}

/**
 * Returns all stop times for a specific trip, ordered by sequence.
 */
async function getTripStopTimes(pool, agencyId, tripId) {
    const { rows } = await pool.query(
        `SELECT st.stop_id, st.arrival_time, st.departure_time,
                st.stop_sequence::int AS stop_sequence,
                s.name, s.lat, s.lon
         FROM public.stop_time st
         JOIN public.stop s ON s.agency_id = st.agency_id AND s.id = st.stop_id
         WHERE st.agency_id = $1 AND st.trip_id = $2
         ORDER BY st.stop_sequence::int ASC`,
        [agencyId, tripId]
    );
    return rows;
}
```

Add all three to module.exports. Final exports:

```js
module.exports = {
    getStopsNearPoint,
    getRouteStopIndex,
    getTransferStops,
    getRouteInfo,
    getLiveVehicle,
    getTripStopTimes,
};
```

- [ ] **Step 5: Commit**

```bash
git add web/repository/tripPlanner.js
git commit -m "feat(trip-planner): add repository layer with DB queries for trip planning"
```

---

### Task 2: Service — Trip Planning Algorithm (Helpers + Direct Routes)

**Files:**
- Create: `web/service/tripPlanner.js`

Build the trip planner service incrementally. This task covers helper functions and direct (0-transfer) route search.

- [ ] **Step 1: Create `web/service/tripPlanner.js` with helper functions**

```js
// web/service/tripPlanner.js
const repo = require('../repository/tripPlanner');

const WALK_SPEED_MS = 5000 / 3600; // 5 km/h in m/s
const MANHATTAN_FACTOR = 1.4;
const DEFAULT_RADIUS = 800;
const EXPANDED_RADIUS = 1500;
const TWO_XFER_PRUNE_RADIUS = 2000; // heuristic: skip R2 if no stops within 2km of dest

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate walking time in seconds using Manhattan-adjusted distance.
 */
function estimateWalkSeconds(lat1, lng1, lat2, lng2) {
    const dist = haversineMeters(lat1, lng1, lat2, lng2) * MANHATTAN_FACTOR;
    return Math.round(dist / WALK_SPEED_MS);
}

/**
 * Parse GTFS time string (HH:MM:SS, may exceed 24:00) to seconds since midnight.
 */
function gtfsTimeToSeconds(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2] || '0', 10);
}

/**
 * Convert current UTC time to seconds-since-midnight in the given IANA timezone.
 */
function nowAsSeconds(timezone) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false,
    }).formatToParts(now);
    const get = type => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    return get('hour') * 3600 + get('minute') * 60 + get('second');
}

module.exports = { haversineMeters, estimateWalkSeconds, gtfsTimeToSeconds, nowAsSeconds };
```

- [ ] **Step 2: Add `findNearbyStops` — handles radius expansion**

```js
/**
 * Find stops near a point. If none found within DEFAULT_RADIUS, expands to EXPANDED_RADIUS.
 */
async function findNearbyStops(pool, agencyId, lat, lng) {
    let stops = await repo.getStopsNearPoint(pool, agencyId, lat, lng, DEFAULT_RADIUS);
    if (!stops.length) {
        stops = await repo.getStopsNearPoint(pool, agencyId, lat, lng, EXPANDED_RADIUS);
    }
    return stops;
}
```

Add to module.exports.

- [ ] **Step 3: Add `findDirectRoutes` — 0-transfer search**

```js
/**
 * Find direct routes from origin to destination.
 * Returns scored trip options with walk + ride + walk legs.
 */
async function findDirectRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    const nearBIds = new Set(stopsNearB.map(s => s.id));

    // Group index by route_id
    const byRoute = {};
    for (const row of routeStopIndex) {
        if (!byRoute[row.route_id]) byRoute[row.route_id] = [];
        byRoute[row.route_id].push(row);
    }

    const results = [];

    for (const [routeId, entries] of Object.entries(byRoute)) {
        // Does this route serve at least one stop near A AND one near B?
        const hasA = entries.some(e => nearAIds.has(e.stop_id));
        const hasB = entries.some(e => nearBIds.has(e.stop_id));
        if (!hasA || !hasB) continue;

        // Group by trip_id
        const byTrip = {};
        for (const e of entries) {
            if (!byTrip[e.trip_id]) byTrip[e.trip_id] = [];
            byTrip[e.trip_id].push(e);
        }

        for (const [tripId, tripEntries] of Object.entries(byTrip)) {
            // Find board stops (near A) and alight stops (near B)
            const boardCandidates = tripEntries.filter(e => nearAIds.has(e.stop_id));
            const alightCandidates = tripEntries.filter(e => nearBIds.has(e.stop_id));

            for (const board of boardCandidates) {
                const depSecs = gtfsTimeToSeconds(board.departure_time);
                if (depSecs === null || depSecs < nowSecs) continue; // already passed

                for (const alight of alightCandidates) {
                    if (alight.stop_sequence <= board.stop_sequence) continue; // wrong direction

                    const arrSecs = gtfsTimeToSeconds(alight.arrival_time);
                    if (arrSecs === null) continue;

                    const boardStop = stopsNearA.find(s => s.id === board.stop_id);
                    const alightStop = stopsNearB.find(s => s.id === alight.stop_id);

                    const walkToBoard = estimateWalkSeconds(origin.lat, origin.lng, boardStop.lat, boardStop.lon);
                    const waitTime = Math.max(0, depSecs - nowSecs - walkToBoard);
                    const rideTime = arrSecs - depSecs;
                    const walkFromAlight = estimateWalkSeconds(alightStop.lat, alightStop.lon, dest.lat, dest.lng);
                    const totalTime = walkToBoard + waitTime + rideTime + walkFromAlight;

                    results.push({
                        totalTime,
                        totalWalkTime: walkToBoard + walkFromAlight,
                        totalRideTime: rideTime,
                        waitTime,
                        transfers: 0,
                        legs: [
                            {
                                type: 'walk',
                                from: { lat: origin.lat, lng: origin.lng, name: 'Your location' },
                                to: { lat: boardStop.lat, lng: boardStop.lon, name: boardStop.name },
                                distanceMeters: Math.round(haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR),
                                durationSeconds: walkToBoard,
                            },
                            {
                                type: 'bus',
                                routeId,
                                tripId,
                                shapeId: board.shape_id,
                                boardStop: { id: board.stop_id, name: boardStop.name, lat: boardStop.lat, lng: boardStop.lon },
                                alightStop: { id: alight.stop_id, name: alightStop.name, lat: alightStop.lat, lng: alightStop.lon },
                                boardTime: board.departure_time,
                                alightTime: alight.arrival_time,
                                boardSequence: board.stop_sequence,
                                alightSequence: alight.stop_sequence,
                            },
                            {
                                type: 'walk',
                                from: { lat: alightStop.lat, lng: alightStop.lon, name: alightStop.name },
                                to: { lat: dest.lat, lng: dest.lng, name: 'Destination' },
                                distanceMeters: Math.round(haversineMeters(alightStop.lat, alightStop.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR),
                                durationSeconds: walkFromAlight,
                            },
                        ],
                    });
                }
            }
        }
    }

    return results;
}
```

Add to module.exports.

- [ ] **Step 4: Commit**

```bash
git add web/service/tripPlanner.js
git commit -m "feat(trip-planner): add service layer with helpers and direct route search"
```

---

### Task 3: Service — 1-Transfer and 2-Transfer Search

**Files:**
- Modify: `web/service/tripPlanner.js`

- [ ] **Step 1: Add `findOneTransferRoutes`**

```js
/**
 * Find 1-transfer routes: R1 from near A → transfer stop → R2 to near B.
 */
async function findOneTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    const nearBIds = new Set(stopsNearB.map(s => s.id));

    // Routes serving stops near A and near B
    const routesNearA = new Set();
    const routesNearB = new Set();
    for (const row of routeStopIndex) {
        if (nearAIds.has(row.stop_id)) routesNearA.add(row.route_id);
        if (nearBIds.has(row.stop_id)) routesNearB.add(row.route_id);
    }

    const results = [];

    for (const r1 of routesNearA) {
        for (const r2 of routesNearB) {
            if (r1 === r2) continue; // direct route, handled elsewhere

            const transferStops = await repo.getTransferStops(pool, agencyId, r1, r2);
            if (!transferStops.length) continue;

            // Get full stop times for promising trip pairs
            const r1Entries = routeStopIndex.filter(e => e.route_id === r1 && nearAIds.has(e.stop_id));
            const r2Entries = routeStopIndex.filter(e => e.route_id === r2 && nearBIds.has(e.stop_id));

            // Group by trip
            const r1ByTrip = {};
            for (const e of r1Entries) {
                if (!r1ByTrip[e.trip_id]) r1ByTrip[e.trip_id] = [];
                r1ByTrip[e.trip_id].push(e);
            }

            for (const xferStop of transferStops) {
                // For each R1 trip, find boarding near A and arrival at transfer
                for (const [trip1Id, trip1Boards] of Object.entries(r1ByTrip)) {
                    const trip1Full = await repo.getTripStopTimes(pool, agencyId, trip1Id);
                    const xferArrival = trip1Full.find(s => s.stop_id === xferStop.stop_id);
                    if (!xferArrival) continue;

                    for (const board of trip1Boards) {
                        if (xferArrival.stop_sequence <= board.stop_sequence) continue;
                        const depSecs = gtfsTimeToSeconds(board.departure_time);
                        if (depSecs === null || depSecs < nowSecs) continue;

                        const xferArrSecs = gtfsTimeToSeconds(xferArrival.arrival_time);
                        if (xferArrSecs === null) continue;

                        // Find an R2 trip departing from transfer stop after R1 arrives
                        for (const r2Entry of r2Entries) {
                            const trip2Full = await repo.getTripStopTimes(pool, agencyId, r2Entry.trip_id);
                            const xferDep = trip2Full.find(s => s.stop_id === xferStop.stop_id);
                            if (!xferDep) continue;

                            const xferDepSecs = gtfsTimeToSeconds(xferDep.departure_time);
                            if (xferDepSecs === null || xferDepSecs < xferArrSecs) continue;

                            const alightEntry = trip2Full.find(s => nearBIds.has(s.stop_id) && s.stop_sequence > xferDep.stop_sequence);
                            if (!alightEntry) continue;

                            const boardStop = stopsNearA.find(s => s.id === board.stop_id);
                            const alightStop = stopsNearB.find(s => s.id === alightEntry.stop_id);

                            const walkToBoard = estimateWalkSeconds(origin.lat, origin.lng, boardStop.lat, boardStop.lon);
                            const waitTime = Math.max(0, depSecs - nowSecs - walkToBoard);
                            const ride1 = xferArrSecs - depSecs;
                            const xferWait = xferDepSecs - xferArrSecs;
                            const ride2 = gtfsTimeToSeconds(alightEntry.arrival_time) - xferDepSecs;
                            const walkFromAlight = estimateWalkSeconds(alightStop.lat, alightStop.lon, dest.lat, dest.lng);
                            const totalTime = walkToBoard + waitTime + ride1 + xferWait + ride2 + walkFromAlight;

                            results.push({
                                totalTime,
                                totalWalkTime: walkToBoard + walkFromAlight,
                                totalRideTime: ride1 + ride2,
                                waitTime: waitTime + xferWait,
                                transfers: 1,
                                legs: [
                                    { type: 'walk', from: { lat: origin.lat, lng: origin.lng, name: 'Your location' }, to: { lat: boardStop.lat, lng: boardStop.lon, name: boardStop.name }, distanceMeters: Math.round(haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR), durationSeconds: walkToBoard },
                                    { type: 'bus', routeId: r1, tripId: trip1Id, shapeId: board.shape_id, boardStop: { id: board.stop_id, name: boardStop.name, lat: boardStop.lat, lng: boardStop.lon }, alightStop: { id: xferStop.stop_id, name: xferStop.name, lat: xferStop.lat, lng: xferStop.lon }, boardTime: board.departure_time, alightTime: xferArrival.arrival_time, boardSequence: board.stop_sequence, alightSequence: xferArrival.stop_sequence },
                                    { type: 'bus', routeId: r2, tripId: r2Entry.trip_id, shapeId: r2Entry.shape_id, boardStop: { id: xferStop.stop_id, name: xferStop.name, lat: xferStop.lat, lng: xferStop.lon }, alightStop: { id: alightEntry.stop_id, name: alightStop.name, lat: alightStop.lat, lng: alightStop.lon }, boardTime: xferDep.departure_time, alightTime: alightEntry.arrival_time, boardSequence: xferDep.stop_sequence, alightSequence: alightEntry.stop_sequence },
                                    { type: 'walk', from: { lat: alightStop.lat, lng: alightStop.lon, name: alightStop.name }, to: { lat: dest.lat, lng: dest.lng, name: 'Destination' }, distanceMeters: Math.round(haversineMeters(alightStop.lat, alightStop.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR), durationSeconds: walkFromAlight },
                                ],
                            });
                        }
                    }
                }
            }
        }
    }

    return results;
}
```

Add to module.exports.

- [ ] **Step 2: Add `findTwoTransferRoutes`**

```js
/**
 * Find 2-transfer routes: R1 → T1 → R2 → T2 → R3.
 * Prunes aggressively — skips if cumulative time exceeds bestSoFar.
 */
async function findTwoTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs, bestSoFar) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    const nearBIds = new Set(stopsNearB.map(s => s.id));
    const results = [];

    // All routes serving stops near A
    const routesNearA = new Set();
    for (const row of routeStopIndex) {
        if (nearAIds.has(row.stop_id)) routesNearA.add(row.route_id);
    }

    for (const r1 of routesNearA) {
        // Get all trips on R1 with boarding near A
        const r1Boards = routeStopIndex.filter(e => e.route_id === r1 && nearAIds.has(e.stop_id));
        const r1TripIds = [...new Set(r1Boards.map(e => e.trip_id))];

        for (const trip1Id of r1TripIds) {
            const trip1Stops = await repo.getTripStopTimes(pool, agencyId, trip1Id);
            const boardEntry = r1Boards.find(e => e.trip_id === trip1Id);
            if (!boardEntry) continue;

            const depSecs = gtfsTimeToSeconds(boardEntry.departure_time);
            if (depSecs === null || depSecs < nowSecs) continue;

            const boardStop = stopsNearA.find(s => s.id === boardEntry.stop_id);
            const walkToBoard = estimateWalkSeconds(origin.lat, origin.lng, boardStop.lat, boardStop.lon);

            // Check stops on R1 beyond boarding as potential T1
            const t1Candidates = trip1Stops.filter(s => s.stop_sequence > boardEntry.stop_sequence);

            for (const t1 of t1Candidates) {
                const t1ArrSecs = gtfsTimeToSeconds(t1.arrival_time);
                if (t1ArrSecs === null) continue;
                const cumTime1 = walkToBoard + (t1ArrSecs - depSecs);
                if (cumTime1 > bestSoFar) continue; // prune

                // Find all routes serving T1 (excluding R1)
                const { rows: r2Candidates } = await pool.query(
                    `SELECT DISTINCT t.route_id
                     FROM public.stop_time st
                     JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                     WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id != $3`,
                    [agencyId, t1.stop_id, r1]
                );

                for (const { route_id: r2 } of r2Candidates) {
                    // Prune: skip R2 if no stops within pruning radius of destination
                    const r2StopsNearDest = await repo.getStopsNearPoint(pool, agencyId, dest.lat, dest.lng, TWO_XFER_PRUNE_RADIUS);
                    const r2StopIds = new Set(r2StopsNearDest.map(s => s.id));

                    // Find R3 routes: need transfer from R2 to R3, then R3 to near B
                    // Get R2 trips departing T1 after R1 arrives
                    const r2Trips = await pool.query(
                        `SELECT DISTINCT st.trip_id
                         FROM public.stop_time st
                         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                         WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id = $3
                           AND st.departure_time IS NOT NULL`,
                        [agencyId, t1.stop_id, r2]
                    );

                    for (const { trip_id: trip2Id } of r2Trips.rows) {
                        const trip2Stops = await repo.getTripStopTimes(pool, agencyId, trip2Id);
                        const t1Dep = trip2Stops.find(s => s.stop_id === t1.stop_id);
                        if (!t1Dep) continue;
                        const t1DepSecs = gtfsTimeToSeconds(t1Dep.departure_time);
                        if (t1DepSecs === null || t1DepSecs < t1ArrSecs) continue;

                        // Check each stop on R2 beyond T1 as potential T2
                        const t2Candidates = trip2Stops.filter(s => s.stop_sequence > t1Dep.stop_sequence);

                        for (const t2 of t2Candidates) {
                            const t2ArrSecs = gtfsTimeToSeconds(t2.arrival_time);
                            if (t2ArrSecs === null) continue;
                            const cumTime2 = cumTime1 + (t1DepSecs - t1ArrSecs) + (t2ArrSecs - t1DepSecs);
                            if (cumTime2 > bestSoFar) continue; // prune

                            // Find R3 serving T2 and a stop near B
                            const routesNearB = new Set();
                            for (const row of routeStopIndex) {
                                if (nearBIds.has(row.stop_id)) routesNearB.add(row.route_id);
                            }

                            const r3Candidates = await pool.query(
                                `SELECT DISTINCT t.route_id
                                 FROM public.stop_time st
                                 JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                                 WHERE st.agency_id = $1 AND st.stop_id = $2
                                   AND t.route_id != $3 AND t.route_id != $4`,
                                [agencyId, t2.stop_id, r1, r2]
                            );

                            for (const { route_id: r3 } of r3Candidates.rows) {
                                if (!routesNearB.has(r3)) continue;

                                // Find R3 trip from T2 to near B
                                const r3Trips = await pool.query(
                                    `SELECT DISTINCT st.trip_id
                                     FROM public.stop_time st
                                     JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                                     WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id = $3`,
                                    [agencyId, t2.stop_id, r3]
                                );

                                for (const { trip_id: trip3Id } of r3Trips.rows) {
                                    const trip3Stops = await repo.getTripStopTimes(pool, agencyId, trip3Id);
                                    const t2Dep = trip3Stops.find(s => s.stop_id === t2.stop_id);
                                    if (!t2Dep) continue;
                                    const t2DepSecs = gtfsTimeToSeconds(t2Dep.departure_time);
                                    if (t2DepSecs === null || t2DepSecs < t2ArrSecs) continue;

                                    const alightEntry = trip3Stops.find(s => nearBIds.has(s.stop_id) && s.stop_sequence > t2Dep.stop_sequence);
                                    if (!alightEntry) continue;

                                    const alightSecs = gtfsTimeToSeconds(alightEntry.arrival_time);
                                    if (alightSecs === null) continue;

                                    const alightStop = stopsNearB.find(s => s.id === alightEntry.stop_id);
                                    const walkFromAlight = estimateWalkSeconds(alightStop.lat, alightStop.lon, dest.lat, dest.lng);
                                    const totalTime = walkToBoard + (depSecs > nowSecs + walkToBoard ? depSecs - nowSecs - walkToBoard : 0)
                                        + (t1ArrSecs - depSecs)
                                        + (t1DepSecs - t1ArrSecs)
                                        + (t2ArrSecs - t1DepSecs)
                                        + (t2DepSecs - t2ArrSecs)
                                        + (alightSecs - t2DepSecs)
                                        + walkFromAlight;

                                    if (totalTime > bestSoFar) continue;

                                    results.push({
                                        totalTime,
                                        totalWalkTime: walkToBoard + walkFromAlight,
                                        totalRideTime: (t1ArrSecs - depSecs) + (t2ArrSecs - t1DepSecs) + (alightSecs - t2DepSecs),
                                        waitTime: totalTime - walkToBoard - walkFromAlight - (t1ArrSecs - depSecs) - (t2ArrSecs - t1DepSecs) - (alightSecs - t2DepSecs),
                                        transfers: 2,
                                        legs: [
                                            { type: 'walk', from: { lat: origin.lat, lng: origin.lng, name: 'Your location' }, to: { lat: boardStop.lat, lng: boardStop.lon, name: boardStop.name }, distanceMeters: Math.round(haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR), durationSeconds: walkToBoard },
                                            { type: 'bus', routeId: r1, tripId: trip1Id, shapeId: boardEntry.shape_id, boardStop: { id: boardEntry.stop_id, name: boardStop.name, lat: boardStop.lat, lng: boardStop.lon }, alightStop: { id: t1.stop_id, name: t1.name, lat: t1.lat, lng: t1.lon }, boardTime: boardEntry.departure_time, alightTime: t1.arrival_time, boardSequence: boardEntry.stop_sequence, alightSequence: t1.stop_sequence },
                                            { type: 'bus', routeId: r2, tripId: trip2Id, shapeId: null, boardStop: { id: t1.stop_id, name: t1.name, lat: t1.lat, lng: t1.lon }, alightStop: { id: t2.stop_id, name: t2.name, lat: t2.lat, lng: t2.lon }, boardTime: t1Dep.departure_time, alightTime: t2.arrival_time, boardSequence: t1Dep.stop_sequence, alightSequence: t2.stop_sequence },
                                            { type: 'bus', routeId: r3, tripId: trip3Id, shapeId: null, boardStop: { id: t2.stop_id, name: t2.name, lat: t2.lat, lng: t2.lon }, alightStop: { id: alightEntry.stop_id, name: alightStop.name, lat: alightStop.lat, lng: alightStop.lon }, boardTime: t2Dep.departure_time, alightTime: alightEntry.arrival_time, boardSequence: t2Dep.stop_sequence, alightSequence: alightEntry.stop_sequence },
                                            { type: 'walk', from: { lat: alightStop.lat, lng: alightStop.lon, name: alightStop.name }, to: { lat: dest.lat, lng: dest.lng, name: 'Destination' }, distanceMeters: Math.round(haversineMeters(alightStop.lat, alightStop.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR), durationSeconds: walkFromAlight },
                                        ],
                                    });
                                    bestSoFar = Math.min(bestSoFar, totalTime);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return results;
}
```

Add to module.exports.

- [ ] **Step 3: Commit**

```bash
git add web/service/tripPlanner.js
git commit -m "feat(trip-planner): add 1-transfer and 2-transfer route search"
```

---

### Task 4: Service — Orchestrator, Ranking, and Label Assignment

**Files:**
- Modify: `web/service/tripPlanner.js`

- [ ] **Step 1: Add `planTrip` — the main orchestrator function**

This is the public entry point. It runs the search, ranks results, assigns labels, and attaches live vehicle info.

```js
/**
 * Main entry point: plan a trip from origin to destination for an agency.
 * Returns top 3 scored options with labels and live vehicle info.
 */
async function planTrip(pool, agencyId, originLat, originLng, destLat, destLng) {
    // Get agency timezone
    const { rows: agencyRows } = await pool.query(
        'SELECT timezone FROM public.agency WHERE id = $1', [agencyId]
    );
    if (!agencyRows.length) throw new Error('Agency not found');
    const timezone = agencyRows[0].timezone || 'America/Halifax';
    const nowSecs = nowAsSeconds(timezone);

    const origin = { lat: originLat, lng: originLng };
    const dest = { lat: destLat, lng: destLng };

    // Step 1: Find nearby stops
    const stopsNearA = await findNearbyStops(pool, agencyId, origin.lat, origin.lng);
    const stopsNearB = await findNearbyStops(pool, agencyId, dest.lat, dest.lng);

    if (!stopsNearA.length || !stopsNearB.length) {
        return { options: [], error: 'No transit stops found near origin or destination' };
    }

    // Step 2: Build route-stop index
    const allStopIds = [...new Set([...stopsNearA.map(s => s.id), ...stopsNearB.map(s => s.id)])];
    const routeStopIndex = await repo.getRouteStopIndex(pool, agencyId, allStopIds);

    // Steps 3-5: Search
    const direct = await findDirectRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs);
    const oneXfer = await findOneTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs);

    let allResults = [...direct, ...oneXfer];
    const bestSoFar = allResults.length ? Math.min(...allResults.map(r => r.totalTime)) : Infinity;

    const twoXfer = await findTwoTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs, bestSoFar);
    allResults = [...allResults, ...twoXfer];

    if (!allResults.length) {
        return { options: [], error: 'No routes found for this trip' };
    }

    // Step 6: Rank and deduplicate
    allResults.sort((a, b) => a.totalTime - b.totalTime);

    // Deduplicate: keep only one option per unique set of route IDs
    const seen = new Set();
    const unique = [];
    for (const r of allResults) {
        const key = r.legs.filter(l => l.type === 'bus').map(l => l.routeId + ':' + l.tripId).join('|');
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(r);
        }
    }

    const top3 = unique.slice(0, 3);

    // Assign labels
    if (top3.length > 0) top3[0].label = 'Best';
    for (let i = 1; i < top3.length; i++) {
        const opt = top3[i];
        if (opt.transfers < top3[0].transfers) opt.label = 'Fewer transfers';
        else if (opt.transfers === 0 && top3[0].transfers > 0) opt.label = 'Direct route';
        else if (opt.totalWalkTime < top3[0].totalWalkTime) opt.label = 'Less walking';
        else if (opt.totalWalkTime > top3[0].totalWalkTime) opt.label = 'More walking';
        else opt.label = opt.transfers < top3[0].transfers ? 'Fewer transfers' : 'Alternative';
    }

    // Step 7: Attach route info and live vehicles
    for (const opt of top3) {
        for (const leg of opt.legs) {
            if (leg.type !== 'bus') continue;
            const routeInfo = await repo.getRouteInfo(pool, agencyId, leg.routeId);
            if (routeInfo) {
                leg.routeName = routeInfo.long_name || routeInfo.short_name || leg.routeId;
                leg.routeColor = routeInfo.color ? '#' + routeInfo.color.replace(/^#/, '') : null;
            }
            const numStopsResult = await pool.query(
                `SELECT COUNT(*)::int AS cnt FROM public.stop_time
                 WHERE agency_id = $1 AND trip_id = $2
                   AND stop_sequence::int >= $3 AND stop_sequence::int <= $4`,
                [agencyId, leg.tripId, leg.boardSequence, leg.alightSequence]
            );
            leg.numStops = numStopsResult.rows[0]?.cnt || 0;

            const live = await repo.getLiveVehicle(pool, agencyId, leg.routeId, leg.tripId);
            leg.vehicleId = live?.vehicle_id || null;
        }
    }

    return { options: top3 };
}
```

Add `planTrip` to module.exports.

- [ ] **Step 2: Commit**

```bash
git add web/service/tripPlanner.js
git commit -m "feat(trip-planner): add orchestrator with ranking and live vehicle attachment"
```

---

### Task 5: Backend — API Endpoint

**Files:**
- Modify: `web/index.js`

- [ ] **Step 1: Add the `/api/trip-plan/:agency_id` route**

Add this before the `app.listen()` call at the bottom of `web/index.js`:

```js
const { planTrip } = require('./service/tripPlanner');

app.get('/api/trip-plan/:agency_id', async (req, res) => {
    const { agency_id } = req.params;
    const { originLat, originLng, destLat, destLng } = req.query;

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: 'Missing required query params: originLat, originLng, destLat, destLng' });
    }

    try {
        const result = await planTrip(
            pool, agency_id,
            parseFloat(originLat), parseFloat(originLng),
            parseFloat(destLat), parseFloat(destLng)
        );
        res.json(result);
    } catch (err) {
        console.error('[trip-plan]', err);
        res.status(500).json({ error: 'Trip planning failed' });
    }
});
```

- [ ] **Step 2: Verify the server starts**

Run: `npm run dev`

Expected: Server starts on port 3000 with no errors. The new endpoint should respond to `GET /api/trip-plan/...` (will return empty options without valid agency data, which is correct).

- [ ] **Step 3: Commit**

```bash
git add web/index.js
git commit -m "feat(trip-planner): add GET /api/trip-plan/:agency_id endpoint"
```

---

### Task 6: Frontend CSS — Bottom Sheet, Trip Cards, Destination Pin

**Files:**
- Modify: `web/public/assets/map.css`

- [ ] **Step 1: Add bottom sheet styles**

Append to the end of `map.css`:

```css
/* ── Trip planning bottom sheet ── */
#trip-sheet {
    display: none;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: var(--surface);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -2px 12px rgba(0,0,0,0.15);
    padding: 12px 14px;
    padding-bottom: max(16px, env(safe-area-inset-bottom, 16px));
    max-height: 65vh;
    overflow-y: auto;
    transition: transform 0.25s ease;
}
#trip-sheet.open { display: block; }

#trip-sheet-handle {
    width: 36px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 0 auto 10px;
}

#trip-sheet-title {
    font-weight: 700;
    font-size: 0.9rem;
    margin-bottom: 10px;
    color: var(--text);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.trip-origin-row,
.trip-dest-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
}

.trip-origin-pill {
    flex: 1;
    padding: 6px 10px;
    background: rgba(41,121,255,0.08);
    border: 1px solid #2979ff;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #2979ff;
}

#trip-dest-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.8rem;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
}
#trip-dest-input:focus {
    outline: none;
    border-color: var(--accent);
}

#trip-dest-pin-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-alt, rgba(128,128,128,0.1));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    cursor: pointer;
}
#trip-dest-pin-btn:hover { border-color: var(--accent); }
```

- [ ] **Step 2: Add geocode dropdown and trip option card styles**

```css
/* ── Geocode dropdown ── */
#geocode-dropdown {
    position: absolute;
    left: 14px;
    right: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1001;
    display: none;
    max-height: 200px;
    overflow-y: auto;
}
#geocode-dropdown.open { display: block; }
.geocode-item {
    padding: 8px 12px;
    font-size: 0.78rem;
    color: var(--text);
    cursor: pointer;
    border-bottom: 1px solid var(--border);
}
.geocode-item:last-child { border-bottom: none; }
.geocode-item:hover { background: var(--surface-alt, rgba(128,128,128,0.08)); }

/* ── Trip option cards ── */
.trip-summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 0.78rem;
    color: var(--text-muted);
}
.trip-summary-row a {
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
    font-size: 0.72rem;
}

.trip-option {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
}
.trip-option:hover { border-color: var(--accent); }
.trip-option.selected {
    border: 2px solid #2979ff;
    background: rgba(41,121,255,0.04);
}

.trip-option-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.trip-option-time {
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text);
}
.trip-option-label {
    font-size: 0.72rem;
    color: var(--text-muted);
}

.trip-option-legs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    font-size: 0.75rem;
    flex-wrap: wrap;
}
.trip-option-legs .walk { color: var(--text-muted); }
.trip-option-legs .arrow { color: #ccc; }

.trip-leg-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.7rem;
    color: #fff;
    font-weight: 600;
}

.trip-option-details {
    display: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.7;
}
.trip-option.selected .trip-option-details { display: block; }

/* ── Trip controls ── */
.trip-show-all {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--text-muted);
}

#trip-loading {
    text-align: center;
    padding: 16px 0;
    color: var(--text-muted);
    font-size: 0.8rem;
}
#trip-loading .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid #2979ff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Destination pin (green teardrop) ── */
.dest-pin {
    width: 24px;
    height: 34px;
    position: relative;
    cursor: grab;
}
.dest-pin:active { cursor: grabbing; }
.dest-pin::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: 24px;
    height: 24px;
    background: #2e7d32;
    border: 2.5px solid #fff;
    border-radius: 50% 50% 50% 0;
    transform: translateX(-50%) rotate(-45deg);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
}
.dest-pin::after {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 8px;
    background: #fff;
    border-radius: 50%;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/public/assets/map.css
git commit -m "feat(trip-planner): add CSS for bottom sheet, trip cards, destination pin"
```

---

### Task 7: Map Adapter — Destination Pin and Trip Plan Rendering

**Files:**
- Modify: `web/public/assets/map-adapter-azure.js`

- [ ] **Step 1: Add destination pin state variables**

At the top of the IIFE, after `let _locDragHandler = null;`, add:

```js
    let _destMarker = null;      // atlas.HtmlMarker — destination pin
    let _destDragHandler = null;  // stored dragend handler for destination pin

    // Trip plan overlays
    let _tripSvgs = [];          // array of { svg, coords, updateFn } for multi-leg SVG overlays
    let _tripMarkers = [];       // array of atlas.HtmlMarker for trip stops
```

- [ ] **Step 2: Add `setDestinationPin` and `clearDestinationPin` to the public API**

Add after the `dropLocationPin` method:

```js
        setDestinationPin: function (lat, lng, onDragEnd) {
            _whenReady(function () {
                if (_destMarker) {
                    if (_destDragHandler) {
                        _map.events.remove('dragend', _destMarker, _destDragHandler);
                        _destDragHandler = null;
                    }
                    _map.markers.remove(_destMarker);
                    _destMarker = null;
                }

                _destMarker = new atlas.HtmlMarker({
                    htmlContent: '<div class="dest-pin"></div>',
                    position: [lng, lat],
                    anchor: 'bottom',
                    draggable: true,
                });
                _map.markers.add(_destMarker);

                _destDragHandler = function () {
                    var pos = _destMarker.getOptions().position;
                    if (onDragEnd) onDragEnd(pos[1], pos[0]);
                };
                _map.events.add('dragend', _destMarker, _destDragHandler);
            });
        },

        clearDestinationPin: function () {
            _whenReady(function () {
                if (_destMarker) {
                    if (_destDragHandler) {
                        _map.events.remove('dragend', _destMarker, _destDragHandler);
                        _destDragHandler = null;
                    }
                    _map.markers.remove(_destMarker);
                    _destMarker = null;
                }
            });
        },
```

- [ ] **Step 3: Add `drawTripPlan` and `clearTripPlan`**

These render multi-leg trips as colored SVG overlays (walking = green dashed, bus = colored solid).

```js
        drawTripPlan: function (legs) {
            var self = this;
            _whenReady(function () {
                self.clearTripPlan();

                // Color palette for bus legs when route has no color
                var palette = ['#1558d0', '#e53935', '#2e7d32', '#f57c00', '#7b1fa2'];
                var busIndex = 0;

                legs.forEach(function (leg) {
                    if (leg.type === 'walk' && leg.walkPath && leg.walkPath.length >= 2) {
                        // Walking leg — green dashed SVG
                        var walkCoords = leg.walkPath.map(function (p) { return [p.lng, p.lat]; });
                        var svg = _createColoredSvg(walkCoords, '#2e7d32', true);
                        _tripSvgs.push(svg);
                    } else if (leg.type === 'bus' && leg.shapePath && leg.shapePath.length >= 2) {
                        // Bus leg — colored solid SVG
                        var color = leg.routeColor || palette[busIndex % palette.length];
                        busIndex++;
                        var busCoords = leg.shapePath.map(function (p) { return [p.lon, p.lat]; });
                        var svg = _createColoredSvg(busCoords, color, false);
                        _tripSvgs.push(svg);

                        // Board stop marker
                        var boardMarker = new atlas.HtmlMarker({
                            htmlContent: '<div class="stop-dot" style="--dot-color:' + color + '"></div>',
                            position: [leg.boardStop.lng, leg.boardStop.lat],
                            anchor: 'center',
                        });
                        _map.markers.add(boardMarker);
                        _tripMarkers.push(boardMarker);

                        // Alight stop marker
                        var alightMarker = new atlas.HtmlMarker({
                            htmlContent: '<div class="stop-dot" style="--dot-color:' + color + '"></div>',
                            position: [leg.alightStop.lng, leg.alightStop.lat],
                            anchor: 'center',
                        });
                        _map.markers.add(alightMarker);
                        _tripMarkers.push(alightMarker);
                    }
                });
            });
        },

        clearTripPlan: function () {
            _whenReady(function () {
                _tripSvgs.forEach(function (entry) {
                    if (entry.svg) {
                        _map.events.remove('move', entry.updateFn);
                        entry.svg.remove();
                    }
                });
                _tripSvgs = [];
                _tripMarkers.forEach(function (m) { _map.markers.remove(m); });
                _tripMarkers = [];
            });
        },
```

- [ ] **Step 4: Add `_createColoredSvg` private helper**

Add this near the existing `_createRouteSvg` function:

```js
    function _createColoredSvg(coords, color, dashed) {
        var svg = _svgEl('svg', {});
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

        var base = _svgEl('path', { fill: 'none', stroke: color, 'stroke-width': '4', 'stroke-opacity': dashed ? '0.4' : '0.7', class: 'trip-leg-base' });

        svg.appendChild(base);

        if (dashed) {
            var dash = _svgEl('path', { fill: 'none', stroke: color, 'stroke-width': '4', 'stroke-dasharray': '12 8', class: 'trip-leg-dash' });
            dash.style.animation = 'dash-flow 1.8s linear infinite';
            svg.appendChild(dash);
        }

        var container = _map.getCanvasContainer();
        var markerContainer = container.querySelector('.marker-collection-container');
        if (markerContainer) { container.insertBefore(svg, markerContainer); }
        else { container.appendChild(svg); }

        function update() {
            var pixels = _map.positionsToPixels(coords);
            if (!pixels || pixels.length < 2) return;
            var d = 'M ' + pixels.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L ');
            base.setAttribute('d', d);
            if (dashed) svg.querySelector('.trip-leg-dash').setAttribute('d', d);
        }

        _map.events.add('move', update);
        update();

        return { svg: svg, coords: coords, updateFn: update };
    }
```

- [ ] **Step 5: Add `showTripBuses`**

```js
        showTripBuses: function (vehicles, pinnedVehicleIds) {
            // Reuses existing updateBusMarkers but filters to specific vehicles
            _whenReady(function () {
                // Clear existing bus markers
                Object.keys(_busMarkerMap).forEach(function (id) {
                    _map.markers.remove(_busMarkerMap[id].marker);
                    _busMarkerMap[id].popup.close();
                    delete _busMarkerMap[id];
                });
                _busMarkerMap = {};
            });
            // Then call updateBusMarkers with filtered set
            var pinnedId = pinnedVehicleIds && pinnedVehicleIds.length ? pinnedVehicleIds[0] : null;
            this.updateBusMarkers(vehicles, pinnedId, null, null);
        },
```

- [ ] **Step 6: Commit**

```bash
git add web/public/assets/map-adapter-azure.js
git commit -m "feat(trip-planner): add destination pin, trip plan rendering, and trip bus display"
```

---

### Task 8: Frontend — Trip Mode Toggle and Bottom Sheet HTML

**Files:**
- Modify: `web/public/map.html`

- [ ] **Step 1: Add the trip button to top-left controls and the bottom sheet HTML**

In `map.html`, after the `stop-tracking-btn` button (line 42), add the trip button:

```html
        <button id="trip-btn" data-tip="Plan trip" aria-label="Plan trip" style="display:none;">🗺️</button>
```

After the closing `</div>` of the `#map` div's `#controls` section (after line 66 `</div>` for controls), add the bottom sheet HTML:

```html
    <div id="trip-sheet">
        <div id="trip-sheet-handle"></div>
        <div id="trip-sheet-title">
            <span>Plan Trip</span>
            <button id="trip-close-btn" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div id="trip-inputs">
            <div class="trip-origin-row">
                <span style="font-size:0.85rem;">📍</span>
                <div class="trip-origin-pill">My Location</div>
            </div>
            <div class="trip-dest-row">
                <span style="font-size:0.85rem;">🏁</span>
                <input type="text" id="trip-dest-input" placeholder="Where to? (address or drop pin)" autocomplete="off">
                <button id="trip-dest-pin-btn" aria-label="Drop destination pin">📌</button>
            </div>
        </div>
        <div id="geocode-dropdown"></div>
        <div id="trip-loading" style="display:none;">
            <div class="spinner"></div>
            <div style="margin-top:6px;">Finding best routes...</div>
        </div>
        <div id="trip-results" style="display:none;"></div>
    </div>
```

- [ ] **Step 2: Add trip mode state and toggle logic in the `<script>` section**

Add after the `startLocation()` call (around line 376):

```js
    /* ── Trip planning mode ── */
    let tripMode = false;
    let destLat = null;
    let destLng = null;
    let tripOptions = null;
    let selectedTripIdx = 0;
    const tripBtn = document.getElementById('trip-btn');
    const tripSheet = document.getElementById('trip-sheet');
    const tripCloseBtn = document.getElementById('trip-close-btn');
    const tripDestInput = document.getElementById('trip-dest-input');
    const tripDestPinBtn = document.getElementById('trip-dest-pin-btn');
    const tripLoading = document.getElementById('trip-loading');
    const tripResults = document.getElementById('trip-results');
    const geocodeDropdown = document.getElementById('geocode-dropdown');
    const controlsEl = document.getElementById('controls');

    function showTripBtn() {
        tripBtn.style.display = (userLat !== null && agencySelect.value) ? '' : 'none';
    }

    function enterTripMode() {
        tripMode = true;
        tripBtn.classList.add('active');
        controlsEl.style.display = 'none';
        tripSheet.classList.add('open');
        destLat = null;
        destLng = null;
        tripOptions = null;
        tripResults.style.display = 'none';
        tripLoading.style.display = 'none';
        tripDestInput.value = '';
        mapAdapter.clearRoute();
        mapAdapter.clearStopMarkers();
    }

    function exitTripMode() {
        tripMode = false;
        tripBtn.classList.remove('active');
        controlsEl.style.display = '';
        tripSheet.classList.remove('open');
        geocodeDropdown.classList.remove('open');
        mapAdapter.clearDestinationPin();
        mapAdapter.clearTripPlan();
        destLat = null;
        destLng = null;
        tripOptions = null;
        // Restore normal polling
        if (!pollingPaused && agencySelect.value && routeSelect.value) {
            fetchLive();
        }
    }

    tripBtn.addEventListener('click', function () {
        if (tripMode) exitTripMode();
        else enterTripMode();
    });

    tripCloseBtn.addEventListener('click', exitTripMode);
```

- [ ] **Step 3: Update `showTripBtn` visibility calls**

Add `showTripBtn()` calls at the end of `onLocationUpdate`, `stopLocation`, the `dropPinBtn` click handler, and the agency-select fetch callback. Specifically:

In `onLocationUpdate` (after `mapAdapter.setView` block): add `showTripBtn();`

In `stopLocation` (after `stopTrackingBtn.style.display = 'none';`): add `showTripBtn();`

In `dropPinBtn.addEventListener` (after the `mapAdapter.dropLocationPin` call): add `showTripBtn();`

In the agency fetch `.then(agencies => {` callback (after `loadRoutes`): add `showTripBtn();`

- [ ] **Step 4: Commit**

```bash
git add web/public/map.html
git commit -m "feat(trip-planner): add trip mode toggle, bottom sheet HTML, and state management"
```

---

### Task 9: Frontend — Geocoding and Destination Setting

**Files:**
- Modify: `web/public/map.html`

- [ ] **Step 1: Add geocoding search on Enter key**

Add after the trip mode setup code:

```js
    /* ── Geocoding ── */
    tripDestInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const query = tripDestInput.value.trim();
        if (!query) return;
        geocodeAddress(query);
    });

    async function geocodeAddress(query) {
        try {
            const res = await fetch('/api/azure-maps/geocoding?api-version=2023-06-01&query=' + encodeURIComponent(query) + '&top=5', {
                headers: { 'X-Azure-Maps-Proxy': '1' }
            });
            const data = await res.json();
            const features = data.features || [];
            if (!features.length) {
                geocodeDropdown.innerHTML = '<div class="geocode-item" style="color:var(--text-muted);">No results found</div>';
                geocodeDropdown.classList.add('open');
                return;
            }
            geocodeDropdown.innerHTML = '';
            features.forEach(function (f) {
                const item = document.createElement('div');
                item.className = 'geocode-item';
                item.textContent = f.properties?.address?.formattedAddress || f.properties?.address?.freeformAddress || query;
                item.addEventListener('click', function () {
                    const coords = f.geometry.coordinates; // [lng, lat]
                    setDestination(coords[1], coords[0], item.textContent);
                    geocodeDropdown.classList.remove('open');
                });
                geocodeDropdown.appendChild(item);
            });
            geocodeDropdown.classList.add('open');
        } catch (err) {
            console.error('Geocoding failed:', err);
        }
    }

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
        if (!geocodeDropdown.contains(e.target) && e.target !== tripDestInput) {
            geocodeDropdown.classList.remove('open');
        }
    });
```

- [ ] **Step 2: Add destination setting and pin drop**

```js
    function setDestination(lat, lng, name) {
        destLat = lat;
        destLng = lng;
        tripDestInput.value = name || (lat.toFixed(4) + ', ' + lng.toFixed(4));
        mapAdapter.setDestinationPin(lat, lng, function (newLat, newLng) {
            destLat = newLat;
            destLng = newLng;
            tripDestInput.value = newLat.toFixed(4) + ', ' + newLng.toFixed(4);
            computeTrip();
        });
        mapAdapter.setView(lat, lng, mapAdapter.getZoom(), true);
        computeTrip();
    }

    tripDestPinBtn.addEventListener('click', function () {
        const center = mapAdapter.getCenter();
        setDestination(center.lat, center.lng, null);
    });
```

- [ ] **Step 3: Commit**

```bash
git add web/public/map.html
git commit -m "feat(trip-planner): add geocoding search and destination pin drop"
```

---

### Task 10: Frontend — Trip Computation and Results Display

**Files:**
- Modify: `web/public/map.html`

- [ ] **Step 1: Add `computeTrip` — calls backend and renders results**

```js
    async function computeTrip() {
        if (destLat === null || userLat === null) return;
        const agencyId = agencySelect.value;
        if (!agencyId) return;

        tripLoading.style.display = '';
        tripResults.style.display = 'none';
        mapAdapter.clearTripPlan();

        try {
            const res = await fetch('/api/trip-plan/' + agencyId +
                '?originLat=' + userLat + '&originLng=' + userLng +
                '&destLat=' + destLat + '&destLng=' + destLng);
            const data = await res.json();
            tripLoading.style.display = 'none';

            if (!data.options || !data.options.length) {
                tripResults.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:0.8rem;">' +
                    (data.error || 'No routes found for this trip.') + '</div>';
                tripResults.style.display = '';
                return;
            }

            tripOptions = data.options;
            selectedTripIdx = 0;
            renderTripResults();
            selectTripOption(0);
        } catch (err) {
            console.error('Trip plan failed:', err);
            tripLoading.style.display = 'none';
            tripResults.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:0.8rem;">Trip planning failed. Try again.</div>';
            tripResults.style.display = '';
        }
    }
```

- [ ] **Step 2: Add `renderTripResults` — builds the results HTML**

```js
    function formatMinutes(secs) {
        var m = Math.round(secs / 60);
        return m < 1 ? '< 1 min' : m + ' min';
    }

    function renderTripResults() {
        var html = '<div class="trip-summary-row"><span>📍 My Location → 🏁 ' +
            (tripDestInput.value.length > 25 ? tripDestInput.value.substring(0, 25) + '…' : tripDestInput.value) +
            '</span><a id="trip-edit-link">Edit</a></div>';

        tripOptions.forEach(function (opt, idx) {
            var legsHtml = '';
            opt.legs.forEach(function (leg, li) {
                if (li > 0) legsHtml += '<span class="arrow">→</span>';
                if (leg.type === 'walk') {
                    legsHtml += '<span class="walk">🚶' + formatMinutes(leg.durationSeconds) + '</span>';
                } else if (leg.type === 'bus') {
                    var color = leg.routeColor || '#1558d0';
                    var name = leg.routeName || leg.routeId;
                    if (name.length > 12) name = name.substring(0, 12) + '…';
                    legsHtml += '<span class="trip-leg-badge" style="background:' + color + ';">' + name + '</span>';
                }
            });

            var detailHtml = '';
            opt.legs.forEach(function (leg) {
                if (leg.type === 'walk') {
                    detailHtml += 'Walk to <b>' + (leg.to.name || 'next stop') + '</b> (' + leg.distanceMeters + 'm)<br>';
                } else if (leg.type === 'bus') {
                    var boardTimeStr = leg.boardTime ? leg.boardTime.substring(0, 5) : '';
                    detailHtml += 'Board <b>' + (leg.routeName || leg.routeId) + '</b>' +
                        (boardTimeStr ? ' (~' + boardTimeStr + ')' : '') +
                        ' · ' + (leg.numStops || '?') + ' stops<br>' +
                        'Alight at <b>' + (leg.alightStop.name || 'stop') + '</b><br>';
                }
            });

            html += '<div class="trip-option' + (idx === selectedTripIdx ? ' selected' : '') + '" data-trip-idx="' + idx + '">' +
                '<div class="trip-option-header">' +
                '<div class="trip-option-time">' + formatMinutes(opt.totalTime) + '</div>' +
                '<div class="trip-option-label">' + (opt.label || '') + '</div>' +
                '</div>' +
                '<div class="trip-option-legs">' + legsHtml + '</div>' +
                '<div class="trip-option-details">' + detailHtml + '</div>' +
                '</div>';
        });

        html += '<div class="trip-show-all"><label><input type="checkbox" id="trip-show-all-toggle"> Show all buses on route</label></div>';

        tripResults.innerHTML = html;
        tripResults.style.display = '';

        // Event: click trip option
        tripResults.querySelectorAll('.trip-option').forEach(function (el) {
            el.addEventListener('click', function () {
                selectTripOption(parseInt(el.dataset.tripIdx, 10));
            });
        });

        // Event: edit link
        var editLink = document.getElementById('trip-edit-link');
        if (editLink) {
            editLink.addEventListener('click', function (e) {
                e.stopPropagation();
                tripResults.style.display = 'none';
                document.getElementById('trip-inputs').style.display = '';
                tripDestInput.focus();
            });
        }

        // Event: show all buses toggle
        var showAllToggle = document.getElementById('trip-show-all-toggle');
        if (showAllToggle) {
            showAllToggle.addEventListener('change', function () {
                fetchTripBuses(showAllToggle.checked);
            });
        }
    }
```

- [ ] **Step 3: Add `selectTripOption` — draws the selected trip on the map**

```js
    async function selectTripOption(idx) {
        selectedTripIdx = idx;
        // Update card selection UI
        tripResults.querySelectorAll('.trip-option').forEach(function (el, i) {
            el.classList.toggle('selected', i === idx);
        });

        var opt = tripOptions[idx];
        if (!opt) return;

        // Fetch walking paths and shapes for the selected option
        var enrichedLegs = [];
        for (var i = 0; i < opt.legs.length; i++) {
            var leg = Object.assign({}, opt.legs[i]);
            if (leg.type === 'walk' && leg.from && leg.to) {
                // Fetch actual walking path from Azure Maps
                var query = leg.from.lat + ',' + leg.from.lng + ':' + leg.to.lat + ',' + leg.to.lng;
                try {
                    var walkRes = await fetch('/api/azure-maps/route/directions/json?api-version=1.0&query=' +
                        encodeURIComponent(query) + '&travelMode=pedestrian&routeType=shortest', {
                        headers: { 'X-Azure-Maps-Proxy': '1' }
                    });
                    var walkData = await walkRes.json();
                    if (walkData.routes && walkData.routes[0] && walkData.routes[0].legs) {
                        var pts = [];
                        walkData.routes[0].legs.forEach(function (wl) {
                            wl.points.forEach(function (p) { pts.push({ lat: p.latitude, lng: p.longitude }); });
                        });
                        leg.walkPath = pts;
                        // Update with real distance/time
                        var summary = walkData.routes[0].summary;
                        leg.distanceMeters = summary.lengthInMeters;
                        leg.durationSeconds = summary.travelTimeInSeconds;
                    }
                } catch (e) { console.error('Walk route fetch failed:', e); }
            } else if (leg.type === 'bus' && leg.tripId) {
                // Fetch shape for bus leg
                try {
                    var shapeRes = await fetch('/api/shape/' + agencySelect.value + '/' + leg.tripId);
                    var shapeData = await shapeRes.json();
                    if (shapeData.rows && shapeData.rows.length) {
                        var sorted = shapeData.rows
                            .sort(function (a, b) { return a.pt_sequence - b.pt_sequence; })
                            .map(function (p) { return { lat: p.pt_lat, lon: p.pt_lon }; });
                        leg.shapePath = sorted;
                    }
                } catch (e) { console.error('Shape fetch failed:', e); }
            }
            enrichedLegs.push(leg);
        }

        mapAdapter.drawTripPlan(enrichedLegs);

        // Show buses for selected trip
        fetchTripBuses(document.getElementById('trip-show-all-toggle')?.checked || false);
    }

    async function fetchTripBuses(showAll) {
        var opt = tripOptions[selectedTripIdx];
        if (!opt) return;

        var busLegs = opt.legs.filter(function (l) { return l.type === 'bus'; });
        var routeIds = busLegs.map(function (l) { return l.routeId; });
        var pinnedIds = busLegs.map(function (l) { return l.vehicleId; }).filter(Boolean);
        var agencyId = agencySelect.value;

        var allVehicles = [];
        for (var ri = 0; ri < routeIds.length; ri++) {
            try {
                var res = await fetch('/live/' + agencyId + '/' + routeIds[ri]);
                var vehicles = await res.json();
                if (showAll) {
                    allVehicles = allVehicles.concat(vehicles);
                } else {
                    // Only include the specific vehicle for this leg
                    var legVehicleId = busLegs[ri].vehicleId;
                    if (legVehicleId) {
                        var found = vehicles.find(function (v) { return v.vehicle_id === legVehicleId; });
                        if (found) allVehicles.push(found);
                    }
                }
            } catch (e) { console.error('Live fetch for trip bus failed:', e); }
        }

        if (allVehicles.length) {
            mapAdapter.showTripBuses(allVehicles, pinnedIds);
        }
    }
```

- [ ] **Step 4: Commit**

```bash
git add web/public/map.html
git commit -m "feat(trip-planner): add trip computation, results display, and map rendering"
```

---

### Task 11: Integration Testing and Polish

**Files:**
- Modify: `web/public/map.html` (minor fixes)
- Modify: `web/public/assets/map.css` (minor fixes)

- [ ] **Step 1: Start the dev server and test the full flow**

Run: `npm run dev`

Open `http://localhost:3000/view-map` in the browser.

Manual test checklist:
1. Allow geolocation or drop a pin — verify the 🗺️ trip button appears
2. Click the trip button — verify controls panel hides, bottom sheet slides up
3. Type an address and press Enter — verify geocode dropdown appears with results
4. Click a result — verify destination pin appears, "Finding best routes..." spinner shows
5. Wait for results — verify trip options appear as cards
6. Click a different trip option — verify map updates with new route colors
7. Toggle "Show all buses on route" — verify all buses appear/disappear
8. Click the ✕ button — verify trip mode exits, normal controls restore
9. Test on a narrow viewport (393px) — verify bottom sheet scrolls, touch targets work

- [ ] **Step 2: Fix any issues found during testing**

Address layout, timing, or rendering issues discovered during manual testing.

- [ ] **Step 3: Commit final polish**

```bash
git add -A
git commit -m "fix(trip-planner): integration test fixes and polish"
```
