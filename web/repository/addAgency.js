const handleWriteFromAgency = async (client, fileName, tableName, decompressed, rt_feed_url, static_feed_url, api_key) => {
    console.log("INITIATING AGENCY WRITES: " + static_feed_url);
    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, tableName, static_feed_url);

    const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h)), 'rt_feed_url', 'static_feed_url', 'api_key_in_header'];
    const rows = [];
    const listToReturn = [];

    for (const line of lines) {
        const values = line.split(',').map(v => v.trim());
        const uuid = crypto.randomUUID();
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
        rows.push(params);
        listToReturn.push(listToReturnEntry);
    }

    if (rows.length > 0) await bulkInsert(client, tableName, columns, rows);
    console.log("COMPLETE AGENCY WRITES: " + static_feed_url);
    return listToReturn;
};

const handleWriteFromRoutes = async (client, fileName, tableName, decompressed, listOfAgencyGuids, static_feed_url) => {
    console.log("INITIATING ROUTE WRITES: " + static_feed_url);
    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, tableName, static_feed_url);

    // Build a lookup map from GTFS agency_id → UUID once, before iterating rows
    const agencyLookup = new Map(listOfAgencyGuids.map(it => [it.agency_id, it.uuid]));

    const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];

    var responseMap = new Map();
    const rows = [];

    for (const line of lines) {
        const values = line.split(',').map(v => v.trim());

        const params = [];
        let agency_id;
        let route_id;
        header.forEach((h, i) => {
            if (h === "agency_id") {
                agency_id = agencyLookup.get(values[i]);
                if (!agency_id) {
                    throw new Error(`Route references unknown agency_id "${values[i]}" — no matching agency was imported.`);
                }
                params.push(agency_id);
            } else if (sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace(`${tableName}_`, ''))) {
                params.push(values[i] || null);
                if (`${tableName}_id` === h) route_id = values[i] || null;
            }
        });

        rows.push(params);
        if (!responseMap.has(agency_id)) responseMap.set(agency_id, []);
        responseMap.get(agency_id).push(route_id);
    }

    if (rows.length > 0) await bulkInsert(client, tableName, columns, rows);

    console.log("COMPLETE ROUTE WRITES: " + static_feed_url);
    return responseMap;
};

const BATCH_SIZE = 5000;

const bulkInsert = async (client, tableName, columns, rows) => {
    const numCols = columns.length;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map((_, rowIdx) =>
            `(${columns.map((_, colIdx) => `$${rowIdx * numCols + colIdx + 1}`).join(',')})`
        ).join(', ');
        await client.query(
            `INSERT INTO public.${tableName} (${columns.join(',')}) VALUES ${placeholders}`,
            batch.flat()
        );
    }
};

const handleWriteFromTrip = async (client, fileName, tableName, decompressed, listOfAgencyGuids, listOfGuidFromRoute, static_feed_url) => {
    console.log("INITIATING TRIP WRITES: " + static_feed_url);

    let { lines, header, sanitized_table_headers_no_id } = await getFileContentsFromTrip(client, decompressed, fileName, tableName, static_feed_url);

    const columns = [...header.filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];
    columns.push("agency_id");
    columns.push("id");

    const indexOfRoute = header.indexOf('route_id');

    for (const { uuid } of listOfAgencyGuids) {
        const agency_id = uuid;
        const rows = [];

        for (const line of lines) {
            const values = line.split(',').map(v => v.trim());
            if (!listOfGuidFromRoute.get(agency_id).includes(values[indexOfRoute])) continue;

            const params = [];
            let trip_id;
            header.forEach((h, i) => {
                if (sanitized_table_headers_no_id.some(sh => sh.column_name === h)) {
                    params.push(values[i] || null);
                }
                if (h === "trip_id") trip_id = values[i] || null;
            });
            params.push(agency_id);
            params.push(trip_id);
            rows.push(params);
        }

        if (rows.length > 0) await bulkInsert(client, tableName, columns, rows);
    }
    console.log("COMPLETE TRIP WRITES: " + static_feed_url);
}

