// web/service/tripPlanner.js
const repo = require('../repository/tripPlanner');

const WALK_SPEED_MS = 5000 / 3600; // 5 km/h in m/s
const MANHATTAN_FACTOR = 1.4;
const DEFAULT_RADIUS = 800;
const EXPANDED_RADIUS = 1500;
const TWO_XFER_PRUNE_RADIUS = 2000; // heuristic: skip R2 if no stops within 2km of dest
const MAX_ONE_XFER_RESULTS = 100;   // cap 1-transfer candidates to avoid OOM
const MAX_TWO_XFER_RESULTS = 50;    // cap 2-transfer candidates
const MAX_TWO_XFER_ITERATIONS = 5000; // hard iteration limit for 2-transfer inner loops
const PLAN_TIMEOUT_MS = 8000;         // overall timeout — return partial results after 8s

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateWalkSeconds(lat1, lng1, lat2, lng2) {
    const dist = haversineMeters(lat1, lng1, lat2, lng2) * MANHATTAN_FACTOR;
    return Math.round(dist / WALK_SPEED_MS);
}

function gtfsTimeToSeconds(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2] || '0', 10);
}

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

async function findNearbyStops(pool, agencyId, lat, lng) {
    let stops = await repo.getStopsNearPoint(pool, agencyId, lat, lng, DEFAULT_RADIUS);
    if (!stops.length) {
        stops = await repo.getStopsNearPoint(pool, agencyId, lat, lng, EXPANDED_RADIUS);
    }
    return stops;
}

