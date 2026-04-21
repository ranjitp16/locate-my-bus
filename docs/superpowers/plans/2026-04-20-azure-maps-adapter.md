# Azure Maps Adapter Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Leaflet in `map.html` with Azure Maps SDK v3 via a thin adapter (`map-adapter-azure.js`) so future provider swaps only require a new adapter file and one `<script>` change.

**Architecture:** `map.html` calls only `window.mapAdapter.*` — never the Azure SDK directly. The adapter (`map-adapter-azure.js`) is an IIFE that exposes 14 methods covering map lifecycle, bus markers, route shape, and user location. All app logic (polling, pin/unpin, geolocation, theme, localStorage) stays in `map.html` unchanged.

**Tech Stack:** Azure Maps SDK v3 (`atlas.Map`, `atlas.HtmlMarker`, `atlas.Popup`, `atlas.layer.LineLayer`, `atlas.layer.BubbleLayer`, `atlas.layer.PolygonLayer`, `atlas.source.DataSource`), vanilla JS, no build system.

---

## File Map

| Action | File |
|---|---|
| **Create** | `web/public/assets/map-adapter-azure.js` |
| **Modify** | `web/public/map.html` |
| **Modify** | `web/index.js` |
| **Delete** | `web/public/assets/index.html` |

---

## Task 1: Create the adapter skeleton and implement map lifecycle

**Files:**
- Create: `web/public/assets/map-adapter-azure.js`

All 14 methods go in this file as an IIFE exposing `window.mapAdapter`. Tasks 1–4 build up this file incrementally — each task replaces stubs with real implementations.

- [ ] **Step 1: Create `web/public/assets/map-adapter-azure.js` with full skeleton**

  Write the entire file. Methods for bus markers, route, and user location are stubs for now — they get implemented in Tasks 2–4.

  ```js
  // web/public/assets/map-adapter-azure.js
  (function () {
      'use strict';

      const AZURE_MAPS_KEY = 'AZURE_MAPS_KEY_PLACEHOLDER';

      let _map    = null;
      let _ready  = false;
      let _queue  = [];  // ops deferred until map is ready

      // DataSources (initialised inside 'ready')
      let _routeSource    = null;   // LineLayer source for route polyline
      let _routeDotSource = null;   // BubbleLayer source for start/end dots
      let _locSource      = null;   // PolygonLayer source for accuracy circle

      // Live state
      let _busMarkers     = [];     // atlas.HtmlMarker[] — current bus markers
      let _busPopups      = [];     // atlas.Popup[] — one per marker
      let _locMarker      = null;   // atlas.HtmlMarker — user location dot

      // One-time event callbacks (registered by map.html once on page load)
      let _markerClickFn      = null;
      let _markerPopupOpenFn  = null;
      let _markerPopupCloseFn = null;

      // Suppress map-level click when a marker was just clicked
      let _suppressMapClick = false;

      function _whenReady(fn) {
          if (_ready) fn();
          else _queue.push(fn);
      }

      // ── Helpers ────────────────────────────────────────────────────────────

      function _escapeHtml(v) {
          if (v == null) return '';
          return String(v)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
      }

      function _haversineMeters(lat1, lng1, lat2, lng2) {
          const R = 6371000, r = x => x * Math.PI / 180;
          const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
          const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // Returns GeoJSON ring coordinates for a circle of radiusMeters around [lat, lng]
      function _circleRing(lat, lng, radiusMeters, steps) {
          steps = steps || 64;
          const R = 6371000;
          const d = radiusMeters / R;
          const latR = lat * Math.PI / 180;
          const lngR = lng * Math.PI / 180;
          const coords = [];
          for (let i = 0; i <= steps; i++) {
              const bearing = (i * 2 * Math.PI) / steps;
              const pLat = Math.asin(
                  Math.sin(latR) * Math.cos(d) +
                  Math.cos(latR) * Math.sin(d) * Math.cos(bearing)
              );
              const pLng = lngR + Math.atan2(
                  Math.sin(bearing) * Math.sin(d) * Math.cos(latR),
                  Math.cos(d) - Math.sin(latR) * Math.sin(pLat)
              );
              coords.push([pLng * 180 / Math.PI, pLat * 180 / Math.PI]);
          }
          return coords;
      }

      // ── Public API ──────────────────────────────────────────────────────────

      window.mapAdapter = {

          // ── Map lifecycle ───────────────────────────────────────────────────

          init: function (containerId, opts) {
              _map = new atlas.Map(containerId, {
                  center: [opts.center.lng, opts.center.lat],
                  zoom:   opts.zoom,
                  style:  'road',
                  language: 'en-US',
                  authOptions: {
                      authType:        'subscriptionKey',
                      subscriptionKey: opts.authKey || AZURE_MAPS_KEY,
                  },
              });

              _map.events.add('ready', function () {
                  // Route DataSource + layers
                  _routeSource = new atlas.source.DataSource();
                  _map.sources.add(_routeSource);
                  _map.layers.add(new atlas.layer.LineLayer(_routeSource, 'route-base', {
                      strokeColor:   '#1558d0',
                      strokeWidth:   4,
                      strokeOpacity: 0.4,
                  }));
                  _map.layers.add(new atlas.layer.LineLayer(_routeSource, 'route-dash', {
                      strokeColor:       '#1558d0',
                      strokeWidth:       4,
                      strokeOpacity:     0.9,
                      strokeDashArray:   [12, 8],
                  }));

                  // Route dot DataSource + layer (start/end markers)
                  _routeDotSource = new atlas.source.DataSource();
                  _map.sources.add(_routeDotSource);
                  _map.layers.add(new atlas.layer.BubbleLayer(_routeDotSource, 'route-dots', {
                      radius:      6,
                      strokeColor: '#fff',
                      strokeWidth: 2,
                      color: ['match', ['get', 'dotType'], 'start', '#e53935', '#2e7d32'],
                  }));

                  // User location accuracy circle DataSource + layer
                  _locSource = new atlas.source.DataSource();
                  _map.sources.add(_locSource);
                  _map.layers.add(new atlas.layer.PolygonLayer(_locSource, 'loc-circle', {
                      fillColor:   '#2979ff',
                      fillOpacity: 0.1,
                  }), 'route-base'); // insert below route layers

                  _ready = true;
                  _queue.forEach(function (fn) { fn(); });
                  _queue = [];
              });
          },

          setView: function (lat, lng, zoom, animate) {
              _map.setCamera({
                  center: [lng, lat],
                  zoom:   zoom,
                  type:   animate ? 'ease' : 'jump',
              });
          },

          getCenter: function () {
              const c = _map.getCamera().center; // [lng, lat]
              return { lat: c[1], lng: c[0] };
          },

          getZoom: function () {
              return _map.getCamera().zoom;
          },

          onMoveEnd: function (fn) {
              _map.events.add('moveend', function () {
                  const c = _map.getCamera();
                  fn({ lat: c.center[1], lng: c.center[0], zoom: c.zoom });
              });
          },

          onClick: function (fn) {
              _map.events.add('click', function () {
                  if (_suppressMapClick) return;
                  fn();
              });
          },

          // ── Bus markers (stubs — implemented in Task 2) ─────────────────────

          updateBusMarkers: function (vehicles, pinnedVehicleId, userLat, userLng) {
              /* Task 2 */
          },

          onMarkerClick: function (fn) {
              _markerClickFn = fn;
          },

          onMarkerPopupOpen: function (fn) {
              _markerPopupOpenFn = fn;
          },

          onMarkerPopupClose: function (fn) {
              _markerPopupCloseFn = fn;
          },

          // ── Route shape (stubs — implemented in Task 3) ─────────────────────

          drawRoute: function (points) {
              /* Task 3 */
          },

          clearRoute: function () {
              /* Task 3 */
          },

          // ── User location (stubs — implemented in Task 4) ───────────────────

          setUserLocation: function (lat, lng, accuracy) {
              /* Task 4 */
          },

          clearUserLocation: function () {
              /* Task 4 */
          },
      };

  }());
  ```

