const { Client } = require('pg');
const { onBoardAgency } = require('../web/service/addAgency');

const MAX_CONCURRENT = 2;

async function runWithPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;

    async function worker() {
        while (next < items.length) {
            const i = next++;
            try {
                await fn(items[i]);
                results[i] = { status: 'fulfilled' };
            } catch (err) {
                results[i] = { status: 'rejected', reason: err };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
}

async function main() {
    const startTime = Date.now();
    const client = new Client({
        connectionString: `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DB}`,
    });
    await client.connect();

    let feeds;
    try {
        ({ rows: feeds } = await client.query(
            'SELECT DISTINCT rt_feed_url, static_feed_url, api_key_in_header FROM public.agency'
        ));

        if (feeds.length === 0) {
            console.log('No agencies found. Nothing to refresh.');
            return;
        }

        console.log(`Found ${feeds.length} unique feed(s) to refresh (concurrency: ${MAX_CONCURRENT}).`);

        await client.query(
            'TRUNCATE agency, route, shape, shape_point, trip, stop, stop_time, live_vehicle_position, poll_iteration, feed_execution CASCADE'
        );
        console.log('Truncated all tables.');
    } finally {
        await client.end();
    }

    const results = await runWithPool(feeds, MAX_CONCURRENT, feed => {
        console.log(`Onboarding: ${feed.static_feed_url}`);
        return onBoardAgency(feed.rt_feed_url, feed.static_feed_url, feed.api_key_in_header);
    });

    let refreshed = 0;
    const errors = [];
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
            refreshed++;
            console.log(`  Done: ${feeds[i].static_feed_url}`);
        } else {
            console.error(`  Failed: ${feeds[i].static_feed_url} — ${results[i].reason.message}`);
            errors.push({ static_feed_url: feeds[i].static_feed_url, error: results[i].reason.message });
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nRefresh complete: ${refreshed} succeeded, ${errors.length} failed. (${elapsed}s)`);
    if (errors.length > 0) console.error('Failures:', errors);

    process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
