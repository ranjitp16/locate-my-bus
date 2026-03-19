const handleWriteFromAgency = async (client, fileName, tableName, decompressed, rt_feed_url, static_feed_url, api_key) => {
    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, static_feed_url);
    var listToReturn = [];

    // Extract values from each line and insert into the database, mapping feed columns to table columns (removing agency_ prefix) and adding rt_feed_url and static_feed_url
    for (const line of lines) {
        const values = line.split(',').map(v => v.trim());

        const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h)), 'rt_feed_url', 'static_feed_url', 'api_key_in_header'];
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

        params.push(rt_feed_url, static_feed_url, api_key || null);

        const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
            `INSERT INTO public.${tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            params
        );
        listToReturn.push(listToReturnEntry);
    }
    return listToReturn;
};

const handleWriteFromRoutes = async (client, fileName, tableName, decompressed, listOfAgencyGuids, static_feed_url) => {
    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, static_feed_url);

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

const handleWriteFromShapes = async (client, fileName, tableName, decompressed, listOfGuid, static_feed_url) => {
    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, static_feed_url);

    console.log(header, sanitized_table_headers_no_id);

};

const getFileContents = async (client, decompressed, fileName, tableName, static_feed_url) => {
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
    const sanitized_table_headers_no_id = rows.filter(r => r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url' && r.column_name !== 'api_key_in_header');
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url' && r.column_name !== 'api_key_in_header');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {
        // look into this condition, not sure if this is what i meant. We want to ignore agency_id for agencies.txt
        if ((tableName !== "agency" && h.column_name !== 'agency_id')
            && !s_header.includes(`${tableName}_${h.column_name}`)) {
            console.log(`File ${tableName} in the GTFS feed ${static_feed_url} is missing required column: ${h.column_name}`);
        }
    });

    return { lines, header, sanitized_table_headers_no_id };
}


module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes };