const express = require('express')
const path = require('path')
const helmet = require('helmet')
const app = express()
const port = 3000
const { Pool } = require('pg')

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


app.use(express.static(path.join(__dirname, 'public')))
app.use('/leaflet', express.static(path.join(__dirname, '../node_modules/leaflet/dist')))
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/:route_id', async (req, res) => {
    const { route_id } = req.params

    const pool = new Pool({
        connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
    })
    const { rows } = await pool.query('SELECT * FROM public.vehicle_position WHERE route_id = $1', [route_id])
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
            language: row.language,
            phone: row.phone,
            fare_url: row.fare_url,
            rt_feed_url: row.rt_feed_url,
            static_feed_url: row.static_feed_url,
        })))
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch agencies.' });
    }
}).post('/api/agencies/add', async (req, res) => {
    try {
        const opt = v => (v && v.trim()) || null;
        const { name, url, timezone, language, phone, fare_url, rt_feed_url, static_feed_url } = req.body;
        const pool = new Pool({
            connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
        })
        await pool.query(
            'INSERT INTO public.agency (id, name, url, timezone, language, phone, fare_url, rt_feed_url, static_feed_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [crypto.randomUUID(), opt(name), opt(url), opt(timezone), opt(language), opt(phone), opt(fare_url), rt_feed_url, static_feed_url]
        )
        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add agency.' });
    }
}).delete('/api/agencies/delete/:id', async (req, res) => {
    try {
        const key = req.headers['x-access-key'];
        if (!key || key !== process.env.DELETE_ACCESS_KEY) {
            return res.status(401).json({ error: 'Invalid access key.' });
        }
        const { id } = req.params;
        const pool = new Pool({
            connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
        })
        await pool.query('DELETE FROM public.agency WHERE id = $1', [id])
        res.sendStatus(204);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete agency.' });
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
