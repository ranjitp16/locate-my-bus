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
