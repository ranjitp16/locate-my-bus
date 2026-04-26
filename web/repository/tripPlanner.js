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

async function getRouteStopIndex(pool, agencyId, stopIds) {
    if (!Array.isArray(stopIds) || !stopIds.length) return [];
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

/**
 * Fetches all stops served by the given routes. Returns a Map of routeId → Set of stop objects.
 * Used to compute transfer stops as set intersections in memory (no self-join).
 */
async function getStopsByRoutes(pool, agencyId, routeIds) {
    if (!routeIds.length) return new Map();
    const { rows } = await pool.query(
        `SELECT DISTINCT t.route_id, st.stop_id, s.name, s.lat, s.lon
         FROM public.stop_time st
         JOIN public.trip t ON t.agency_id = st.agency_id AND t.id = st.trip_id
         JOIN public.stop s ON s.agency_id = st.agency_id AND s.id = st.stop_id
         WHERE st.agency_id = $1
           AND t.route_id = ANY($2)
           AND s.lat IS NOT NULL AND s.lon IS NOT NULL`,
        [agencyId, routeIds]
    );
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.route_id)) map.set(r.route_id, new Map());
        map.get(r.route_id).set(r.stop_id, { stop_id: r.stop_id, name: r.name, lat: r.lat, lon: r.lon });
    }
    return map;
}

async function getRouteInfo(pool, agencyId, routeId) {
    const { rows } = await pool.query(
        `SELECT id, short_name, long_name, color
         FROM public.route
         WHERE agency_id = $1 AND id = $2`,
        [agencyId, routeId]
    );
    return rows[0] || null;
}

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

module.exports = {
    getStopsNearPoint,
    getRouteStopIndex,
    getTransferStops,
    getStopsByRoutes,
    getRouteInfo,
    getLiveVehicle,
    getTripStopTimes,
};
