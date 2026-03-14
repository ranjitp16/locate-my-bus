const express = require('express');
const path = require('path');
const helmet = require('helmet');
const app = express();
const port = 3000;
const { Pool } = require('pg');
const request = require('request');
const unzip = require('unzipper');

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
            styleSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
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

app.get('/:route_id', async (req, res) => {
    const { route_id } = req.params

    const pool = new Pool({
        connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
    })
    const { rows } = await pool.query('SELECT * FROM public.live_vehicle_position WHERE route_id = $1', [route_id])
    res.send(rows)
})

app.get('/dash/agencies', async (req, res) => {
    return res.sendFile(path.join(__dirname, 'public/addAgency.html'))
});

app.get('/api/agencies', async (req, res) => {
    try {
        const pool = new Pool({
            connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
        })
        const { rows } = await pool.query('SELECT * FROM public.agency')
        res.json(rows.map(row => ({
            id: row.id,
            name: row.name,
            url: row.url,
            timezone: row.timezone,
            language: row.lang,
            phone: row.phone,
            fare_url: row.fare_url,
            rt_feed_url: row.rt_feed_url,
            static_feed_url: row.static_feed_url,
        })))
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch agencies.' });
    }
}).post('/api/agencies/add', authMiddleware, async (req, res) => {
    try {
        const { name, url, timezone, language, phone, fare_url, rt_feed_url, static_feed_url } = req.body;

        if (!static_feed_url) {
            return res.status(400).json({ error: 'static_feed_url is required.' });
        }

        await onBoardAgency(rt_feed_url, static_feed_url);

        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Failed to add agency.' });
    }
}).delete('/api/agencies/delete/:id', authMiddleware, async (req, res) => {
    try {

        const { id } = req.params;
        const pool = new Pool({
            connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
        })
        await pool.query('DELETE FROM public.agency WHERE id = $1', [id])
        res.sendStatus(204);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Failed to delete agency.' });
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

const onBoardAgency = async (rt_feed_url, static_feed_url) => {
    // Download and parse the GTFS feed from static_feed_url as a stream, then extract agency.txt and insert its contents into the database
    const decompressed = await unzip.Open.url(
        request,
        static_feed_url
    )
    // TODO: Handle where content.length is not provided by the server

    const file = decompressed.files.find(f => f.path === 'agency.txt');
    const content = await file.buffer();
    const lines = content.toString().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        throw new Error('Invalid GTFS feed: agency.txt must contain at least a header and one data line.');
    }

    const s_header = lines.shift(); // Remove and store header as a str
    const header = s_header.split(',').map(h => h.trim()); // s -> arr

    const pool = new Pool({
        connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
    });

    // Get agency columns from the table and extract it into an Arr<>... to validate against the feed
    const { rows } = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', 'agency']
    );
    const sanitized_table_headers_no_id = rows.filter(r => r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {
        if (!s_header.includes(`agency_${h.column_name}`)) {
            throw new Error(`GTFS feed is missing required column: ${h.column_name}`);
        }
    });

    console.log(typeof s_header);
    console.log(JSON.stringify(s_header.split(',').map(h => h.trim())));

    // Extract values from each line and insert into the database, mapping feed columns to table columns (removing agency_ prefix) and adding rt_feed_url and static_feed_url
    lines.forEach(async line => {
        const values = line.split(',').map(v => v.trim());

        const columns = [...header.map(h => h.replace('agency_', '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h)), 'rt_feed_url', 'static_feed_url'];
        const params = [crypto.randomUUID()];

        header.forEach((h, i) => {
            if (h !== 'agency_id' && sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace('agency_', ''))) {
                params.push(values[i] || null);
            }
        });

        params.push(rt_feed_url, static_feed_url);

        const placeholders = params.map((_, i) => `$${i + 1}`).join(',');

        console.log('Inserting agency record with values:', { columns, params });

        await pool.query(
            `INSERT INTO public.agency (${columns.join(',')}) VALUES (${placeholders})`,
            params
        );
    });
};