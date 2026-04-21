(function () {
    'use strict';

    const AZURE_MAPS_KEY = 'AZURE_MAPS_KEY_PLACEHOLDER';

    let _map    = null;
    let _ready  = false;
    let _queue  = [];  // ops deferred until map is ready

    // DataSource for user location accuracy circle (WebGL polygon layer)
    let _locSource = null;

    // Live state
    let _busMarkers = [];   // atlas.HtmlMarker[] — current bus markers
    let _busPopups  = [];   // atlas.Popup[] — one per marker
    let _locMarker  = null; // atlas.HtmlMarker — user location dot

    // One-time event callbacks (registered by map.html once on page load)
    let _markerClickFn      = null;
    let _markerPopupOpenFn  = null;
    let _markerPopupCloseFn = null;

    // Suppress map-level click when a marker was just clicked
    let _suppressMapClick = false;

    // Currently open popup (at most one at a time)
    let _openPopup = null;

    // SVG overlay for route animation (replaces WebGL LineLayer approach)
    let _routeSvgEl     = null;  // <svg> element
    let _routeSvgCoords = null;  // [[lng, lat], ...] for reprojection on map move

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

    // ── SVG route overlay ──────────────────────────────────────────────────
    // Azure Maps renders via WebGL. The strokeDashArray layout property cannot
    // be animated smoothly at runtime (triggers shader recompilation each frame).
    // Instead, we layer an SVG element directly on the canvas container so the
    // existing CSS @keyframes dash-flow animation works identically to Leaflet.

    function _svgEl(tag, attrs) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    function _updateRouteSvg() {
        if (!_routeSvgEl || !_routeSvgCoords) return;
        const pixels = _map.positionsToPixels(_routeSvgCoords);
        if (!pixels || pixels.length < 2) return;

        const d = 'M ' + pixels.map(function (p) {
            return p[0].toFixed(1) + ',' + p[1].toFixed(1);
        }).join(' L ');

        _routeSvgEl.querySelector('.route-base').setAttribute('d', d);
        _routeSvgEl.querySelector('.route-dash').setAttribute('d', d);

        // Update start/end dot positions
        const s = pixels[0];
        const e = pixels[pixels.length - 1];
        _routeSvgEl.querySelector('.route-dot-start').setAttribute('cx', s[0].toFixed(1));
        _routeSvgEl.querySelector('.route-dot-start').setAttribute('cy', s[1].toFixed(1));
        _routeSvgEl.querySelector('.route-dot-end').setAttribute('cx', e[0].toFixed(1));
        _routeSvgEl.querySelector('.route-dot-end').setAttribute('cy', e[1].toFixed(1));
    }

    function _createRouteSvg(coords) {
        _clearRouteSvg();
        _routeSvgCoords = coords;

        const svg = _svgEl('svg', {});
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

        // Base: solid, low opacity
        const base = _svgEl('path', { fill: 'none', stroke: '#1558d0', 'stroke-width': '4', 'stroke-opacity': '0.4', class: 'route-base' });

        // Dashed: animated via @keyframes dash-flow in map.css
        const dash = _svgEl('path', { fill: 'none', stroke: '#1558d0', 'stroke-width': '4', 'stroke-dasharray': '12 8', class: 'route-dash' });
        dash.style.animation = 'dash-flow 1.8s linear infinite';

        // Start dot (red) and end dot (green)
        const dotStart = _svgEl('circle', { r: '6', fill: '#e53935', stroke: '#fff', 'stroke-width': '2', class: 'route-dot-start' });
        const dotEnd   = _svgEl('circle', { r: '6', fill: '#2e7d32', stroke: '#fff', 'stroke-width': '2', class: 'route-dot-end' });

        svg.appendChild(base);
        svg.appendChild(dash);
        svg.appendChild(dotStart);
        svg.appendChild(dotEnd);

        // Insert before the marker-collection-container so HtmlMarkers render on top
        const container = _map.getCanvasContainer();
        const markerContainer = container.querySelector('.marker-collection-container');
        if (markerContainer) {
            container.insertBefore(svg, markerContainer);
        } else {
            container.appendChild(svg);
        }
        _routeSvgEl = svg;

        _map.events.add('move', _updateRouteSvg);
        _updateRouteSvg();
    }

    function _clearRouteSvg() {
        if (_routeSvgEl) {
            _map.events.remove('move', _updateRouteSvg);
            _routeSvgEl.remove();
            _routeSvgEl = null;
        }
        _routeSvgCoords = null;
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
                // User location accuracy circle (WebGL polygon layer)
                _locSource = new atlas.source.DataSource();
                _map.sources.add(_locSource);
                _map.layers.add(new atlas.layer.PolygonLayer(_locSource, 'loc-circle', {
                    fillColor:   '#2979ff',
                    fillOpacity: 0.1,
                }));

                _ready = true;
                _queue.forEach(function (fn) { fn(); });
                _queue = [];
            });
        },

        setView: function (lat, lng, zoom, animate) {
            _map.setCamera({
                center:   [lng, lat],
                zoom:     zoom,
                type:     animate ? 'ease' : 'jump',
                duration: animate ? 400 : 0,
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

        // ── Bus markers ──────────────────────────────────────────────────────

        updateBusMarkers: function (vehicles, pinnedVehicleId, userLat, userLng) {
            _whenReady(function () {
                // Remove old markers and popups
                _busMarkers.forEach(function (m) { _map.markers.remove(m); });
                _busPopups.forEach(function (p) { p.close(); });
                _busMarkers = [];
                _busPopups  = [];
                _openPopup  = null;

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

                    // Marker click → toggle popup + notify app (pin/unpin)
                    _map.events.add('click', marker, function () {
                        _suppressMapClick = true;
                        setTimeout(function () { _suppressMapClick = false; }, 0);
                        if (_openPopup === popup) {
                            // Same bus clicked → close popup (unpin)
                            popup.close();
                            _openPopup = null;
                        } else {
                            // Different bus → close old popup, open new one
                            if (_openPopup) { _openPopup.close(); _openPopup = null; }
                            popup.open(_map);
                            _openPopup = popup;
                        }
                        if (_markerClickFn) {
                            _markerClickFn({ vehicleId: v.vehicle_id, lat: v.lat, lon: v.lon, tripId: v.trip_id });
                        }
                    });

                    // Popup open → start age counter
                    _map.events.add('open', popup, function () {
                        if (_markerPopupOpenFn) {
                            setTimeout(function () {
                                const ageEl = document.querySelector('.popup-content-container .age-counter');
                                _markerPopupOpenFn({ vehicleId: v.vehicle_id, startTime: Date.parse(v.timestamp), ageEl: ageEl });
                            }, 50);
                        }
                    });

                    // Popup close → stop age counter, clear open popup ref
                    _map.events.add('close', popup, function () {
                        if (_openPopup === popup) _openPopup = null;
                        if (_markerPopupCloseFn) _markerPopupCloseFn({ vehicleId: v.vehicle_id });
                    });

                    if (isPinned) {
                        popup.open(_map);
                        _openPopup = popup;
                    }

                    _busMarkers.push(marker);
                    _busPopups.push(popup);
                });
            });
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

        // ── Route shape ──────────────────────────────────────────────────────

        drawRoute: function (points) {
            _whenReady(function () {
                if (!points || !points.length) return;
                // [lng, lat] order for positionsToPixels
                const coords = points.map(function (p) { return [p.lon, p.lat]; });
                _createRouteSvg(coords);
            });
        },

        clearRoute: function () {
            _whenReady(function () {
                _clearRouteSvg();
            });
        },

        closeOpenPopup: function () {
            if (_openPopup) { _openPopup.close(); _openPopup = null; }
        },

        // ── User location ────────────────────────────────────────────────────

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

        clearUserLocation: function () {
            _whenReady(function () {
                if (_locMarker) { _map.markers.remove(_locMarker); _locMarker = null; }
                if (_locSource) _locSource.clear();
            });
        },
    };

}());
