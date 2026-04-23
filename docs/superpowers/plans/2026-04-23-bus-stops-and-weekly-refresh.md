# Bus Stops & Weekly Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import bus stop data from GTFS static feeds, display stop markers on the map when a bus is pinned, and provide a weekly purge + re-onboard mechanism triggered by the C++ daemon and a dashboard button.

**Architecture:** Extend the existing unified onboarding pipeline with two new GTFS file handlers (`stops.txt`, `stop_times.txt`), add a new API endpoint to serve stop data for pinned buses, render stop dot markers on the Azure Maps adapter, and add a `POST /api/agencies/refresh` endpoint that truncates non-agency data and re-onboards all agencies. The daemon checks weekly at 08:00 UTC and calls this endpoint.

**Tech Stack:** Node.js/Express, PostgreSQL, Azure Maps SDK v3, C++ (libcurl, libpqxx)

**Spec:** `docs/superpowers/specs/2026-04-23-bus-stops-and-weekly-refresh-design.md`

**Note:** This project has no test framework. Verification steps use manual testing (curl, browser, psql).

---

### Task 1: Database Schema — Add `stop` and `stop_time` tables

**Files:**
- Modify: `db/schema/init.sql:130` (append after the last line)

- [ ] **Step 1: Append the two CREATE TABLE statements to init.sql**

