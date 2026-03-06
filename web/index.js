const express = require('express')
const path = require('path')
const app = express()
const port = 3000
const { Pool } = require('pg')


app.use(express.static(path.join(__dirname, 'public')))
app.use('/leaflet', express.static(path.join(__dirname, '../node_modules/leaflet/dist')))
app.get('/:route_id', async (req, res) => {
    const { route_id } = req.params

    const pool = new Pool({
        connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres:5432/${process.env.POSTGRES_DB}`,
    })
    const { rows } = await pool.query('SELECT * FROM public.vehicle_position WHERE route_id = $1', [route_id])
    console.log(rows)
    res.send(rows)
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
