const { Pool } = require('pg');
const request = require('request');
const unzip = require('unzipper');
const { handleWriteFromAgency, handleWriteFromRoutes } = require('../repository/addAgency.js');

const pool = new Pool({
    connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DB}`,
});

const onBoardAgency = async (rt_feed_url, static_feed_url, api_key) => {
    // Download and parse the GTFS feed from static_feed_url as a stream, then extract agency.txt and insert its contents into the database
    // TODO: Handle where content.length is not provided by the server
    const decompressed = await unzip.Open.url(
        request,
        static_feed_url
    )

    const client = await pool.connect();
    try {

        await client.query('BEGIN'); // Start transaction

        let listOfGuid = await handleWriteFromAgency(client, 'agency.txt', 'agency', decompressed, rt_feed_url, static_feed_url, api_key);
        let listOfGuidFromRoute = await handleWriteFromRoutes(client, 'routes.txt', 'route', decompressed, listOfGuid);

        await client.query('COMMIT'); // Commit transaction


        console.table(listOfGuidFromRoute);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        throw err;
    } finally {
        client.release();
    }

}

module.exports = { onBoardAgency };