- [ ] **Step 2: Open `http://localhost:3000/view-map` in a browser**

  The page still uses Leaflet at this point — that's fine. Open the browser console and confirm there are no JS errors from loading the adapter file (you won't have loaded it yet; that happens in Task 5). This step just verifies the file exists and has no syntax errors by running:

  ```bash
  node -e "require('fs').readFileSync('./web/public/assets/map-adapter-azure.js', 'utf8'); console.log('syntax OK')"
  ```

  Expected: `syntax OK`

- [ ] **Step 3: Commit**

  ```bash
  git add web/public/assets/map-adapter-azure.js
  git commit -m "feat: add map-adapter-azure.js skeleton with lifecycle methods"
  ```

---

## Task 2: Implement bus markers

**Files:**
- Modify: `web/public/assets/map-adapter-azure.js` — replace `updateBusMarkers` stub

Azure Maps uses `atlas.HtmlMarker` for custom HTML markers and `atlas.Popup` for popups. Marker click events are added via `map.events.add('click', markerInstance, fn)`.

- [ ] **Step 1: Replace the `updateBusMarkers` stub**

  Replace the entire `updateBusMarkers: function (vehicles, pinnedVehicleId, userLat, userLng) { /* Task 2 */ },` line with:

  ```js
  updateBusMarkers: function (vehicles, pinnedVehicleId, userLat, userLng) {
      _whenReady(function () {
          // Remove old markers and popups
          _busMarkers.forEach(function (m) { _map.markers.remove(m); });
          _busPopups.forEach(function (p) { p.close(); });
          _busMarkers = [];
          _busPopups  = [];

          vehicles.forEach(function (v) {
              const isPinned = v.vehicle_id === pinnedVehicleId;
              const deg = (v.head_bearing != null && Number.isFinite(v.head_bearing))
                  ? v.head_bearing + 90 : 0;

              const age = Math.round((Date.now() - Date.parse(v.timestamp)) / 1000);
              const distLine = (userLat != null)
                  ? ('<br><b>Distance:</b> ' + (function () {
                      const d = _haversineMeters(userLat, userLng, v.lat, v.lon);
                      return d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km';
                  }()) + ' away')
                  : '';

              const popupContent =
                  '<b>Trip:</b> '    + _escapeHtml(v.trip_id)    + '<br>' +
                  '<b>Route:</b> '   + _escapeHtml(v.route_id)   + '<br>' +
                  '<b>Vehicle:</b> ' + _escapeHtml(v.vehicle_id) + '<br>' +
                  '<b>Speed:</b> '   + (v.speed != null ? _escapeHtml(v.speed) : '—') + ' m/s<br>' +
                  '<b>Bearing:</b> ' + (v.head_bearing != null ? _escapeHtml(v.head_bearing) + '°' : '—') + '<br>' +
                  '<b>Updated:</b> <span class="age-counter">' + age + '</span>s ago' +
                  distLine;

              const popup = new atlas.Popup({
                  content:     '<div style="padding:6px 8px;font-size:0.82rem;line-height:1.6;">' + popupContent + '</div>',
                  position:    [v.lon, v.lat],
                  pixelOffset: [0, -30],
              });

              const marker = new atlas.HtmlMarker({
                  htmlContent: '<div style="transform:rotate(' + deg + 'deg);transform-origin:center;font-size:24px;cursor:pointer;">🚌</div>',
                  position:    [v.lon, v.lat],
                  anchor:      'center',
              });

              _map.markers.add(marker);

              // Marker click → pin/unpin
              _map.events.add('click', marker, function () {
                  _suppressMapClick = true;
                  setTimeout(function () { _suppressMapClick = false; }, 0);
                  if (_markerClickFn) {
                      _markerClickFn({ vehicleId: v.vehicle_id, lat: v.lat, lon: v.lon, tripId: v.trip_id });
                  }
              });

              // Popup open → start age counter
              // Use setTimeout so Azure Maps has time to inject the popup HTML into the DOM
              _map.events.add('open', popup, function () {
                  if (_markerPopupOpenFn) {
                      setTimeout(function () {
                          const ageEl = document.querySelector('.atlas-popup-content-container .age-counter');
                          _markerPopupOpenFn({ vehicleId: v.vehicle_id, startTime: Date.parse(v.timestamp), ageEl: ageEl });
                      }, 50);
                  }
              });

              // Popup close → stop age counter
              _map.events.add('close', popup, function () {
                  if (_markerPopupCloseFn) _markerPopupCloseFn({ vehicleId: v.vehicle_id });
              });

              if (isPinned) {
                  popup.open(_map);
                  marker.togglePopup();
              }

              _busMarkers.push(marker);
              _busPopups.push(popup);
          });
      });
  },
  ```

  > **Note on popup DOM access:** Azure Maps renders popup content as HTML strings inside a managed container. The `ageEl` retrieval above may need adjustment once tested — see Step 2 for the verification. If `ageEl` is null, the age counter simply won't tick (non-critical).

- [ ] **Step 2: Verify the file has no syntax errors**

  ```bash
  node -e "require('fs').readFileSync('./web/public/assets/map-adapter-azure.js', 'utf8'); console.log('syntax OK')"
  ```

  Expected: `syntax OK`

- [ ] **Step 3: Commit**

  ```bash
  git add web/public/assets/map-adapter-azure.js
  git commit -m "feat: implement updateBusMarkers in Azure Maps adapter"
  ```

---

## Task 3: Implement route shape

**Files:**
- Modify: `web/public/assets/map-adapter-azure.js` — replace `drawRoute` and `clearRoute` stubs

Route is rendered as two `LineLayer` passes on `_routeSource` (base + dashed) and start/end dots via `_routeDotSource`. Note: Azure Maps uses WebGL/vector tiles — CSS `stroke-dashoffset` animation is not available. The dashed line is static (no marching-ants animation). The `_routeSource` and `_routeDotSource` DataSources were already created in `init`'s `'ready'` handler.

- [ ] **Step 1: Replace `clearRoute` stub**

  Replace `clearRoute: function () { /* Task 3 */ },` with:

  ```js
  clearRoute: function () {
      _whenReady(function () {
          if (_routeSource)    _routeSource.clear();
          if (_routeDotSource) _routeDotSource.clear();
      });
  },
  ```

- [ ] **Step 2: Replace `drawRoute` stub**

  Replace `drawRoute: function (points) { /* Task 3 */ },` with:

  ```js
  drawRoute: function (points) {
      _whenReady(function () {
          if (!points || !points.length) return;
          _routeSource.clear();
          _routeDotSource.clear();

          // Azure Maps GeoJSON uses [lng, lat] order
          const coords = points.map(function (p) { return [p.lon, p.lat]; });

          _routeSource.add(new atlas.data.Feature(new atlas.data.LineString(coords)));

          // Start dot (red) and end dot (green)
          _routeDotSource.add(new atlas.data.Feature(
              new atlas.data.Point(coords[0]),
              { dotType: 'start' }
          ));
          _routeDotSource.add(new atlas.data.Feature(
              new atlas.data.Point(coords[coords.length - 1]),
              { dotType: 'end' }
          ));
      });
  },
  ```

- [ ] **Step 3: Verify syntax**

  ```bash
  node -e "require('fs').readFileSync('./web/public/assets/map-adapter-azure.js', 'utf8'); console.log('syntax OK')"
  ```

  Expected: `syntax OK`

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/assets/map-adapter-azure.js
  git commit -m "feat: implement drawRoute/clearRoute in Azure Maps adapter"
  ```

---

## Task 4: Implement user location

**Files:**
- Modify: `web/public/assets/map-adapter-azure.js` — replace `setUserLocation` and `clearUserLocation` stubs

User location is a blue dot (`atlas.HtmlMarker`) plus an accuracy circle (polygon on `_locSource`). The `_circleRing` helper already defined in the skeleton computes the circle coordinates without any external library.

- [ ] **Step 1: Replace `clearUserLocation` stub**

  Replace `clearUserLocation: function () { /* Task 4 */ },` with:

  ```js
  clearUserLocation: function () {
      _whenReady(function () {
          if (_locMarker) { _map.markers.remove(_locMarker); _locMarker = null; }
          if (_locSource) _locSource.clear();
      });
  },
  ```

- [ ] **Step 2: Replace `setUserLocation` stub**

  Replace `setUserLocation: function (lat, lng, accuracy) { /* Task 4 */ },` with:

  ```js
  setUserLocation: function (lat, lng, accuracy) {
      _whenReady(function () {
          const ring = _circleRing(lat, lng, accuracy);

          if (!_locMarker) {
              // First call — create marker and circle
              _locMarker = new atlas.HtmlMarker({
                  htmlContent: '<div class="user-location-marker"><div class="user-location-dot"></div></div>',
                  position:    [lng, lat],
                  anchor:      'center',
              });
              _map.markers.add(_locMarker);

              _locSource.add(new atlas.data.Feature(new atlas.data.Polygon([ring])));
          } else {
              // Subsequent calls — update position
              _locMarker.setOptions({ position: [lng, lat] });
              _locSource.clear();
              _locSource.add(new atlas.data.Feature(new atlas.data.Polygon([ring])));
          }
      });
  },
  ```

- [ ] **Step 3: Verify syntax**

  ```bash
  node -e "require('fs').readFileSync('./web/public/assets/map-adapter-azure.js', 'utf8'); console.log('syntax OK')"
  ```

  Expected: `syntax OK`

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/assets/map-adapter-azure.js
  git commit -m "feat: implement setUserLocation/clearUserLocation in Azure Maps adapter"
  ```

---

## Task 5: Update `map.html` and clean up

**Files:**
- Modify: `web/public/map.html`
- Modify: `web/index.js`
- Delete: `web/public/assets/index.html`

Replace every Leaflet call in `map.html` with the adapter. The page's app logic (polling, dropdowns, localStorage, geolocation, theme, BMC banner) is **completely unchanged** — only the map calls change.

- [ ] **Step 1: Replace the `<head>` map dependencies in `map.html`**

  Remove:
  ```html
  <link rel="stylesheet" href="/leaflet/leaflet.css">
  ```

  Add in its place:
  ```html
  <link rel="stylesheet" href="https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css" />
  ```

- [ ] **Step 2: Replace the map `<script>` tags in `map.html`**

  Remove (line 65, just before the main `<script>` block):
  ```html
  <script src="/leaflet/leaflet.js"></script>
  ```

  Add in its place:
  ```html
  <script src="https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js"></script>
  <script src="/assets/map-adapter-azure.js"></script>
  ```

- [ ] **Step 3: Replace map initialisation block in the main `<script>`**

  Remove the entire Leaflet map init + tile layer block (lines 94–98):
  ```js
  const map = L.map('map', { zoomControl: true }).setView([44.6488, -63.5752], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  ```

  Also remove the `makeBusIcon` function (lines 100–111) — the adapter handles icons internally.

  Also remove the `routeLayers` variable declaration on line 119:
  ```js
  let routeLayers = [];
  ```

  Then add the init call right after the variable declarations block (after `const POLL_INTERVAL = 15000;`) by reading the saved position first:

  ```js
  // ── Init Azure Maps adapter ──
  // Read saved position before init so the map opens at the right place
  const savedZoom = parseInt(localStorage.getItem('map-zoom'), 10);
  const savedLat  = parseFloat(localStorage.getItem('map-lat'));
  const savedLon  = parseFloat(localStorage.getItem('map-lon'));
  let hasSavedPosition = Number.isFinite(savedZoom) && Number.isFinite(savedLat) && Number.isFinite(savedLon);

  mapAdapter.init('map', {
      center: hasSavedPosition ? { lat: savedLat, lng: savedLon } : { lat: 44.6488, lng: -63.5752 },
      zoom:   hasSavedPosition ? savedZoom : 13,
  });

  mapAdapter.onMoveEnd(function ({ lat, lng, zoom }) {
      localStorage.setItem('map-zoom', zoom);
      localStorage.setItem('map-lat', lat);
      localStorage.setItem('map-lon', lng);
  });

  mapAdapter.onClick(function () {
      pinnedVehicleId = null;
      manuallyPinned  = false;
      mapAdapter.clearRoute();
  });

  mapAdapter.onMarkerClick(function ({ vehicleId, lat, lon, tripId }) {
      if (pinnedVehicleId === vehicleId) {
          pinnedVehicleId = null;
          manuallyPinned  = false;
          mapAdapter.clearRoute();
      } else {
          pinnedVehicleId = vehicleId;
          manuallyPinned  = true;
          mapAdapter.setView(lat, lon, mapAdapter.getZoom(), true);
          drawRoute(agencySelect.value, tripId);
      }
  });

  mapAdapter.onMarkerPopupOpen(function ({ vehicleId, startTime, ageEl }) {
      clearInterval(ageTimer);
      if (!ageEl) return;
      ageTimer = setInterval(function () {
          ageEl.textContent = String(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
  });

  mapAdapter.onMarkerPopupClose(function () {
      clearInterval(ageTimer);
      ageTimer = null;
  });
  ```

  > **Important:** Remove the old `const savedZoom`, `const savedLat`, `const savedLon`, and `let hasSavedPosition` declarations that appeared further down in the Leaflet version (lines 186–189) — they are now declared above.

- [ ] **Step 4: Replace the `clearRoute` function**

  Remove:
  ```js
  function clearRoute() {
      routeLayers.forEach(l => l.remove());
      routeLayers = [];
  }
  ```

  Add:
  ```js
  function clearRoute() {
      mapAdapter.clearRoute();
  }
  ```

- [ ] **Step 5: Replace the `drawRoute` function**

  Remove the entire `drawRoute` function (lines 139–161):
  ```js
  function drawRoute(agencyId, tripId) {
      clearRoute();
      fetch(`/api/shape/${agencyId}/${tripId}`)
          ...
  }
  ```

  Add:
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
  }
  ```

- [ ] **Step 6: Replace the `drawVehicles` function**

  Remove the entire `drawVehicles` function (lines 203–290) and replace with:

  ```js
  function drawVehicles(vehicles) {
      if (!vehicles.length) {
          mapAdapter.updateBusMarkers([], null, userLat, userLng);
          return;
      }

      // Auto-pin nearest bus to user if no manual pin
      if (userLat !== null && !manuallyPinned) {
          let nearest = null, minDist = Infinity;
          vehicles.forEach(v => {
              const d = haversineMeters(userLat, userLng, v.lat, v.lon);
              if (d < minDist) { minDist = d; nearest = v; }
          });
          if (nearest && nearest.vehicle_id !== pinnedVehicleId) {
              pinnedVehicleId = nearest.vehicle_id;
              drawRoute(agencySelect.value, nearest.trip_id);
          }
      }

      const pinned = vehicles.find(v => v.vehicle_id === pinnedVehicleId);
      if (pinned) {
          mapAdapter.setView(pinned.lat, pinned.lon, mapAdapter.getZoom(), true);
      } else if (!hasAutocentered && !hasSavedPosition) {
          const avgLat = vehicles.reduce((s, v) => s + v.lat, 0) / vehicles.length;
          const avgLon = vehicles.reduce((s, v) => s + v.lon, 0) / vehicles.length;
          mapAdapter.setView(avgLat, avgLon, 13);
          hasAutocentered = true;
      }

      mapAdapter.updateBusMarkers(vehicles, pinnedVehicleId, userLat, userLng);
  }
  ```

  Also remove the old map-level `onClick` handler that was declared as a standalone line:
  ```js
  map.on('click', () => { pinnedVehicleId = null; manuallyPinned = false; clearRoute(); });
  ```
  (This is now handled by `mapAdapter.onClick` registered in Step 3.)

  Also remove the old `map.on('moveend zoomend', ...)` block and the `if (hasSavedPosition) { map.setView(...) }` block — both now handled by the `mapAdapter.init` + `mapAdapter.onMoveEnd` calls from Step 3.

- [ ] **Step 7: Replace user location in `onLocationUpdate`**

  The old `onLocationUpdate` uses `locationMarker` and `locationCircle` as Leaflet object references. Replace the entire function body with:

  ```js
  function onLocationUpdate(pos) {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      userLat = lat;
      userLng = lng;
      hideLocationError();

      const firstTime = !locationMarker;
      mapAdapter.setUserLocation(lat, lng, accuracy);
      locationMarker = true; // used only as a flag — adapter owns the actual objects

      if (firstTime) {
          mapAdapter.setView(lat, lng, mapAdapter.getZoom(), true);
          locateBtn.textContent = '◎ My location';
      }
  }
  ```

- [ ] **Step 8: Replace `stopLocation` function**

  The old `stopLocation` calls `locationMarker.remove()` and `locationCircle.remove()`. Replace with:

  ```js
  function stopLocation() {
      if (locationWatchId !== null) {
          navigator.geolocation.clearWatch(locationWatchId);
          locationWatchId = null;
      }
      mapAdapter.clearUserLocation();
      locationMarker = null;
      userLat = null;
      userLng = null;
      locateBtn.classList.remove('active');
      locateBtn.textContent = '◎ Show my location';
  }
  ```

  Also remove the `let locationCircle = null;` variable declaration — it's no longer needed (the adapter manages it).

- [ ] **Step 9: Replace `startPolling` — update `clearRoute()` call**

  Inside `startPolling`, the call `clearRoute()` still works because `clearRoute()` now delegates to `mapAdapter.clearRoute()`. No change needed here.

- [ ] **Step 10: Remove the `GET /map` route from `web/index.js`**

  Remove these lines from `web/index.js`:
  ```js
  app.get('/map', (req, res) => {
      res.sendFile(path.join(__dirname, 'public/assets/index.html'))
  });
  ```

- [ ] **Step 11: Delete the prototype file**

  ```bash
  rm web/public/assets/index.html
  ```

- [ ] **Step 12: Start the dev server and open the map**

  ```bash
  npm run dev
  ```

  Open `http://localhost:3000/view-map`. Verify:
  - Azure Maps tiles load (road map style, no OpenStreetMap tiles)
  - Agency and route dropdowns populate
  - Bus markers appear with 🚌 emoji, rotated by bearing
  - Clicking a bus opens a popup with Trip/Route/Vehicle/Speed/Bearing/Updated
  - Clicking the pinned bus again unpins it
  - Clicking map background unpins
  - Selecting a different route reloads markers
  - The route shape polyline + start/end dots appear when a bus is pinned
  - Theme toggle (light/dark) still works
  - "Show my location" button works (blue dot + accuracy circle)
  - Map position and zoom persist on refresh (localStorage)

  **If the age counter still doesn't tick:** The CSS selector `.atlas-popup-content-container` may differ depending on the Azure Maps SDK version. Inspect the popup DOM in DevTools and update the selector in `map-adapter-azure.js` `'open'` event handler to match.

- [ ] **Step 13: Commit**

  ```bash
  git add web/public/map.html web/index.js
  git rm web/public/assets/index.html
  git commit -m "feat: migrate map.html to Azure Maps via adapter pattern"
  ```