Add this SQL at the end of `db/schema/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.stop (
    id                  VARCHAR(45)         NOT NULL,
    agency_id           UUID                NOT NULL,
    code                VARCHAR(45),
    name                VARCHAR(500),
    description         VARCHAR(1000),
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,
    location_type       VARCHAR(10),
    wheelchair_boarding VARCHAR(10),
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.stop_time (
    agency_id       UUID            NOT NULL,
    trip_id         VARCHAR(45)     NOT NULL,
    stop_id         VARCHAR(45)     NOT NULL,
    arrival_time    VARCHAR(10),
    departure_time  VARCHAR(10),
    stop_sequence   VARCHAR(10)     NOT NULL,
    pickup_type     VARCHAR(10),
    drop_off_type   VARCHAR(10),
    timepoint       VARCHAR(10),
    PRIMARY KEY (agency_id, trip_id, stop_id, stop_sequence),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE,
    CONSTRAINT fk_trip   FOREIGN KEY (agency_id, trip_id) REFERENCES public.trip (agency_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_stop   FOREIGN KEY (agency_id, stop_id) REFERENCES public.stop (agency_id, id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Apply to the dev database**

Run:
```bash
psql -U postgres -d locate_my_bus -c "
CREATE TABLE IF NOT EXISTS public.stop (
    id VARCHAR(45) NOT NULL, agency_id UUID NOT NULL,
    code VARCHAR(45), name VARCHAR(500), description VARCHAR(1000),
    lat DOUBLE PRECISION, lon DOUBLE PRECISION,
    location_type VARCHAR(10), wheelchair_boarding VARCHAR(10),
    PRIMARY KEY (agency_id, id),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.stop_time (
    agency_id UUID NOT NULL, trip_id VARCHAR(45) NOT NULL,
    stop_id VARCHAR(45) NOT NULL, arrival_time VARCHAR(10),
    departure_time VARCHAR(10), stop_sequence VARCHAR(10) NOT NULL,
    pickup_type VARCHAR(10), drop_off_type VARCHAR(10), timepoint VARCHAR(10),
    PRIMARY KEY (agency_id, trip_id, stop_id, stop_sequence),
    CONSTRAINT fk_agency FOREIGN KEY (agency_id) REFERENCES public.agency (id) ON DELETE CASCADE,
    CONSTRAINT fk_trip FOREIGN KEY (agency_id, trip_id) REFERENCES public.trip (agency_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_stop FOREIGN KEY (agency_id, stop_id) REFERENCES public.stop (agency_id, id) ON DELETE CASCADE
);"
```

Expected: both tables created without error.

- [ ] **Step 3: Verify the tables exist**

Run:
```bash
psql -U postgres -d locate_my_bus -c "\dt public.stop*"
```

Expected: both `stop` and `stop_time` listed.

- [ ] **Step 4: Commit**

```bash
git add db/schema/init.sql
git commit -m "feat: add stop and stop_time tables to schema"
```

---

### Task 2: Repository — Add `handleWriteFromStops`

**Files:**
- Modify: `web/repository/addAgency.js:234` (add new function before `module.exports`, update exports)

- [ ] **Step 1: Add `handleWriteFromStops` function**

Add this function before the `module.exports` line in `web/repository/addAgency.js`. It follows the `handleWriteFromShapes` pattern — iterates per agency, collects all stop rows, bulk inserts them, and returns a Map of agency_id → Set of imported stop IDs.

```js
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
```

- [ ] **Step 2: Update module.exports to include the new function**

Change the existing `module.exports` line at the bottom of the file from:

```js
module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip };
```

to:

```js
module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip, handleWriteFromStops };
```

(`handleWriteFromStopTimes` will be added to exports in Task 3 after the function is defined.)

- [ ] **Step 3: Commit**

```bash
git add web/repository/addAgency.js
git commit -m "feat: add handleWriteFromStops to repository"
```

---

### Task 3: Repository — Add `handleWriteFromStopTimes`

**Files:**
- Modify: `web/repository/addAgency.js` (add new function after `handleWriteFromStops`, before `module.exports`)

- [ ] **Step 1: Add `handleWriteFromStopTimes` function**

Add this function after `handleWriteFromStops` and before `module.exports`. It follows the `handleWriteFromTrip` pattern — uses `getFileContentsFromTrip` (no prefix stripping), filters by known trip IDs and stop IDs.

```js
const handleWriteFromStopTimes = async (client, fileName, tableName, decompressed, listOfAgencyGuids, stopIdsByAgency, static_feed_url) => {
    console.log("INITIATING STOP_TIME WRITES: " + static_feed_url);

    let { lines, header, sanitized_table_headers_no_id } = await getFileContentsFromTrip(client, decompressed, fileName, tableName, static_feed_url);

    const columns = [...header.filter(h => sanitized_table_headers_no_id.some(sh => sh.column_name === h))];
    columns.push("agency_id");

    const indexOfTrip = header.indexOf('trip_id');
    const indexOfStop = header.indexOf('stop_id');

    for (const { uuid } of listOfAgencyGuids) {
        const agency_id = uuid;
        const rows = [];

        // Load valid trip IDs for this agency
        const tripResult = await client.query('SELECT id FROM public.trip WHERE agency_id = $1', [agency_id]);
        const validTrips = new Set(tripResult.rows.map(r => r.id));

        const validStops = stopIdsByAgency.get(agency_id) || new Set();

        for (const line of lines) {
            const values = line.split(',').map(v => v.trim());

            const tripId = values[indexOfTrip];
            const stopId = values[indexOfStop];
            if (!validTrips.has(tripId)) continue;
            if (!validStops.has(stopId)) continue;

            const params = [];
            header.forEach((h, i) => {
                if (sanitized_table_headers_no_id.some(sh => sh.column_name === h)) {
                    params.push(values[i] || null);
                }
            });
            params.push(agency_id);
            rows.push(params);
        }

        if (rows.length > 0) await bulkInsert(client, tableName, columns, rows);
    }
    console.log("COMPLETED STOP_TIME WRITES: " + static_feed_url);
};
```

- [ ] **Step 2: Update module.exports to include handleWriteFromStopTimes**

Change the `module.exports` line (updated in Task 2) from:

```js
module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip, handleWriteFromStops };
```

to:

```js
module.exports = { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip, handleWriteFromStops, handleWriteFromStopTimes };
```

- [ ] **Step 3: Commit**

```bash
git add web/repository/addAgency.js
git commit -m "feat: add handleWriteFromStopTimes to repository"
```

---

### Task 4: Service Layer — Wire stops into onboarding

**Files:**
- Modify: `web/service/addAgency.js:4` (add imports)
- Modify: `web/service/addAgency.js:27` (add calls after trip import)

- [ ] **Step 1: Update the import line**

Change line 4 from:

```js
const { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip } = require('../repository/addAgency.js');
```

to:

```js
const { handleWriteFromAgency, handleWriteFromRoutes, handleWriteFromShapes, handleWriteFromTrip, handleWriteFromStops, handleWriteFromStopTimes } = require('../repository/addAgency.js');
```

- [ ] **Step 2: Add the two new handler calls inside onBoardAgency**

After the existing `handleWriteFromTrip` call (line 27), add:

```js
        let stopIdsByAgency = await handleWriteFromStops(client, 'stops.txt', 'stop', decompressed, listOfGuid, static_feed_url);
        await handleWriteFromStopTimes(client, 'stop_times.txt', 'stop_time', decompressed, listOfGuid, stopIdsByAgency, static_feed_url);
```

This keeps everything inside the existing transaction.

- [ ] **Step 3: Verify by re-onboarding an agency**

Start the dev server (`npm run dev`), then onboard an agency via the dashboard (`/dash/agencies`). Check the logs for `INITIATING STOP WRITES` and `COMPLETED STOP_TIME WRITES` messages.

Then verify data was inserted:
```bash
psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) FROM public.stop;"
psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) FROM public.stop_time;"
```

Expected: both return non-zero counts.

- [ ] **Step 4: Commit**

```bash
git add web/service/addAgency.js
git commit -m "feat: wire stop and stop_time imports into onboarding pipeline"
```

---

### Task 5: API Endpoint — `GET /api/stops/:agency_id/:trip_id`

**Files:**
- Modify: `web/index.js:400` (add new endpoint after the existing `/api/shape` endpoint)

- [ ] **Step 1: Add the stops endpoint**

Add this after the existing `app.get('/api/shape/:agency_id/:trip_id', ...)` block (after line 417 in `web/index.js`):

```js
app.get('/api/stops/:agency_id/:trip_id', async (req, res) => {
    const { agency_id, trip_id } = req.params;

    try {
        const { rows } = await pool.query(
            `SELECT s.id AS stop_id, s.name, s.code, s.lat, s.lon,
                    st.arrival_time, st.departure_time, st.stop_sequence,
                    s.wheelchair_boarding
             FROM public.stop_time st
             JOIN public.stop s ON s.agency_id = st.agency_id AND s.id = st.stop_id
             WHERE st.agency_id = $1 AND st.trip_id = $2
             ORDER BY st.stop_sequence::int ASC`,
            [agency_id, trip_id]
        );

        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stops.' });
    }
});
```

- [ ] **Step 2: Verify with curl**

Start the dev server and find a valid agency_id and trip_id:
```bash
psql -U postgres -d locate_my_bus -c "SELECT agency_id, trip_id FROM public.stop_time LIMIT 1;"
```

Then test:
```bash
curl -s http://localhost:3000/api/stops/<agency_id>/<trip_id> | head -c 500
```

Expected: JSON array of stop objects with `stop_id`, `name`, `lat`, `lon`, `arrival_time`, etc.

- [ ] **Step 3: Commit**

```bash
git add web/index.js
git commit -m "feat: add GET /api/stops/:agency_id/:trip_id endpoint"
```

---

### Task 6: API Endpoint — `POST /api/agencies/refresh`

**Files:**
- Modify: `web/index.js` (add new endpoint after the `/api/stops` endpoint)

- [ ] **Step 1: Add the refresh endpoint**

Add this endpoint in `web/index.js`, after the stops endpoint added in Task 5:

```js
app.post('/api/agencies/refresh', authMiddleware, async (req, res) => {
    try {
        // 1. Truncate all non-agency tables
        await pool.query('TRUNCATE route, shape, shape_point, trip, stop, stop_time, live_vehicle_position, poll_iteration, feed_execution CASCADE');

        // 2. Fetch all agencies
        const { rows: agencies } = await pool.query('SELECT id, rt_feed_url, static_feed_url, api_key_in_header FROM public.agency');

        const results = { refreshed: 0, errors: [] };

        // 3. Re-onboard each agency
        for (const agency of agencies) {
            try {
                await onBoardAgency(agency.rt_feed_url, agency.static_feed_url, agency.api_key_in_header);
                results.refreshed++;
            } catch (err) {
                console.error(`Refresh failed for agency ${agency.id}:`, err.message);
                results.errors.push({ agency_id: agency.id, error: err.message });
            }
        }

        res.json(results);
    } catch (err) {
        console.error('Refresh failed:', err);
        res.status(500).json({ error: 'Refresh failed: ' + err.message });
    }
});
```

- [ ] **Step 2: Verify the `onBoardAgency` function signature accepts all three args**

Check `web/service/addAgency.js` — the existing function signature is `onBoardAgency(rt_feed_url, static_feed_url, api_key)`. The refresh endpoint passes `agency.api_key_in_header` as the third arg, which maps to `api_key` in the function. This is correct — no changes needed.

- [ ] **Step 3: Verify with curl**

```bash
curl -s -X POST http://localhost:3000/api/agencies/refresh \
  -H 'x-access-key: changeme' | python3 -m json.tool
```

Expected: `{ "refreshed": <N>, "errors": [] }` where N is the number of agencies. The server logs should show the full onboarding flow for each agency.

- [ ] **Step 4: Verify data was re-populated**

```bash
psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) FROM public.route;"
psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) FROM public.stop;"
```

Expected: non-zero counts for both.

- [ ] **Step 5: Commit**

```bash
git add web/index.js
git commit -m "feat: add POST /api/agencies/refresh endpoint for weekly purge"
```

---

### Task 7: Map Adapter — Add `updateStopMarkers` and `clearStopMarkers`

**Files:**
- Modify: `web/public/assets/map-adapter-azure.js` (add stop marker state + two new public methods)
- Modify: `web/public/assets/map.css` (add stop marker and stop popup styles)

- [ ] **Step 1: Add stop marker state variables**

In `web/public/assets/map-adapter-azure.js`, add these state variables after the existing `_openPopup` declaration (after line 25):

```js
    // Stop markers (shown when a bus is pinned)
    let _stopMarkers = []; // array of { marker, popup }
    let _openStopPopup = null; // at most one stop popup open at a time
```

- [ ] **Step 2: Add `updateStopMarkers` method to the public API**

Add this method inside the `window.mapAdapter` object, after the `clearUserLocation` method (before the closing `};` on line 512):

```js
        // ── Stop markers ────────────────────────────────────────────────────

        updateStopMarkers: function (stops) {
            _whenReady(function () {
                // Clear any existing stop markers first
                _stopMarkers.forEach(function (s) {
                    _map.markers.remove(s.marker);
                    s.popup.close();
                });
                _stopMarkers = [];
                if (_openStopPopup) { _openStopPopup.close(); _openStopPopup = null; }

                if (!stops || !stops.length) return;

                stops.forEach(function (stop) {
                    // Format arrival time for display
                    var schedText = '';
                    if (stop.arrival_time) {
                        var parts = stop.arrival_time.split(':');
                        var h = parseInt(parts[0], 10);
                        var m = parts[1];
                        // Handle GTFS times past midnight (e.g., 25:30:00)
                        var suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
                        if (h >= 24) { h -= 24; suffix = 'AM'; }
                        else if (h > 12) { h -= 12; }
                        else if (h === 0) { h = 12; }
                        schedText = h + ':' + m + ' ' + suffix;
                    }

                    // Build popup content
                    var html = '<div class="stop-popup">';
                    html += '<div class="stop-popup-name">' + _escapeHtml(stop.name || 'Unnamed Stop') + '</div>';
                    if (schedText) {
                        html += '<div class="stop-popup-schedule">Scheduled: ' + _escapeHtml(schedText) + '</div>';
                    }
                    if (stop.code) {
                        html += '<div class="stop-popup-detail">Stop code: ' + _escapeHtml(stop.code) + '</div>';
                    }
                    if (stop.wheelchair_boarding === '1') {
                        html += '<div class="stop-popup-detail">&#9855; Wheelchair accessible</div>';
                    }
                    html += '</div>';

                    var popup = new atlas.Popup({
                        content: html,
                        position: [stop.lon, stop.lat],
                        pixelOffset: [0, -12],
                        closeButton: true,
                    });

                    var marker = new atlas.HtmlMarker({
                        htmlContent: '<div class="stop-dot"></div>',
                        position: [stop.lon, stop.lat],
                        anchor: 'center',
                    });

                    _map.markers.add(marker);

                    _map.events.add('click', marker, function () {
                        _suppressMapClick = true;
                        setTimeout(function () { _suppressMapClick = false; }, 0);
                        if (_openStopPopup === popup) {
                            popup.close();
                            _openStopPopup = null;
                        } else {
                            if (_openStopPopup) { _openStopPopup.close(); }
                            popup.open(_map);
                            _openStopPopup = popup;
                        }
                        // Do NOT close the pinned bus popup (_openPopup is untouched)
                    });

                    _map.events.add('close', popup, function () {
                        if (_openStopPopup === popup) _openStopPopup = null;
                    });

                    _stopMarkers.push({ marker: marker, popup: popup });
                });
            });
        },

        clearStopMarkers: function () {
            _whenReady(function () {
                _stopMarkers.forEach(function (s) {
                    _map.markers.remove(s.marker);
                    s.popup.close();
                });
                _stopMarkers = [];
                if (_openStopPopup) { _openStopPopup.close(); _openStopPopup = null; }
            });
        },
```

- [ ] **Step 3: Add stop marker and stop popup CSS to map.css**

Append these styles at the end of `web/public/assets/map.css`:

```css
/* ── Stop markers ── */
.stop-dot {
    /* Invisible 28x28 tap target around the visible dot */
    width: 28px;
    height: 28px;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
}
.stop-dot::after {
    content: '';
    width: 12px;
    height: 12px;
    background: var(--surface, #fff);
    border: 2.5px solid var(--accent, #1d6aed);
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

/* ── Stop popup — uses same theme vars as bus popup ── */
.stop-popup {
    padding: 6px 8px;
    font-size: 0.8rem;
    line-height: 1.5;
    max-width: 220px;
}
.stop-popup-name {
    font-weight: 700;
    margin-bottom: 2px;
}
.stop-popup-schedule {
    color: var(--accent, #1d6aed);
    font-size: 0.78rem;
}
.stop-popup-detail {
    color: var(--text-muted, #6b7280);
    font-size: 0.72rem;
}
```

The popup inherits theme colors from the existing Azure Maps popup CSS overrides already in `map.css` (`.popup-content-container` / `.atlas-popup-content-container` rules on lines 109-140), so the stop popup automatically respects light/dark theme.

- [ ] **Step 4: Commit**

```bash
git add web/public/assets/map-adapter-azure.js web/public/assets/map.css
git commit -m "feat: add stop marker and popup support to map adapter"
```

---

### Task 8: Map HTML — Fetch and render stops on bus pin

**Files:**
- Modify: `web/public/map.html` (update `drawRoute`, `clearRoute`, and map click handler)

- [ ] **Step 1: Update the `drawRoute` function to also fetch stops**

Replace the existing `drawRoute` function (lines 181-194 in `map.html`) with:

```js
    function drawRoute(agencyId, tripId) {
        clearRoute();
        fetch(`/api/shape/${agencyId}/${tripId}`)
            .then(r => r.json())
            .then(response => {
                const points = response.rows;
                if (!points.length) return;
                const sorted = points
                    .sort((a, b) => a.pt_sequence - b.pt_sequence)
                    .map(p => ({ lat: p.pt_lat, lon: p.pt_lon }));
                mapAdapter.drawRoute(sorted);
            })
            .catch(err => console.error('Shape fetch failed:', err));

        // Fetch stops in parallel
        fetch(`/api/stops/${agencyId}/${tripId}`)
            .then(r => r.json())
            .then(stops => {
                if (stops.length) mapAdapter.updateStopMarkers(stops);
            })
            .catch(err => console.error('Stops fetch failed:', err));
    }
```

- [ ] **Step 2: Update `clearRoute` to also clear stop markers**

Replace the existing `clearRoute` function (lines 177-179) with:

```js
    function clearRoute() {
        mapAdapter.clearRoute();
        mapAdapter.clearStopMarkers();
    }
```

- [ ] **Step 3: Verify in browser**

1. Start dev server: `npm run dev`
2. Open `http://localhost:3000/view-map` in a browser
3. Select an agency and route with running buses
4. Click/tap a bus marker to pin it
5. Verify: route polyline appears AND small dot markers appear at each stop along the route
6. Click a stop marker — verify popup shows stop name, "Scheduled: X:XX AM/PM", and details
7. Verify the bus popup stays open when clicking a stop marker
8. Click the map background to unpin — verify both route line and stop markers disappear
9. Switch to dark theme — verify stop popup background/text matches dark theme
10. Test on mobile viewport (Chrome DevTools responsive mode) — verify dots are tappable

- [ ] **Step 4: Commit**

```bash
git add web/public/map.html
git commit -m "feat: fetch and render stop markers when bus is pinned"
```

---

### Task 9: Dashboard — Add "Refresh All Agencies" button

**Files:**
- Modify: `web/public/dashboard.html` (add button to header area + JS handler)

- [ ] **Step 1: Add the refresh-all button next to the existing Refresh button**

In `web/public/dashboard.html`, find the header `div` with the existing refresh button (line 97-102). Replace it with:

```html
    <div class="d-flex align-items-center justify-content-between mb-4">
        <h4 class="fw-semibold mb-0">Poll Monitor</h4>
        <div class="d-flex gap-2">
            <button class="btn btn-sm" id="refresh-btn" style="background:var(--surface-alt);color:var(--text);border:1px solid var(--border);">
                <i class="fa-solid fa-rotate-right me-1"></i>Refresh
            </button>
            <button class="btn btn-sm" id="refresh-all-btn" style="background:var(--danger);color:#fff;border:1px solid var(--danger);">
                <i class="fa-solid fa-arrows-rotate me-1"></i>Refresh All Agencies
            </button>
        </div>
    </div>
```

- [ ] **Step 2: Add the JS click handler for the refresh-all button**

Add this script block after the existing `refresh-btn` click handler (after line 359 in `dashboard.html`):

```js
    /* ── Refresh All Agencies ── */
    document.getElementById('refresh-all-btn').addEventListener('click', async () => {
        const btn = document.getElementById('refresh-all-btn');
        if (!confirm('This will purge all data (except agencies) and re-onboard everything. Continue?')) return;
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> Refreshing…';
        try {
            const r = await fetch('/api/agencies/refresh', {
                method: 'POST',
                headers: { 'x-access-key': accessKey },
            });
            const result = await r.json();
            if (r.ok) {
                const msg = 'Refreshed ' + result.refreshed + ' agencies.' +
                    (result.errors.length ? ' Errors: ' + result.errors.length : '');
                alert(msg);
                // Reload dashboard data
                authFetch('/api/dashboard/stats').then(r => r.json()).then(renderStats).catch(() => {});
                loadIterations();
                if (analyticsLoaded) { analyticsLoaded = false; loadAnalytics(); }
            } else {
                alert('Refresh failed: ' + (result.error || r.status));
            }
        } catch (err) {
            alert('Network error during refresh.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    });
```

- [ ] **Step 3: Verify in browser**

1. Open `http://localhost:3000/dash/monitor`
2. Unlock with access key
3. Click "Refresh All Agencies" button
4. Confirm the dialog
5. Verify spinner shows, then success message appears
6. Verify dashboard data reloads
7. Check dark theme — button should remain visible and styled

- [ ] **Step 4: Commit**

```bash
git add web/public/dashboard.html
git commit -m "feat: add Refresh All Agencies button to dashboard"
```

---

### Task 10: Daemon — Weekly refresh trigger

**Files:**
- Modify: `daemon/main.cpp` (add refresh check in `main()` loop)

- [ ] **Step 1: Add the weekly refresh logic to main()**

In `daemon/main.cpp`, add the following changes to the `main()` function.

First, add a helper function before `main()` (after the `mainLogic` function, around line 350):

```cpp
void attemptWeeklyRefresh(const string& web_host, const string& access_key) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        cerr << "[refresh] curl_easy_init() failed\n";
        return;
    }

    string url = "http://" + web_host + ":3000/api/agencies/refresh";
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("x-access-key: " + access_key).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    stringstream response;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, "");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_data);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 300L); // 5 min timeout for full re-onboard

    CURLcode res = curl_easy_perform(curl);
    if (res == CURLE_OK) {
        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        cout << "[refresh] Weekly refresh completed. HTTP " << http_code
             << " Response: " << response.str() << "\n";
    } else {
        cerr << "[refresh] Weekly refresh failed: " << curl_easy_strerror(res) << "\n";
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
}
```

Then modify the `main()` function. Add these lines after `curl_global_init(CURL_GLOBAL_DEFAULT);` (line 377) and before the `while` loop:

```cpp
    // Weekly refresh state
    auto last_refresh = chrono::system_clock::now();
    string web_host = PG_HOST; // In devcontainer, web and daemon share the same docker network
    // Override with WEB_HOST env var if set
    const char* web_host_env = getenv("WEB_HOST");
    if (web_host_env) web_host = web_host_env;
    string access_key = getenv("DELETE_ACCESS_KEY") ? getenv("DELETE_ACCESS_KEY") : "";
```

Then inside the `while(g_running)` loop, add the refresh check **before** the existing `mainLogic()` call:

```cpp
        // Check for weekly refresh: 7 days elapsed AND current UTC hour is 08 (4 AM AST)
        {
            auto now = chrono::system_clock::now();
            auto elapsed = chrono::duration_cast<chrono::hours>(now - last_refresh).count();
            time_t now_t = chrono::system_clock::to_time_t(now);
            struct tm utc_tm;
            gmtime_r(&now_t, &utc_tm);

            if (elapsed >= 168 && utc_tm.tm_hour == 8) { // 168 hours = 7 days
                cout << "[refresh] Weekly refresh triggered at UTC hour " << utc_tm.tm_hour << "\n";
                attemptWeeklyRefresh(web_host, access_key);
                last_refresh = now; // Update regardless of success/failure
            }
        }
```

- [ ] **Step 2: Update .development.env to add WEB_HOST**

Add `WEB_HOST` to `.development.env` so the daemon knows where the web server is in the devcontainer:

```
WEB_HOST=localhost
```

Note: In production Docker, this would be the web container's hostname on the shared network.

- [ ] **Step 3: Verify the daemon compiles**

```bash
make build
```

Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add daemon/main.cpp .development.env
git commit -m "feat: add weekly refresh trigger to daemon at 08:00 UTC"
```

---

### Task 11: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Full end-to-end test**

1. Reset the DB and re-apply schema:
   ```bash
   psql -U postgres -d locate_my_bus -f db/schema/init.sql
   ```

2. Start the web server:
   ```bash
   npm run dev
   ```

3. Onboard an agency via `/dash/agencies`

4. Verify stops data:
   ```bash
   psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) AS stops FROM public.stop;"
   psql -U postgres -d locate_my_bus -c "SELECT COUNT(*) AS stop_times FROM public.stop_time;"
   ```

5. Open map (`/view-map`), pin a bus, verify stop dots + route appear

6. Click a stop dot, verify popup with "Scheduled: X:XX AM/PM", stop code, wheelchair

7. Verify bus popup stays open while stop popup is also open

8. Toggle dark theme — verify stop popup respects theme

9. Test mobile viewport — verify stop dots are tappable

10. Go to dashboard (`/dash/monitor`), click "Refresh All Agencies", confirm, verify success

11. After refresh, verify map still works (re-pin a bus, stops appear)

- [ ] **Step 2: Build daemon and verify compilation**

```bash
make build
```

Expected: clean build, no warnings on the new refresh code.

- [ ] **Step 3: Final commit (if any cleanup needed)**

```bash
git status
```

If clean, no commit needed. If there are fixup changes, commit them.
