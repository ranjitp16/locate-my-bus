const express = require('express');
const path = require('path');
const helmet = require('helmet');
const http = require('http');
const app = express();
const port = 3000;
const { Pool } = require('pg');
const { onBoardAgency } = require('./service/addAgency');

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
            scriptSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "'unsafe-inline'",
                "https://www.googletagmanager.com",
                "https://static.cloudflareinsights.com"
            ],
            styleSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                "'unsafe-inline'"
            ],
            fontSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "https://*.tile.openstreetmap.org",
                "https://*.basemaps.cartocdn.com",
                "https://tiles.stadiamaps.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com",
            ],
            connectSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com",
                "https://cloudflareinsights.com",
                "https://*.cloudflareinsights.com",
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

app.use(express.static(path.join(__dirname, 'public')))
app.use('/leaflet', express.static(path.join(__dirname, '../node_modules/leaflet/dist')))
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/dash/agencies', async (req, res) => {
    return res.sendFile(path.join(__dirname, 'public/addAgency.html'))
});

app.get('/dash/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

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

app.get('/view-map', async (req, res) => {
    return res.sendFile(path.join(__dirname, 'public/map.html'))
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
                slow_incidents:    slowRes.rows[0]?.slow_incidents    ?? 0,
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

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
