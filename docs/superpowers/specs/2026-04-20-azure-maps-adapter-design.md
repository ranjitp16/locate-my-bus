# Azure Maps Migration via Adapter Pattern

**Date:** 2026-04-20
**Branch:** `feature/update-map-use-Azure-maps`

## Goal

Migrate the live bus map from Leaflet to Azure Maps SDK v3, while introducing a thin adapter layer so future provider swaps (e.g. Mapbox) require only a new adapter file and a single `<script>` tag change — no app logic changes.

## Approach

The adapter is not a generic map abstraction. It covers exactly the methods `map.html` currently uses — nothing more. `window.mapAdapter` is the only surface `map.html` touches; the SDK never leaks into app logic.

## File Changes

### New: `web/public/assets/map-adapter-azure.js`

Implements the adapter contract (see below) using Azure Maps SDK v3. Exposes `window.mapAdapter`. Subscription key hardcoded for now.

### Modified: `web/public/map.html`

- Remove Leaflet `<link>` and `<script>` tags
- Add Azure Maps SDK v3 CSS + JS tags from `atlas.microsoft.com`
- Add `<script src="/assets/map-adapter-azure.js">`
- Replace all direct Leaflet calls with `mapAdapter.*` calls
- All app logic unchanged: polling, pin/unpin, localStorage, geolocation, theme toggle, BMC banner

### Deleted: `web/public/assets/index.html`

Throwaway prototype, superseded by the real implementation.

### Modified: `web/index.js`

Remove the `GET /map` route that served the prototype.

## Adapter Contract

All 14 methods that `map.html` needs. Any future adapter (Leaflet, Mapbox, etc.) must implement this same interface.

### Map lifecycle

```js
mapAdapter.init(containerId, { center: { lat, lng }, zoom, authKey })
mapAdapter.setView(lat, lng, zoom, animate = false)
mapAdapter.getCenter()          // → { lat, lng }
mapAdapter.getZoom()            // → number
mapAdapter.onMoveEnd(fn)        // fn({ lat, lng, zoom }) — for localStorage persistence
mapAdapter.onClick(fn)          // fn() — map background click, used to unpin vehicle
```

### Bus markers

```js
// Clears previous markers, draws new ones, opens popup on pinned vehicle.
// userLat/userLng optional — used for distance display in popup.
mapAdapter.updateBusMarkers(vehicles, pinnedVehicleId, userLat, userLng)

mapAdapter.onMarkerClick(fn)        // fn({ vehicleId, lat, lon, tripId })
mapAdapter.onMarkerPopupOpen(fn)    // fn({ vehicleId, startTime, ageEl }) — start age counter
mapAdapter.onMarkerPopupClose(fn)   // fn({ vehicleId }) — clear age counter
```

### Route shape

```js
// points is [{ lat, lon, pt_sequence }], already sorted.
// Renders: solid base polyline + animated dashed overlay + start dot (red) + end dot (green).
mapAdapter.drawRoute(points)
mapAdapter.clearRoute()
```

### User location

```js
// Creates dot + accuracy circle on first call; updates position on subsequent calls.
mapAdapter.setUserLocation(lat, lng, accuracy)
mapAdapter.clearUserLocation()
```

## Azure Maps Implementation Notes

| Feature | Leaflet API | Azure Maps API |
|---|---|---|
| Bus markers | `L.marker` + `L.divIcon` | `atlas.HtmlMarker` with inline HTML |
| Popups | `L.popup` | `atlas.Popup` |
| Route polyline | `L.polyline` | `atlas.layer.LineLayer` on `DataSource` |
| Start/end dots | `L.circleMarker` | `atlas.layer.BubbleLayer` on `DataSource` |
| User location dot | `L.marker` + `L.divIcon` | `atlas.HtmlMarker` |
| Accuracy circle | `L.circle` | `atlas.layer.PolygonLayer` (circle geometry) |
| Map events | `map.on('moveend', ...)` | `map.events.add('moveend', ...)` |

Bus marker icon: same 🚌 emoji + CSS `transform: rotate(${deg}deg)` as today. `deg = bearing + 90` (emoji faces west).

Animated dashed route: two `LineLayer` passes on the same `DataSource` — one solid low-opacity base, one dashed with CSS `stroke-dashoffset` animation on the SVG element (same visual as current Leaflet implementation).

## Out of Scope

- Env var wiring for the subscription key (deferred)
- Leaflet removal from `node_modules`
- Changes to any other page, Express route, or DB query
- Build system, bundler, or TypeScript