// pool/agencyId accepted for calling-convention consistency with Tasks 3/4 (transfer search makes DB calls)
async function findDirectRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    const nearBIds = new Set(stopsNearB.map(s => s.id));

    const byRoute = {};
    for (const row of routeStopIndex) {
        if (!byRoute[row.route_id]) byRoute[row.route_id] = [];
        byRoute[row.route_id].push(row);
    }

    const results = [];

    for (const [routeId, entries] of Object.entries(byRoute)) {
        const hasA = entries.some(e => nearAIds.has(e.stop_id));
        const hasB = entries.some(e => nearBIds.has(e.stop_id));
        if (!hasA || !hasB) continue;

        const byTrip = {};
        for (const e of entries) {
            if (!byTrip[e.trip_id]) byTrip[e.trip_id] = [];
            byTrip[e.trip_id].push(e);
        }

        for (const [tripId, tripEntries] of Object.entries(byTrip)) {
            const boardCandidates = tripEntries.filter(e => nearAIds.has(e.stop_id));
            const alightCandidates = tripEntries.filter(e => nearBIds.has(e.stop_id));

            for (const board of boardCandidates) {
                const depSecs = gtfsTimeToSeconds(board.departure_time);
                if (depSecs === null || isNaN(depSecs) || depSecs < nowSecs) continue;

                for (const alight of alightCandidates) {
                    if (alight.stop_sequence <= board.stop_sequence) continue;

                    const arrSecs = gtfsTimeToSeconds(alight.arrival_time);
                    if (arrSecs === null || isNaN(arrSecs)) continue;

                    // DB rows use .lon; output objects use .lng key per API spec
                    const boardStop = stopsNearA.find(s => s.id === board.stop_id);
                    const alightStop = stopsNearB.find(s => s.id === alight.stop_id);
                    // Guard: stop may be missing coords (filtered out of nearby query)
                    if (!boardStop || !alightStop) continue;

                    // Compute Manhattan distances once — reused for both distanceMeters and durationSeconds
                    const distToBoard = haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR;
                    const distFromAlight = haversineMeters(alightStop.lat, alightStop.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR;
                    const walkToBoard = Math.round(distToBoard / WALK_SPEED_MS);
                    const walkFromAlight = Math.round(distFromAlight / WALK_SPEED_MS);
                    const waitTime = Math.max(0, depSecs - nowSecs - walkToBoard);
                    // Handle overnight trips where arr < dep in seconds (GTFS >24h not always used)
                    const rideTime = arrSecs >= depSecs ? arrSecs - depSecs : arrSecs + 86400 - depSecs;
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
                                distanceMeters: Math.round(distToBoard),
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
                                distanceMeters: Math.round(distFromAlight),
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

async function findOneTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    const nearBIds = new Set(stopsNearB.map(s => s.id));

    // Group routeStopIndex by route → trip → entries
    const byRoute = {};
    for (const row of routeStopIndex) {
        if (!byRoute[row.route_id]) byRoute[row.route_id] = [];
        byRoute[row.route_id].push(row);
    }

    // Identify which routes serve stops near A (R1 candidates) and near B (R2 candidates)
    const r1Routes = [];
    const r2Routes = [];
    for (const [routeId, entries] of Object.entries(byRoute)) {
        if (entries.some(e => nearAIds.has(e.stop_id))) r1Routes.push(routeId);
        if (entries.some(e => nearBIds.has(e.stop_id))) r2Routes.push(routeId);
    }

    // Pre-group trips for every route so we don't rebuild inside the R1×R2 loop
    const tripsByRoute = {};
    for (const routeId of Object.keys(byRoute)) {
        const byTrip = {};
        for (const e of byRoute[routeId]) {
            if (!byTrip[e.trip_id]) byTrip[e.trip_id] = [];
            byTrip[e.trip_id].push(e);
        }
        tripsByRoute[routeId] = byTrip;
    }

    const results = [];

    // Single batch query for ALL transfer stops across all R1×R2 pairs
    const allCandidateRoutes = [...new Set([...r1Routes, ...r2Routes])];
    const xferMap = await repo.getBatchTransferStops(pool, agencyId, allCandidateRoutes);

    for (const r1 of r1Routes) {
        if (results.length >= MAX_ONE_XFER_RESULTS) break;
        const r1ByTrip = tripsByRoute[r1];
        for (const r2 of r2Routes) {
            if (results.length >= MAX_ONE_XFER_RESULTS) break;
            if (r1 === r2) continue;

            const cacheKey = r1 < r2 ? r1 + '|' + r2 : r2 + '|' + r1;
            const transferStops = xferMap.get(cacheKey) || [];
            if (!transferStops.length) continue;

            const r2ByTrip = tripsByRoute[r2];

            for (const xferStop of transferStops) {
                // Find R1 trips that board near A and alight at this transfer stop
                for (const [r1TripId, r1Entries] of Object.entries(r1ByTrip)) {
                    const boardCandidates = r1Entries.filter(e => nearAIds.has(e.stop_id));
                    const xferEntry = r1Entries.find(e => e.stop_id === xferStop.stop_id);
                    if (!xferEntry) continue;

                    const xferArrSecs = gtfsTimeToSeconds(xferEntry.arrival_time);
                    if (xferArrSecs === null || isNaN(xferArrSecs)) continue;

                    for (const board of boardCandidates) {
                        if (xferEntry.stop_sequence <= board.stop_sequence) continue;

                        const depSecs = gtfsTimeToSeconds(board.departure_time);
                        if (depSecs === null || isNaN(depSecs) || depSecs < nowSecs) continue;

                        const boardStop = stopsNearA.find(s => s.id === board.stop_id);
                        if (!boardStop) continue;

                        const distToBoard = haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR;
                        const walkToBoard = Math.round(distToBoard / WALK_SPEED_MS);
                        // Must be able to walk to the board stop in time
                        if (nowSecs + walkToBoard > depSecs) continue;

                        const waitForR1 = Math.max(0, depSecs - nowSecs - walkToBoard);
                        const ride1Time = xferArrSecs >= depSecs
                            ? xferArrSecs - depSecs
                            : xferArrSecs + 86400 - depSecs;

                        // Find R2 trips that depart the transfer stop after R1 arrives and alight near B
                        for (const [r2TripId, r2Entries] of Object.entries(r2ByTrip)) {
                            const xferDep = r2Entries.find(e => e.stop_id === xferStop.stop_id);
                            if (!xferDep) continue;

                            const xferDepSecs = gtfsTimeToSeconds(xferDep.departure_time);
                            if (xferDepSecs === null || isNaN(xferDepSecs)) continue;

                            // R2 must depart the transfer stop after R1 arrives there
                            if (xferDepSecs < xferArrSecs) continue;
                            const transferWait = xferDepSecs - xferArrSecs;

                            const alightCandidates = r2Entries.filter(e =>
                                nearBIds.has(e.stop_id) && e.stop_sequence > xferDep.stop_sequence
                            );

                            for (const alight of alightCandidates) {
                                const arrSecs = gtfsTimeToSeconds(alight.arrival_time);
                                if (arrSecs === null || isNaN(arrSecs)) continue;

                                const alightStop = stopsNearB.find(s => s.id === alight.stop_id);
                                if (!alightStop) continue;

                                const distFromAlight = haversineMeters(alightStop.lat, alightStop.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR;
                                const walkFromAlight = Math.round(distFromAlight / WALK_SPEED_MS);
                                const ride2Time = arrSecs >= xferDepSecs
                                    ? arrSecs - xferDepSecs
                                    : arrSecs + 86400 - xferDepSecs;
                                const totalTime = walkToBoard + waitForR1 + ride1Time + transferWait + ride2Time + walkFromAlight;

                                results.push({
                                    totalTime,
                                    totalWalkTime: walkToBoard + walkFromAlight,
                                    totalRideTime: ride1Time + ride2Time,
                                    waitTime: waitForR1 + transferWait,
                                    transfers: 1,
                                    legs: [
                                        {
                                            type: 'walk',
                                            from: { lat: origin.lat, lng: origin.lng, name: 'Your location' },
                                            to: { lat: boardStop.lat, lng: boardStop.lon, name: boardStop.name },
                                            distanceMeters: Math.round(distToBoard),
                                            durationSeconds: walkToBoard,
                                        },
                                        {
                                            type: 'bus',
                                            routeId: r1,
                                            tripId: r1TripId,
                                            shapeId: board.shape_id,
                                            boardStop: { id: board.stop_id, name: boardStop.name, lat: boardStop.lat, lng: boardStop.lon },
                                            alightStop: { id: xferStop.stop_id, name: xferStop.name, lat: xferStop.lat, lng: xferStop.lon },
                                            boardTime: board.departure_time,
                                            alightTime: xferEntry.arrival_time,
                                            boardSequence: board.stop_sequence,
                                            alightSequence: xferEntry.stop_sequence,
                                        },
                                        {
                                            type: 'bus',
                                            routeId: r2,
                                            tripId: r2TripId,
                                            shapeId: xferDep.shape_id,
                                            boardStop: { id: xferStop.stop_id, name: xferStop.name, lat: xferStop.lat, lng: xferStop.lon },
                                            alightStop: { id: alight.stop_id, name: alightStop.name, lat: alightStop.lat, lng: alightStop.lon },
                                            boardTime: xferDep.departure_time,
                                            alightTime: alight.arrival_time,
                                            boardSequence: xferDep.stop_sequence,
                                            alightSequence: alight.stop_sequence,
                                        },
                                        {
                                            type: 'walk',
                                            from: { lat: alightStop.lat, lng: alightStop.lon, name: alightStop.name },
                                            to: { lat: dest.lat, lng: dest.lng, name: 'Destination' },
                                            distanceMeters: Math.round(distFromAlight),
                                            durationSeconds: walkFromAlight,
                                        },
                                    ],
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    return results;
}

async function findTwoTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs, bestSoFar) {
    const nearAIds = new Set(stopsNearA.map(s => s.id));
    let iterations = 0;
    // Cache getTripStopTimes to avoid repeated fetches for the same trip
    const stopTimesCache = new Map();

    // Stops near dest within the tighter prune radius (used to pre-filter R3 candidates in SQL)
    const stopsNearDestPrune = await repo.getStopsNearPoint(pool, agencyId, dest.lat, dest.lng, TWO_XFER_PRUNE_RADIUS);
    const nearDestPruneIds = new Set(stopsNearDestPrune.map(s => s.id));
    const nearDestPruneArr = [...nearDestPruneIds]; // pre-built array for $4 param in R3 query

    // Group routeStopIndex by route
    const byRoute = {};
    for (const row of routeStopIndex) {
        if (!byRoute[row.route_id]) byRoute[row.route_id] = [];
        byRoute[row.route_id].push(row);
    }

    // R1 candidates: routes serving stops near A
    const r1Routes = Object.keys(byRoute).filter(routeId =>
        byRoute[routeId].some(e => nearAIds.has(e.stop_id))
    );

    const results = [];

    for (const r1 of r1Routes) {
        if (iterations >= MAX_TWO_XFER_ITERATIONS || results.length >= MAX_TWO_XFER_RESULTS) break;
        const r1Entries = byRoute[r1];

        // Group R1 entries by trip
        const r1ByTrip = {};
        for (const e of r1Entries) {
            if (!r1ByTrip[e.trip_id]) r1ByTrip[e.trip_id] = [];
            r1ByTrip[e.trip_id].push(e);
        }

        for (const [r1TripId, r1TripEntries] of Object.entries(r1ByTrip)) {
            if (iterations >= MAX_TWO_XFER_ITERATIONS || results.length >= MAX_TWO_XFER_RESULTS) break;
            const boardCandidates = r1TripEntries.filter(e => nearAIds.has(e.stop_id));
            if (!boardCandidates.length) continue;

            // Fetch full stop-time sequence (cached) for this R1 trip to enumerate T1 candidates
            if (!stopTimesCache.has(r1TripId)) stopTimesCache.set(r1TripId, await repo.getTripStopTimes(pool, agencyId, r1TripId));
            const r1StopTimes = stopTimesCache.get(r1TripId);
            if (!r1StopTimes.length) continue;

            for (const board of boardCandidates) {
                const depSecs = gtfsTimeToSeconds(board.departure_time);
                if (depSecs === null || isNaN(depSecs) || depSecs < nowSecs) continue;

                const boardStop = stopsNearA.find(s => s.id === board.stop_id);
                if (!boardStop) continue;

                const distToBoard = haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lon) * MANHATTAN_FACTOR;
                const walkToBoard = Math.round(distToBoard / WALK_SPEED_MS);
                if (nowSecs + walkToBoard > depSecs) continue;

                const waitForR1 = Math.max(0, depSecs - nowSecs - walkToBoard);

                // Enumerate T1: every stop on R1 beyond the boarding stop
                for (const t1Stop of r1StopTimes) {
                    iterations++;
                    if (iterations >= MAX_TWO_XFER_ITERATIONS || results.length >= MAX_TWO_XFER_RESULTS) break;
                    if (t1Stop.stop_sequence <= board.stop_sequence) continue;

                    const r1ArrT1Secs = gtfsTimeToSeconds(t1Stop.arrival_time);
                    if (r1ArrT1Secs === null || isNaN(r1ArrT1Secs)) continue;

                    const ride1Time = r1ArrT1Secs >= depSecs
                        ? r1ArrT1Secs - depSecs
                        : r1ArrT1Secs + 86400 - depSecs;

                    // Prune: if we've already exceeded bestSoFar before even starting R2
                    if (bestSoFar !== undefined && walkToBoard + waitForR1 + ride1Time >= bestSoFar) continue;

                    // Find R2 candidates: routes serving T1, excluding R1
                    const { rows: r2Candidates } = await pool.query(
                        `SELECT DISTINCT t.route_id
                         FROM public.stop_time st
                         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                         WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id != $3`,
                        [agencyId, t1Stop.stop_id, r1]
                    );

                    for (const { route_id: r2 } of r2Candidates) {
                        // Find R2 trips departing T1 after R1 arrives at T1
                        const { rows: r2TripRows } = await pool.query(
                            `SELECT DISTINCT st.trip_id, st.departure_time
                             FROM public.stop_time st
                             JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                             WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id = $3
                               AND st.departure_time IS NOT NULL`,
                            [agencyId, t1Stop.stop_id, r2]
                        );

                        for (const r2TripRow of r2TripRows) {
                            const r2DepT1Secs = gtfsTimeToSeconds(r2TripRow.departure_time);
                            if (r2DepT1Secs === null || isNaN(r2DepT1Secs)) continue;
                            if (r2DepT1Secs < r1ArrT1Secs) continue;

                            const transferWait1 = r2DepT1Secs - r1ArrT1Secs;

                            // Prune early
                            if (bestSoFar !== undefined &&
                                walkToBoard + waitForR1 + ride1Time + transferWait1 >= bestSoFar) continue;

                            const r2TripId = r2TripRow.trip_id;
                            if (!stopTimesCache.has(r2TripId)) stopTimesCache.set(r2TripId, await repo.getTripStopTimes(pool, agencyId, r2TripId));
                            const r2StopTimes = stopTimesCache.get(r2TripId);
                            if (!r2StopTimes.length) continue;

                            // Find T1 in R2's stop times to establish sequence
                            const r2T1Entry = r2StopTimes.find(st => st.stop_id === t1Stop.stop_id);
                            if (!r2T1Entry) continue;

                            // Enumerate T2: every stop on R2 beyond T1
                            for (const t2Stop of r2StopTimes) {
                                if (t2Stop.stop_sequence <= r2T1Entry.stop_sequence) continue;

                                const r2ArrT2Secs = gtfsTimeToSeconds(t2Stop.arrival_time);
                                if (r2ArrT2Secs === null || isNaN(r2ArrT2Secs)) continue;

                                const ride2Time = r2ArrT2Secs >= r2DepT1Secs
                                    ? r2ArrT2Secs - r2DepT1Secs
                                    : r2ArrT2Secs + 86400 - r2DepT1Secs;

                                // Prune
                                if (bestSoFar !== undefined &&
                                    walkToBoard + waitForR1 + ride1Time + transferWait1 + ride2Time >= bestSoFar) continue;

                                // Find R3 candidates: routes serving T2 (excl. R2) that also serve at least
                                // one stop within TWO_XFER_PRUNE_RADIUS of dest — avoids fetching dead trips
                                const { rows: r3Candidates } = nearDestPruneArr.length
                                    ? await pool.query(
                                        `SELECT DISTINCT t.route_id
                                         FROM public.stop_time st
                                         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                                         WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id != $3
                                           AND EXISTS (
                                               SELECT 1 FROM public.stop_time st2
                                               JOIN public.trip t2 ON t2.agency_id = st2.agency_id AND t2.id = st2.trip_id
                                               WHERE st2.agency_id = $1 AND t2.route_id = t.route_id
                                                 AND st2.stop_id = ANY($4)
                                           )`,
                                        [agencyId, t2Stop.stop_id, r2, nearDestPruneArr]
                                    )
                                    : { rows: [] };

                                for (const { route_id: r3 } of r3Candidates) {
                                    // R3 trips departing T2 after R2 arrives at T2
                                    const { rows: r3TripRows } = await pool.query(
                                        `SELECT DISTINCT st.trip_id, st.departure_time
                                         FROM public.stop_time st
                                         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
                                         WHERE st.agency_id = $1 AND st.stop_id = $2 AND t.route_id = $3
                                           AND st.departure_time IS NOT NULL`,
                                        [agencyId, t2Stop.stop_id, r3]
                                    );

                                    for (const r3TripRow of r3TripRows) {
                                        const r3DepT2Secs = gtfsTimeToSeconds(r3TripRow.departure_time);
                                        if (r3DepT2Secs === null || isNaN(r3DepT2Secs)) continue;
                                        if (r3DepT2Secs < r2ArrT2Secs) continue;

                                        const transferWait2 = r3DepT2Secs - r2ArrT2Secs;

                                        const r3TripId = r3TripRow.trip_id;
                                        if (!stopTimesCache.has(r3TripId)) stopTimesCache.set(r3TripId, await repo.getTripStopTimes(pool, agencyId, r3TripId));
                                        const r3StopTimes = stopTimesCache.get(r3TripId);
                                        if (!r3StopTimes.length) continue;

                                        // Find T2 entry in R3's stop times
                                        const r3T2Entry = r3StopTimes.find(st => st.stop_id === t2Stop.stop_id);
                                        if (!r3T2Entry) continue;

                                        // Find alight stops near dest (within prune radius) beyond T2
                                        const alightCandidates = r3StopTimes.filter(st =>
                                            st.stop_sequence > r3T2Entry.stop_sequence &&
                                            nearDestPruneIds.has(st.stop_id)
                                        );

                                        for (const alight of alightCandidates) {
                                            const arrSecs = gtfsTimeToSeconds(alight.arrival_time);
                                            if (arrSecs === null || isNaN(arrSecs)) continue;
                                            if (!alight.lat || !alight.lon) continue;

                                            const distFromAlight = haversineMeters(alight.lat, alight.lon, dest.lat, dest.lng) * MANHATTAN_FACTOR;
                                            const walkFromAlight = Math.round(distFromAlight / WALK_SPEED_MS);

                                            const ride3Time = arrSecs >= r3DepT2Secs
                                                ? arrSecs - r3DepT2Secs
                                                : arrSecs + 86400 - r3DepT2Secs;

                                            const totalTime = walkToBoard + waitForR1 + ride1Time +
                                                transferWait1 + ride2Time +
                                                transferWait2 + ride3Time + walkFromAlight;

                                            // Final prune
                                            if (bestSoFar !== undefined && totalTime >= bestSoFar) continue;

                                            // Retrieve shape_id for R2 trip from routeStopIndex if available
                                            const r2IndexEntry = byRoute[r2] ? byRoute[r2].find(e => e.trip_id === r2TripId) : null;
                                            const r3IndexEntry = byRoute[r3] ? byRoute[r3].find(e => e.trip_id === r3TripId) : null;

                                            results.push({
                                                totalTime,
                                                totalWalkTime: walkToBoard + walkFromAlight,
                                                totalRideTime: ride1Time + ride2Time + ride3Time,
                                                waitTime: waitForR1 + transferWait1 + transferWait2,
                                                transfers: 2,
                                                legs: [
                                                    {
                                                        type: 'walk',
                                                        from: { lat: origin.lat, lng: origin.lng, name: 'Your location' },
                                                        to: { lat: boardStop.lat, lng: boardStop.lon, name: boardStop.name },
                                                        distanceMeters: Math.round(distToBoard),
                                                        durationSeconds: walkToBoard,
                                                    },
                                                    {
                                                        type: 'bus',
                                                        routeId: r1,
                                                        tripId: r1TripId,
                                                        shapeId: board.shape_id,
                                                        boardStop: { id: board.stop_id, name: boardStop.name, lat: boardStop.lat, lng: boardStop.lon },
                                                        alightStop: { id: t1Stop.stop_id, name: t1Stop.name, lat: t1Stop.lat, lng: t1Stop.lon },
                                                        boardTime: board.departure_time,
                                                        alightTime: t1Stop.arrival_time,
                                                        boardSequence: board.stop_sequence,
                                                        alightSequence: t1Stop.stop_sequence,
                                                    },
                                                    {
                                                        type: 'bus',
                                                        routeId: r2,
                                                        tripId: r2TripId,
                                                        shapeId: r2IndexEntry ? r2IndexEntry.shape_id : null,
                                                        boardStop: { id: t1Stop.stop_id, name: t1Stop.name, lat: t1Stop.lat, lng: t1Stop.lon },
                                                        alightStop: { id: t2Stop.stop_id, name: t2Stop.name, lat: t2Stop.lat, lng: t2Stop.lon },
                                                        boardTime: r2TripRow.departure_time,
                                                        alightTime: t2Stop.arrival_time,
                                                        boardSequence: r2T1Entry.stop_sequence,
                                                        alightSequence: t2Stop.stop_sequence,
                                                    },
                                                    {
                                                        type: 'bus',
                                                        routeId: r3,
                                                        tripId: r3TripId,
                                                        shapeId: r3IndexEntry ? r3IndexEntry.shape_id : null,
                                                        boardStop: { id: t2Stop.stop_id, name: t2Stop.name, lat: t2Stop.lat, lng: t2Stop.lon },
                                                        alightStop: { id: alight.stop_id, name: alight.name, lat: alight.lat, lng: alight.lon },
                                                        boardTime: r3TripRow.departure_time,
                                                        alightTime: alight.arrival_time,
                                                        boardSequence: r3T2Entry.stop_sequence,
                                                        alightSequence: alight.stop_sequence,
                                                    },
                                                    {
                                                        type: 'walk',
                                                        from: { lat: alight.lat, lng: alight.lon, name: alight.name },
                                                        to: { lat: dest.lat, lng: dest.lng, name: 'Destination' },
                                                        distanceMeters: Math.round(distFromAlight),
                                                        durationSeconds: walkFromAlight,
                                                    },
                                                ],
                                            });
                                        }
                                    }
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

async function planTrip(pool, agencyId, originLat, originLng, destLat, destLng) {
    // Step 1: Get agency timezone
    const { rows: agencyRows } = await pool.query(
        'SELECT timezone FROM public.agency WHERE id = $1', [agencyId]
    );
    if (!agencyRows.length) throw new Error('Agency not found');
    const timezone = agencyRows[0].timezone || 'America/Halifax';
    const nowSecs = nowAsSeconds(timezone);

    const origin = { lat: originLat, lng: originLng };
    const dest = { lat: destLat, lng: destLng };
    const startTime = Date.now();

    // Step 2: Find nearby stops
    const stopsNearA = await findNearbyStops(pool, agencyId, origin.lat, origin.lng);
    const stopsNearB = await findNearbyStops(pool, agencyId, dest.lat, dest.lng);

    if (!stopsNearA.length || !stopsNearB.length) {
        return { options: [], error: 'No transit stops found near origin or destination' };
    }

    // Step 3: Build route-stop index
    const allStopIds = [...new Set([...stopsNearA.map(s => s.id), ...stopsNearB.map(s => s.id)])];
    const routeStopIndex = await repo.getRouteStopIndex(pool, agencyId, allStopIds);

    // Step 4: Run searches (with timeout checks)
    const direct = await findDirectRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs);
    let allResults = [...direct];

    if (Date.now() - startTime < PLAN_TIMEOUT_MS) {
        const oneXfer = await findOneTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs);
        allResults = [...allResults, ...oneXfer];
    }

    const bestSoFar = allResults.reduce((min, r) => r.totalTime < min ? r.totalTime : min, Infinity);

    // Skip expensive 2-transfer search if we already have enough diverse results or timed out
    const uniqueRouteKeys = new Set(allResults.map(r =>
        r.legs.filter(l => l.type === 'bus').map(l => l.routeId).join('|')
    ));
    if (uniqueRouteKeys.size < 3 && Date.now() - startTime < PLAN_TIMEOUT_MS) {
        const twoXfer = await findTwoTransferRoutes(pool, agencyId, origin, dest, stopsNearA, stopsNearB, routeStopIndex, nowSecs, bestSoFar);
        allResults = [...allResults, ...twoXfer];
    }

    if (!allResults.length) {
        return { options: [], error: 'No routes found for this trip' };
    }

    // Step 5: Sort, deduplicate, take top 3
    allResults.sort((a, b) => a.totalTime - b.totalTime);

    const seen = new Set();
    const unique = [];
    for (const r of allResults) {
        const key = r.legs.filter(l => l.type === 'bus').map(l => l.routeId).join('|');
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(r);
        }
    }

    const top3 = unique.slice(0, 3);

    // Step 6: Assign labels
    if (top3.length > 0) top3[0].label = 'Best';
    for (let i = 1; i < top3.length; i++) {
        const opt = top3[i];
        if (opt.transfers < top3[0].transfers) opt.label = 'Fewer transfers';
        else if (opt.transfers === 0 && top3[0].transfers > 0) opt.label = 'Direct route';
        else if (opt.totalWalkTime < top3[0].totalWalkTime) opt.label = 'Less walking';
        else if (opt.totalWalkTime > top3[0].totalWalkTime) opt.label = 'More walking';
        else opt.label = 'Alternative';
    }

    // Step 7: Enrich bus legs with route info, stop count, and live vehicle
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

module.exports = { haversineMeters, estimateWalkSeconds, gtfsTimeToSeconds, nowAsSeconds, findNearbyStops, findDirectRoutes, findOneTransferRoutes, findTwoTransferRoutes, planTrip };
