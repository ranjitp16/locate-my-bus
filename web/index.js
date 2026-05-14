const express = require('express');
const path = require('path');
const helmet = require('helmet');
const http = require('http');
const app = express();
const port = 3000;
const { Pool } = require('pg');
const { onBoardAgency } = require('./service/addAgency');
const { planTrip } = require('./service/tripPlanner');

function dockerRequest(method, apiPath) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { socketPath: '/var/run/docker.sock', path: apiPath, method },
            res => {
                let body = '';
                res.on('data', d => body += d);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300)
                        resolve(body ? JSON.parse(body) : null);
                    else
                        reject(new Error(`Docker API ${res.statusCode}: ${body}`));
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

const pool = new Pool({
    connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DB}`,
});

app.use(helmet({
    referrerPolicy: {
        policy: "strict-origin-when-cross-origin", // sends Referer to same-origin and HTTPS cross-origin
    },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // All app JS is bundled and served same-origin from /dist/assets.
            // 'unsafe-inline' stays so React's inline event handlers / future
            // analytics snippets work; tighten with a nonce when adding any.
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://atlas.microsoft.com",
                "https://www.googletagmanager.com"
            ],
            // 'unsafe-inline' needed for React's heavy use of style={{...}}.
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://atlas.microsoft.com",
                "https://fonts.googleapis.com"
            ],
            fontSrc: [
                "'self'",
                "https://atlas.microsoft.com",
                "https://fonts.gstatic.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "https://atlas.microsoft.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com",
            ],
            // Azure Maps tiles/styles normally go through /api/azure-maps,
            // but atlas.microsoft.com stays whitelisted as a safety net for
            // any SDK request that bypasses transformRequest.
            connectSrc: [
                "'self'",
                "https://atlas.microsoft.com",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com"
            ],
            workerSrc: [
                "'self'",
                "blob:",
                "https://atlas.microsoft.com"
            ]
        },
    },
}))

const authMiddleware = (req, res, next) => {
    const key = req.headers['x-access-key'];
    if (!key || key !== process.env.DELETE_ACCESS_KEY) {
        return res.status(401).json({ error: 'Invalid access key.' });
    }
    next();
};

// Serve the React SPA build first, then fall through to other static assets
// (robots.txt, sitemap.xml, og-image, etc.) so they keep working.
app.use(express.static(path.join(__dirname, 'public', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Azure Maps proxy — keeps subscription key server-side ──
   Anti-forgery: custom header (X-Azure-Maps-Proxy) triggers CORS preflight
   for cross-origin callers, which will fail since we set no permissive CORS
   headers. Only same-origin JS (our frontend) can send custom headers freely. */
const AZURE_MAPS_ALLOWED_PATHS = ['/map/tile', '/map/tileset', '/map/imagery',
    '/map/statetile', '/map/attribution', '/renderv2/',
    '/atlas/styles', '/atlas/fonts', '/atlas/sprites', '/atlas/icons',
    '/styling/',
    '/geocoding', '/search', '/route', '/spatial', '/timezone', '/weather'];
app.get('/api/azure-maps/{*path}', async (req, res) => {
    if (!process.env.AZURE_MAPS_KEY) {
        return res.status(503).json({ error: 'Azure Maps key not configured' });
    }
    if (req.headers['x-azure-maps-proxy'] !== '1') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const proxyPath = req.path.replace(/^\/api\/azure-maps/, '');
    if (!AZURE_MAPS_ALLOWED_PATHS.some(p => proxyPath.startsWith(p))) {
        return res.status(403).json({ error: 'Path not allowed' });
    }
    const target = new URL('https://atlas.microsoft.com' + proxyPath);
    // Carry over query params from the original request
    for (const [k, v] of Object.entries(req.query)) {
        if (k === 'subscription-key') continue;
        if (Array.isArray(v)) {
            v.forEach(val => target.searchParams.append(k, val));
        } else {
            target.searchParams.set(k, v);
        }
    }
    target.searchParams.set('subscription-key', process.env.AZURE_MAPS_KEY);
    try {
        const upstream = await fetch(target.toString(), {
            headers: { 'Accept-Encoding': 'identity' },
        });
        res.status(upstream.status);
        const ct = upstream.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        const cc = upstream.headers.get('cache-control');
        if (cc) res.setHeader('Cache-Control', cc);
        if (!upstream.body) return res.end();
        const { Readable } = require('stream');
        Readable.fromWeb(upstream.body).pipe(res);
    } catch (err) {
        console.error('[azure-maps proxy]', err.message);
        res.status(502).end();
    }
});

/* ── Normalized map API endpoints — provider-agnostic response format ──
   These abstract away the Azure Maps response schema so the frontend
   only deals with a stable format. Swap the implementation here to
   change map providers without touching frontend code. */

async function azureFetch(path, params) {
    const target = new URL('https://atlas.microsoft.com' + path);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    target.searchParams.set('subscription-key', process.env.AZURE_MAPS_KEY);
    const upstream = await fetch(target.toString(), { headers: { 'Accept-Encoding': 'identity' } });
    if (!upstream.ok) throw new Error('Azure Maps returned ' + upstream.status);
    return upstream.json();
}

// Geocoding — returns { results: [{ displayName, lat, lon }] }
app.get('/api/maps/geocode', async (req, res) => {
    if (req.headers['x-azure-maps-proxy'] !== '1') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!process.env.AZURE_MAPS_KEY) return res.status(503).json({ error: 'Maps key not configured' });
    const { query, lat, lon, radius, limit } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing query param' });

    try {
        const params = { 'api-version': '1.0', query };
        if (limit) params.limit = limit;
        if (lat && lon) { params.lat = lat; params.lon = lon; }
        if (radius) params.radius = radius;

        const data = await azureFetch('/search/address/json', params);
        const results = (data.results || []).map(r => ({
            displayName: r.address?.freeformAddress || query,
            lat: r.position?.lat,
            lon: r.position?.lon,
        }));
        res.json({ results });
    } catch (err) {
        console.error('[maps/geocode]', err.message);
        res.status(502).json({ error: 'Geocoding failed' });
    }
});

// Walking route — returns { points: [{lat, lng}], distanceMeters, durationSeconds }
app.get('/api/maps/walk-route', async (req, res) => {
    if (req.headers['x-azure-maps-proxy'] !== '1') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!process.env.AZURE_MAPS_KEY) return res.status(503).json({ error: 'Maps key not configured' });
    const { originLat, originLng, destLat, destLng } = req.query;
    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    try {
        const query = originLat + ',' + originLng + ':' + destLat + ',' + destLng;
        const data = await azureFetch('/route/directions/json', {
            'api-version': '1.0', query, travelMode: 'pedestrian', routeType: 'shortest',
        });

        if (!data.routes || !data.routes[0]) {
            return res.json({ points: [], distanceMeters: 0, durationSeconds: 0 });
        }

        const points = [];
        (data.routes[0].legs || []).forEach(leg => {
            (leg.points || []).forEach(p => points.push({ lat: p.latitude, lng: p.longitude }));
        });
        const summary = data.routes[0].summary || {};
        res.json({
            points,
            distanceMeters: summary.lengthInMeters || 0,
            durationSeconds: summary.travelTimeInSeconds || 0,
        });
    } catch (err) {
        console.error('[maps/walk-route]', err.message);
        res.status(502).json({ error: 'Route lookup failed' });
    }
});

app
    .get('/routes/:agency_id/:running_route', async (req, res) => {
        const { agency_id, running_route } = req.params
        const { rows } = await pool.query(running_route === '1' ? 'SELECT id, long_name FROM public.route WHERE agency_id = $1 AND id in (SELECT DISTINCT route_id FROM public.live_vehicle_position WHERE agency_id = $1)' :
            'SELECT id, long_name FROM public.route WHERE agency_id = $1', [agency_id]);
        res.send(rows)
    })
    .get('/live/:agency_id/:route_id', async (req, res) => {
        const { agency_id, route_id } = req.params
        const { rows } = await pool.query('SELECT * FROM public.live_vehicle_position WHERE agency_id = $1 AND route_id = $2', [agency_id, route_id])
        res.send(rows)
    })

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(DISTINCT pi.id)::int                                                                      AS total_iterations,
                COUNT(fe.id)::int                                                                               AS total_executions,
                ROUND(AVG(fe.execution_time_us) / 1000)::int                                                   AS avg_execution_ms,
                ROUND(100.0 * SUM(CASE WHEN fe.is_cache_hit  THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1)     AS cache_hit_pct,
                ROUND(100.0 * SUM(CASE WHEN fe.status = 'error' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1)  AS error_pct
            FROM public.poll_iteration pi
            LEFT JOIN public.feed_execution fe ON fe.poll_iteration_id = pi.id
        `);
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

