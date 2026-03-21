const express = require('express');
const path = require('path');
const helmet = require('helmet');
const app = express();
const port = 3000;
const { Pool } = require('pg');
const { onBoardAgency } = require('./service/addAgency');

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
    .get('/routes/:agency_id', async (req, res) => {
        const { agency_id } = req.params
        const { rows } = await pool.query('SELECT id, long_name FROM public.route WHERE agency_id = $1', [agency_id]);
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