const handleWriteFromShapes = async (client, fileName, tableName, decompressed, listOfAgencyGuids, static_feed_url) => {
    console.log("INITIATING SHAPES WRITES: " + static_feed_url);

    const actualTableName = tableName;
    tableName = "shape";

    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, actualTableName, tableName, static_feed_url);

    const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];
    columns.push("agency_id");

    for (const { uuid } of listOfAgencyGuids) {
        const agency_id = uuid;
        const shapePointRows = [];
        const seenShapeIds = new Set();

        for (const line of lines) {
            const values = line.split(',').map(v => v.trim());
            const params = [];

            header.forEach((h, i) => {
                if (sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace(`${tableName}_`, ''))) {
                    params.push(values[i] || null);
                    if (h === `${tableName}_id`) seenShapeIds.add(values[i]);
                }
            });
            params.push(agency_id);
            shapePointRows.push(params);
        }

        // Bulk insert distinct shape PKs
        const shapeRows = [...seenShapeIds].map(id => [agency_id, id]);
        if (shapeRows.length > 0) await bulkInsert(client, tableName, ['agency_id', 'id'], shapeRows);

        // Bulk insert all shape points
        if (shapePointRows.length > 0) await bulkInsert(client, actualTableName, columns, shapePointRows);
    }
    console.log("COMPLETED SHAPES WRITES: " + static_feed_url);
};

const getFileContents = async (client, decompressed, fileName, tableName, headerSalt, static_feed_url) => {
    const file = decompressed.files.find(f => f.path === fileName);
    const content = await file.buffer();
    const lines = content.toString().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        throw new Error(`Invalid GTFS feed: ${fileName} must contain at least a header and one data line.`);
    }

    const s_header = lines.shift(); // Remove and store header as a str
    const header = s_header.split(',').map(h => h.trim()); // s -> arr

    // Get column columns from the table and extract it into an Arr<>... to validate against the feed
    const { rows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', tableName]
    );
    const sanitized_table_headers_no_id = rows.filter(r => r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url' && r.column_name !== 'api_key_in_header');
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url' && r.column_name !== 'api_key_in_header');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {

        if (tableName !== "agency" && h.column_name === 'agency_id') return;
        // look into this condition, not sure if this is what i meant. We want to ignore agency_id for agencies.txt
        if (!s_header.includes(`${headerSalt}_${h.column_name}`)) {
            console.log(`File ${fileName} in the GTFS feed ${static_feed_url} is missing required column: ${h.column_name} for table ${tableName}`);
        }
    });

    return { lines, header, sanitized_table_headers_no_id };
}

const getFileContentsFromTrip = async (client, decompressed, fileName, tableName, static_feed_url) => {
    const file = decompressed.files.find(f => f.path === fileName);
    const content = await file.buffer();
    const lines = content.toString().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
        throw new Error(`Invalid GTFS feed: ${fileName} must contain at least a header and one data line.`);
    }

    const s_header = lines.shift(); // Remove and store header as a str
    const header = s_header.split(',').map(h => h.trim()); // s -> arr

    // Get table columns from the table and extract it into an Arr<>... to validate against the feed
    const { rows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', tableName]
    );

    const sanitized_table_headers_no_id = rows;
    const sanitized_table_headers = rows.filter(r => r.column_name !== 'id' && r.column_name !== 'rt_feed_url' && r.column_name !== 'static_feed_url' && r.column_name !== 'api_key_in_header');

    // Validate that the feed contains all required columns (except id, rt_feed_url, static_feed_url)
    sanitized_table_headers.forEach(h => {

        if (tableName !== "agency" && h.column_name === 'agency_id') return;
        // look into this condition, not sure if this is what i meant. We want to ignore agency_id for agencies.txt
        if (!header.some(fileHeader => h.column_name === fileHeader)) {
            console.log(`File ${fileName} in the GTFS feed ${static_feed_url} is missing required column: ${h.column_name} for table ${tableName}`);
        }
    });

    return { lines, header, sanitized_table_headers_no_id };
}

const handleWriteFromStops = async (client, fileName, tableName, decompressed, listOfAgencyGuids, static_feed_url) => {
    console.log("INITIATING STOP WRITES: " + static_feed_url);

    var { lines, header, sanitized_table_headers_no_id } = await getFileContents(client, decompressed, fileName, tableName, tableName, static_feed_url);

    const columns = [...header.map(h => h.replace(`${tableName}_`, '')).filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];
    columns.push("agency_id");

    const stopIdsByAgency = new Map();

    for (const { uuid } of listOfAgencyGuids) {
        const agency_id = uuid;
        const rows = [];
        const stopIds = new Set();

        for (const line of lines) {
            const values = line.split(',').map(v => v.trim());
            const params = [];

            header.forEach((h, i) => {
                if (sanitized_table_headers_no_id.some(sh => sh.column_name === h.replace(`${tableName}_`, ''))) {
                    params.push(values[i] || null);
                    if (h === `${tableName}_id`) stopIds.add(values[i]);
                }
            });
            params.push(agency_id);
            rows.push(params);
        }

        if (rows.length > 0) await bulkInsert(client, tableName, columns, rows);
        stopIdsByAgency.set(agency_id, stopIds);
    }
    console.log("COMPLETED STOP WRITES: " + static_feed_url);
    return stopIdsByAgency;
};

module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip, handleWriteFromStops };