app.get('/api/dashboard/iterations', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                pi.id,
                pi.started_at,
                pi.agency_count,
                COUNT(fe.id)::int                                                            AS actual_executions,
                ROUND(AVG(fe.execution_time_us) / 1000)::int                                AS avg_execution_ms,
                SUM(CASE WHEN fe.status = 'error'   THEN 1 ELSE 0 END)::int                AS error_count,
                SUM(CASE WHEN fe.is_cache_hit        THEN 1 ELSE 0 END)::int                AS cache_hits
            FROM public.poll_iteration pi
            LEFT JOIN public.feed_execution fe ON fe.poll_iteration_id = pi.id
            GROUP BY pi.id, pi.started_at, pi.agency_count
            ORDER BY pi.id DESC
            LIMIT 50
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch iterations.' });
    }
});

app.get('/api/dashboard/executions/:poll_iteration_id', authMiddleware, async (req, res) => {
    try {
        const { poll_iteration_id } = req.params;
        const { rows } = await pool.query(`
            SELECT
                fe.id,
                a.name                                   AS agency_name,
                fe.is_cache_hit,
                ROUND(fe.execution_time_us / 1000)::int  AS execution_ms,
                ROUND(fe.download_time_us  / 1000)::int  AS download_ms,
                fe.status,
                fe.error_message
            FROM public.feed_execution fe
            JOIN public.agency a ON a.id = fe.agency_id
            WHERE fe.poll_iteration_id = $1
            ORDER BY fe.id ASC
        `, [poll_iteration_id]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch executions.' });
    }
});

// Public landing-page snapshot: top-line counters + a row per agency.
// Numbers reflect the current DB state; no auth so the homepage can render them.
app.get('/api/landing', async (req, res) => {
    try {
        const [totalsRes, perAgencyRes] = await Promise.all([
            pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM public.agency)::int                        AS agencies,
                    (SELECT COUNT(*) FROM public.route)::int                         AS routes,
                    (SELECT COUNT(*) FROM public.live_vehicle_position)::int         AS buses_live,
                    (SELECT COUNT(*) FROM public.poll_iteration
                        WHERE started_at >= NOW() - INTERVAL '24 hours')::int        AS polls_24h,
                    (SELECT ROUND(
                        100.0 * SUM(CASE WHEN fe.status = 'error' THEN 1 ELSE 0 END)
                              / NULLIF(COUNT(*), 0), 1)
                     FROM public.feed_execution fe
                     JOIN public.poll_iteration pi ON pi.id = fe.poll_iteration_id
                     WHERE pi.started_at >= NOW() - INTERVAL '24 hours')             AS error_rate_pct,
                    (SELECT ROUND(AVG(fe.execution_time_us) / 1000)::int
                     FROM public.feed_execution fe
                     JOIN public.poll_iteration pi ON pi.id = fe.poll_iteration_id
                     WHERE pi.started_at >= NOW() - INTERVAL '24 hours')             AS avg_latency_ms
            `),
            pool.query(`
                SELECT
                    a.id   AS agency_id,
                    a.name AS agency_name,
                    (SELECT COUNT(*) FROM public.route r WHERE r.agency_id = a.id)::int                  AS routes,
                    (SELECT COUNT(*) FROM public.live_vehicle_position v WHERE v.agency_id = a.id)::int  AS buses_live,
                    (
                      SELECT ROUND(
                        100.0 * SUM(CASE WHEN fe.status = 'error' THEN 1 ELSE 0 END)
                              / NULLIF(COUNT(*), 0), 1
                      )
                      FROM public.feed_execution fe
                      JOIN public.poll_iteration pi ON pi.id = fe.poll_iteration_id
                      WHERE fe.agency_id = a.id
                        AND pi.started_at >= NOW() - INTERVAL '24 hours'
                    ) AS error_rate_pct,
                    (
                      SELECT ROUND(AVG(fe.execution_time_us) / 1000)::int
                      FROM public.feed_execution fe
                      JOIN public.poll_iteration pi ON pi.id = fe.poll_iteration_id
                      WHERE fe.agency_id = a.id
                        AND pi.started_at >= NOW() - INTERVAL '24 hours'
                    ) AS avg_latency_ms
                FROM public.agency a
                ORDER BY a.name ASC
            `),
        ]);
        const t = totalsRes.rows[0] || {};
        res.json({
            totals: {
                agencies: t.agencies || 0,
                routes: t.routes || 0,
                busesLive: t.buses_live || 0,
                polls24h: t.polls_24h || 0,
                errorRatePct: t.error_rate_pct == null ? null : Number(t.error_rate_pct),
                avgLatencyMs: t.avg_latency_ms == null ? null : Number(t.avg_latency_ms),
            },
            agencies: perAgencyRes.rows.map((r) => ({
                id: r.agency_id,
                name: r.agency_name,
                routes: r.routes,
                busesLive: r.buses_live,
                stale: r.buses_live === 0,
                errorRatePct: r.error_rate_pct == null ? null : Number(r.error_rate_pct),
                avgLatencyMs: r.avg_latency_ms == null ? null : Number(r.avg_latency_ms),
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch landing data.' });
    }
});

app.get('/api/agencies', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM public.agency')
        res.json(rows.map(row => ({
            id: row.id,
            name: row.name,
            url: row.url,
            timezone: row.timezone,
            language: row.lang,
            phone: row.phone,
            fare_url: row.fare_url,
        })))
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch agencies.' });
    }
}).post('/api/agencies/add', authMiddleware, async (req, res) => {
    try {
        const { api_key, rt_feed_url, static_feed_url } = req.body;

        if (!static_feed_url) {
            return res.status(400).json({ error: 'static_feed_url is required.' });
        }

        if (!rt_feed_url) {
            return res.status(400).json({ error: 'rt_feed_url is required.' });
        }

        await onBoardAgency(rt_feed_url, static_feed_url, api_key);

        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Failed to add agency.' });
    }
}).delete('/api/agencies/delete/:id', authMiddleware, async (req, res) => {
    try {

        const { id } = req.params;
        await pool.query('DELETE FROM public.agency WHERE id = $1', [id])
        res.sendStatus(204);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Failed to delete agency.' });
    }
});

app.post('/api/daemon/kill', authMiddleware, async (req, res) => {
    const image = 'ranjitnovascotia/locate-my-bus:latest';
    try {
        const filters = encodeURIComponent(JSON.stringify({ ancestor: [image] }));
        const containers = await dockerRequest('GET', `/containers/json?filters=${filters}`);
        if (!containers.length) return res.status(404).json({ error: 'No running container found for that image.' });
        for (const c of containers) {
            await dockerRequest('POST', `/containers/${c.Id}/kill`);
            await dockerRequest('POST', `/containers/${c.Id}/start`);
        }
        res.sendStatus(204);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/analytics', authMiddleware, async (req, res) => {
    try {
        const [feedRes, summaryRes, cycleRes, slowRes] = await Promise.all([
            pool.query(`
                WITH agency_avg AS (
                    SELECT agency_id,
                           AVG(download_time_us) FILTER (WHERE NOT is_cache_hit) AS avg_dl
                    FROM public.feed_execution
                    GROUP BY agency_id
                )
                SELECT
                    a.id                                                                                              AS agency_id,
                    a.name                                                                                            AS agency_name,
                    a.rt_feed_url,
                    COUNT(fe.id)::int                                                                                 AS total_executions,
                    SUM(CASE WHEN fe.is_cache_hit THEN 1 ELSE 0 END)::int                                            AS cache_hits,
                    ROUND(AVG(fe.download_time_us) FILTER (WHERE NOT fe.is_cache_hit) / 1000)::int                   AS avg_download_ms,
                    ROUND(MAX(fe.download_time_us) FILTER (WHERE NOT fe.is_cache_hit) / 1000)::int                   AS max_download_ms,
                    ROUND(AVG(fe.execution_time_us) / 1000)::int                                                     AS avg_exec_ms,
                    ROUND(MAX(fe.execution_time_us) / 1000)::int                                                     AS max_exec_ms,
                    SUM(CASE WHEN fe.status = 'error' THEN 1 ELSE 0 END)::int                                        AS error_count,
                    SUM(CASE WHEN NOT fe.is_cache_hit AND aa.avg_dl > 0
                              AND fe.download_time_us > 3 * aa.avg_dl THEN 1 ELSE 0 END)::int                        AS slow_incidents
                FROM public.agency a
                JOIN public.feed_execution fe ON fe.agency_id = a.id
                JOIN agency_avg aa ON aa.agency_id = a.id
                GROUP BY a.id, a.name, a.rt_feed_url
                ORDER BY avg_exec_ms DESC NULLS LAST
            `),
            pool.query(`
                SELECT
                    COUNT(DISTINCT pi.id)::int                                                                         AS total_iterations,
                    MIN(pi.id)::int                                                                                    AS min_iteration_id,
                    MAX(pi.id)::int                                                                                    AS max_iteration_id,
                    COUNT(DISTINCT a.rt_feed_url)::int                                                                 AS unique_feeds,
                    ROUND(100.0 * SUM(CASE WHEN fe.is_cache_hit THEN 1 ELSE 0 END) / NULLIF(COUNT(fe.id), 0), 1)     AS cache_hit_pct
                FROM public.poll_iteration pi
                JOIN public.feed_execution fe ON fe.poll_iteration_id = pi.id
                JOIN public.agency a ON a.id = fe.agency_id
            `),
            pool.query(`
                SELECT ROUND(AVG(gap_s))::int AS avg_cycle_seconds
                FROM (
                    SELECT EXTRACT(EPOCH FROM (started_at - LAG(started_at) OVER (ORDER BY id))) AS gap_s
                    FROM public.poll_iteration
                ) t WHERE gap_s IS NOT NULL
            `),
            pool.query(`
                WITH agency_avg AS (
                    SELECT agency_id, AVG(download_time_us) FILTER (WHERE NOT is_cache_hit) AS avg_dl
                    FROM public.feed_execution GROUP BY agency_id
                )
                SELECT COUNT(*)::int AS slow_incidents
                FROM public.feed_execution fe
                JOIN agency_avg aa ON aa.agency_id = fe.agency_id
                WHERE NOT fe.is_cache_hit AND aa.avg_dl > 0 AND fe.download_time_us > 3 * aa.avg_dl
            `)
        ]);
        res.json({
            feedStats: feedRes.rows,
            summary: {
                ...summaryRes.rows[0],
                avg_cycle_seconds: cycleRes.rows[0]?.avg_cycle_seconds ?? null,
                slow_incidents: slowRes.rows[0]?.slow_incidents ?? 0,
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
});

app.get('/api/dashboard/latency', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                pi.id                                               AS iteration_id,
                a.id                                                AS agency_id,
                a.name                                              AS agency_name,
                ROUND(fe.download_time_us / 1000)::int             AS download_ms
            FROM public.feed_execution fe
            JOIN public.poll_iteration pi ON pi.id = fe.poll_iteration_id
            JOIN public.agency a ON a.id = fe.agency_id
            WHERE NOT fe.is_cache_hit
              AND pi.id >= (SELECT GREATEST(MAX(id) - 49, 1) FROM public.poll_iteration)
            ORDER BY pi.id ASC, a.name ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch latency data.' });
    }
});

app.get('/api/shape/:agency_id/:trip_id', async (req, res) => {

    const { agency_id, trip_id } = req.params;

    const { rows: tripRows } = await pool.query(
        'SELECT shape_id, trip_headsign FROM public.trip WHERE agency_id = $1 AND id = $2',
        [agency_id, trip_id]
    );

    if (!tripRows.length) return res.status(404).send({ error: 'Trip not found' });

    const { rows } = await pool.query(
        'SELECT pt_lat, pt_lon, pt_sequence FROM public.shape_point WHERE agency_id = $1 AND id = $2 ORDER BY pt_sequence::int ASC',
        [agency_id, tripRows[0].shape_id]
    );

    res.send({ trip_headsign: tripRows[0].trip_headsign, rows });
});

app.get('/api/stops/:agency_id/:trip_id', async (req, res) => {
    const { agency_id, trip_id } = req.params;

    try {
        const { rows } = await pool.query(
            `SELECT s.id AS stop_id, s.name, s.code, s.lat, s.lon,
                    st.arrival_time, st.departure_time, st.stop_sequence,
                    s.wheelchair_boarding
             FROM public.stop_time st
             JOIN public.stop s ON s.agency_id = st.agency_id AND s.id = st.stop_id
             WHERE st.agency_id = $1 AND st.trip_id = $2
             ORDER BY st.stop_sequence::int ASC`,
            [agency_id, trip_id]
        );

        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stops.' });
    }
});

app.get('/api/trip-plan/:agency_id', async (req, res) => {
    const { agency_id } = req.params;
    const { originLat, originLng, destLat, destLng } = req.query;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(agency_id)) return res.status(400).json({ error: 'Invalid agency_id' });

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: 'Missing required query params: originLat, originLng, destLat, destLng' });
    }

    const oLat = parseFloat(originLat), oLng = parseFloat(originLng), dLat = parseFloat(destLat), dLng = parseFloat(destLng);
    if ([oLat, oLng, dLat, dLng].some(isNaN)) return res.status(400).json({ error: 'Invalid coordinates' });
    if (Math.abs(oLat) > 90 || Math.abs(dLat) > 90 || Math.abs(oLng) > 180 || Math.abs(dLng) > 180) {
        return res.status(400).json({ error: 'Coordinates out of range' });
    }

    try {
        const result = await planTrip(
            pool, agency_id,
            oLat, oLng,
            dLat, dLng
        );
        res.json(result);
    } catch (err) {
        console.error('[trip-plan]', err);
        res.status(500).json({ error: 'Trip planning failed' });
    }
});

// SPA fallback: any unmatched GET that doesn't look like a file or API request
// returns the React shell so client-side routing can take over.
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/routes/') || req.path.startsWith('/live/')) return next();
    if (req.path.includes('.')) return next();
    res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
