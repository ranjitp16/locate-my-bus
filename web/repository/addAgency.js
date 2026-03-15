const handleWriteFromAgency = async (client, fileName, tableName, decompressed, rt_feed_url, static_feed_url) => {

    const file = decompressed.files.find(f => f.path === fileName);
    const content = await file.buffer();
    const lines = content.toString().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        throw new Error(`Invalid GTFS feed: ${fileName} must contain at least a header and one data line.`);
    }

    const s_header = lines.shift(); // Remove and store header as a str
    const header = s_header.split(',').map(h => h.trim()); // s -> arr

    // Get agency columns from the table and extract it into an Arr<>... to validate against the feed
    const { rows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', tableName]
    );
    const sanitized_table_headers_no_id = rows.filter(r => r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {
        if (!s_header.includes(`${tableName}_${h.column_name}`)) {
            throw new Error(`GTFS feed is missing required column: ${h.column_name}`);
        }
    });

    var listToReturn = [];

    // Extract values from each line and insert into the database, mapping feed columns to table columns (removing agency_ prefix) and adding rt_feed_url and static_feed_url
    for (const line of lines) {
        const values = line.split(',').map(v => v.trim());

        const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h)), 'rt_feed_url', 'static_feed_url'];
        const uuid = crypto.randomUUID()
        const params = [uuid];

        let listToReturnEntry = { uuid };

        header.forEach((h, i) => {
            if (h !== `${tableName}_id` && sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace(`${tableName}_`, ''))) {
                params.push(values[i] || null);
            }
            if (h === `${tableName}_id`) {
                listToReturnEntry = { ...listToReturnEntry, [h]: values[i] || null };
            }
        });

        params.push(rt_feed_url, static_feed_url);

        const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
            `INSERT INTO public.${tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            params
        );
        listToReturn.push(listToReturnEntry);
    }
    return listToReturn;
};

const handleWriteFromRoutes = async (client, fileName, tableName, decompressed, listOfAgencyGuids) => {
    const file = decompressed.files.find(f => f.path === fileName);
    const content = await file.buffer();
    const lines = content.toString().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        throw new Error(`Invalid GTFS feed: ${fileName} must contain at least a header and one data line.`);
    }

    const s_header = lines.shift(); // Remove and store header as a str
    const header = s_header.split(',').map(h => h.trim()); // s -> arr

    // Get agency columns from the table and extract it into an Arr<>... to validate against the feed
    const { rows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', tableName]
    );
    const sanitized_table_headers_no_id = rows.filter(r => r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {
        if (h.column_name !== 'agency_id' && !s_header.includes(`${tableName}_${h.column_name}`)) {
            throw new Error(`GTFS feed is missing required column: ${h.column_name}`);
        }
    });

    // Build a lookup map from GTFS agency_id → UUID once, before iterating rows
    const agencyLookup = new Map(listOfAgencyGuids.map(it => [it.agency_id, it.uuid]));

    // Extract values from each line and insert into the database, mapping feed columns to table columns (removing route_ prefix) and adding rt_feed_url and static_feed_url
    for (const line of lines) {
        const values = line.split(',').map(v => v.trim());

        const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];
        const params = [];

        header.forEach((h, i) => {
            if (h === "agency_id") {
                const uuid = agencyLookup.get(values[i]);
                if (!uuid) {
                    throw new Error(`Route references unknown agency_id "${values[i]}" — no matching agency was imported.`);
                }
                params.push(uuid);
            } else if (sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace(`${tableName}_`, ''))) {
                params.push(values[i] || null);
            }
        });
        const placeholders = params.map((_, i) => `$${i + 1}`).join(',');

        await client.query(
            `INSERT INTO public.${tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            params
        );
    };
};

module.exports = { handleWriteFromAgency, handleWriteFromRoutes };