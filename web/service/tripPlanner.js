// web/service/tripPlanner.js
const repo = require('../repository/tripPlanner');

const WALK_SPEED_MS = 5000 / 3600; // 5 km/h in m/s
const MANHATTAN_FACTOR = 1.4;
const DEFAULT_RADIUS = 800;
const EXPANDED_RADIUS = 1500;
const TWO_XFER_PRUNE_RADIUS = 2000; // heuristic: skip R2 if no stops within 2km of dest

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
                if (depSecs === null || depSecs < nowSecs) continue;

                for (const alight of alightCandidates) {
                    if (alight.stop_sequence <= board.stop_sequence) continue;

                    const arrSecs = gtfsTimeToSeconds(alight.arrival_time);
                    if (arrSecs === null) continue;

                    // DB rows have lon; output objects use lng per spec
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

module.exports = { haversineMeters, estimateWalkSeconds, gtfsTimeToSeconds, nowAsSeconds, findNearbyStops, findDirectRoutes };
