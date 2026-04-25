# Trip Planner — Design Spec

**Date:** 2026-04-25
**Branch:** `feature/plan-trips`

## Overview

Add a trip planning mode to the existing map page. Users set a destination (text address or dropped pin) and the system computes optimal transit routes from their current location — showing walking legs, bus rides (with live positions), and transfer points. Supports direct routes and up to 2 transfers.

## Constraints

- Only available when user location is set (geolocation or manual pin)
- Azure Maps API key must never reach the frontend — all geocoding/routing calls go through the existing `/api/azure-maps` proxy
- Must work on mobile (iPhone 17 / 393×852 viewport minimum)
- Uses existing DB tables: `stop`, `stop_time`, `trip`, `route`, `shape`, `shape_point`, `live_vehicle_position`

## UX Flow

### Entering Trip Mode

1. A new **trip button** appears in the top-left map controls (alongside drop-pin, my-location, stop-tracking) — **only visible** when `userLat`/`userLng` is set.
2. Clicking it:
   - Sets `tripMode = true`
   - Hides the top-right controls panel (agency/route selects, poll timer, details toggle)
   - Slides up a **bottom sheet** with origin and destination inputs
3. Clicking it again (or a close/X in the bottom sheet) exits trip mode and restores normal controls.
4. The **currently selected agency** from the dropdown is remembered and used for trip planning queries. If no agency is selected, trip mode is unavailable.

### Bottom Sheet — 3 States

**State 1: Entry**
- Origin row: auto-filled "My Location" (read-only, styled as a pill)
- Destination row: text input with placeholder "Where to?" + a pin-drop button (📌)
- Pin-drop button: places a draggable red marker at map center for destination B (reuses the existing `dropped-pin` CSS class, but in a different color — green or a flag marker)
- Text input: on submit (Enter key or search icon), geocodes the address via Azure Maps and places a destination marker

**State 2: Searching**
- Origin and destination shown (destination editable via ✕ button)
- Spinner: "Finding best routes..."
- Backend computes trip options

**State 3: Results**
- Origin→destination collapsed into a summary line with "Edit" link
- 2-3 trip options as collapsible cards:
  - Summary line: total time + label ("Best", "Less walking", "More walking", "Fewest transfers")
  - Leg icons: 🚶 walk time → [Route badge] → 🚶 walk time (with colored route badges for each bus)
  - Tapping a card: expands step-by-step details + draws it on the map
  - Selected card has a blue border highlight
- **"Show all buses on route" toggle** (off by default):
  - Off: only show the specific bus(es) the user will board, pinned with popup
  - On: show all live buses on the concerned route(s), with the user's bus pinned
- Each route leg drawn as a colored polyline on the map (different color per route). Walking legs drawn as green dashed lines (reusing existing walk SVG overlay pattern).

### Destination Input Details

**Text/address input:**
- On Enter/submit, calls Azure Maps Geocoding API: `GET /api/azure-maps/geocoding?api-version=2023-06-01&query={address}&top=5`
- Shows a dropdown of up to 5 results (address + type)
- User taps a result → places destination marker, triggers trip computation
- Dropdown disappears on selection or blur

**Pin drop for destination:**
- Separate from the existing "drop pin" (which sets user location)
- Places a distinguishable marker at map center (green pin or 🏁 flag)
- Draggable — on drag end, recomputes trips
- Can coexist with the user's location pin/dot

### Mobile Considerations

- Bottom sheet max height: 65% of viewport, scrollable overflow
- All touch targets: minimum 44×44 CSS px
- Bottom padding: `env(safe-area-inset-bottom)` for iPhone home indicator
- When destination text input is focused: bottom sheet pushes above the software keyboard
- Trip option cards: full-width tap targets, route badges use `flex-wrap` for multi-transfer lines

## Backend — Trip Computation

### New API Endpoint

`GET /api/trip-plan/:agency_id?originLat=X&originLng=Y&destLat=X&destLng=Y`

**Auth:** None (same as other public map endpoints).

**Response:**
```json
{
  "options": [
    {
      "totalTime": 1380,
      "totalWalkTime": 600,
      "totalRideTime": 780,
      "label": "Best",
      "legs": [
        {
          "type": "walk",
          "from": { "lat": 44.648, "lng": -63.575, "name": "Your location" },
          "to": { "lat": 44.645, "lng": -63.572, "name": "Spring Garden @ Queen" },
          "distanceMeters": 350,
          "durationSeconds": 240
        },
        {
          "type": "bus",
          "routeId": "1",
          "routeName": "Spring Garden",
          "routeColor": "#1558d0",
          "boardStop": { "id": "1234", "name": "Spring Garden @ Queen", "lat": 44.645, "lng": -63.572 },
          "alightStop": { "id": "5678", "name": "Robie @ Cunard", "lat": 44.652, "lng": -63.588 },
          "boardTime": "14:14",
          "alightTime": "14:23",
          "numStops": 5,
          "tripId": "trip-abc",
          "shapeId": "shape-xyz",
          "vehicleId": "bus-42"
        },
        {
          "type": "walk",
          "from": { "lat": 44.652, "lng": -63.588, "name": "Robie @ Cunard" },
          "to": { "lat": 44.655, "lng": -63.592, "name": "Destination" },
          "distanceMeters": 480,
          "durationSeconds": 360
        }
      ]
    }
  ]
}
```

### Algorithm — Route Search

The trip planner runs server-side. Given origin (A) and destination (B):

**Step 1: Find candidate stops**
- Query all stops for the agency
- Filter to stops within a walk radius of A (800m straight-line) → `stopsNearA`
- Filter to stops within a walk radius of B (800m straight-line) → `stopsNearB`
- If either set is empty, expand radius to 1500m and retry once

**Step 2: Build route-stop index**
- For each stop in `stopsNearA ∪ stopsNearB`, query `stop_time` joined with `trip` to get all `(route_id, trip_id, stop_id, arrival_time, stop_sequence)` tuples
- Group by route_id → know which routes serve which stops near A and near B

**Step 3: Find direct routes (0 transfers)**
- Routes that appear in both `stopsNearA` and `stopsNearB`
- For each direct route: find the best boarding stop (near A) and alighting stop (near B) where boarding `stop_sequence < alighting stop_sequence` and `departure_time` at boarding is the soonest from "now"
- Score: walk(A→board) + wait + ride + walk(alight→B)

**Step 4: Find 1-transfer routes**
- For each route R1 serving a stop near A and each route R2 serving a stop near B (where R1 ≠ R2):
  - Find transfer stops: stops served by both R1 and R2 (query `stop_time` for shared `stop_id` across trips of R1 and R2)
  - For each transfer stop T: compute R1(boardA → T) + walk/wait at T + R2(T → alightB)
  - Score and keep the best

**Step 5: Find 2-transfer routes**
- For each route R1 serving a stop near A:
  - For each stop T1 on R1 beyond the boarding point:
    - Find routes R2 that also serve T1
    - For each R2, for each stop T2 on R2 beyond T1:
      - Find routes R3 serving T2 and also serving a stop near B
      - Score the full chain: walk + R1 + transfer + R2 + transfer + R3 + walk
- Prune aggressively: skip if cumulative time already exceeds best-known option. Cap R2 candidates to routes serving stops within 2km of B (heuristic to limit search space).

**Step 6: Rank and return**
- Score all candidates by total time (walk time estimated at 5 km/h, wait time = time until next scheduled departure from `stop_time`)
- Return top 3 options, labeled:
  - "Best" — lowest total time
  - Label 2nd/3rd by their differentiator: "Less walking", "More walking", "Fewer transfers", "Direct route"

**Step 7: Attach live vehicle info**
- For each bus leg, query `live_vehicle_position` for buses on that `route_id` + `trip_id`
- If a live bus is found on the trip, include its `vehicle_id` so the frontend can pin it

### Walking Time Estimation

- For the trip computation itself: use straight-line Haversine × 1.4 (Manhattan distance factor) at 5 km/h. This is fast enough for scoring.
- For the selected trip display on the frontend: call Azure Maps Route Directions API (pedestrian mode) through the proxy for the actual walking legs — gives accurate path and real walking time/distance. This happens only for the selected option, not all candidates.

### Schedule Awareness

- `stop_time.stop_sequence` is `VARCHAR(10)` in the DB — must be cast to integer (`::int`) for ordering and comparison in queries
- `stop_time.arrival_time` uses GTFS format (HH:MM:SS, can exceed 24:00 for post-midnight service)
- "Now" for the purpose of finding the next departure: server's current UTC time converted to the agency's timezone (`agency.timezone`)
- If no upcoming departure exists today for a candidate route, skip it (don't wrap to tomorrow)

## Frontend Changes

### map.html

- New top-left button `#trip-btn` with 🗺️ icon, `aria-label="Plan trip"`, initially hidden
- Show `#trip-btn` whenever `userLat !== null` (set by geolocation or pin drop)
- Hide `#trip-btn` when `userLat === null`
- Trip mode toggle logic: `tripMode` boolean state variable
  - Enter: hide `#controls`, show `#trip-sheet`, set `tripMode = true`
  - Exit: hide `#trip-sheet`, show `#controls`, clear trip state, set `tripMode = false`
- Destination geocoding: `fetch('/api/azure-maps/geocoding?...')` with `X-Azure-Maps-Proxy: 1` header
- Trip computation: `fetch('/api/trip-plan/${agencyId}?originLat=...&originLng=...&destLat=...&destLng=...')`
- On trip option select: call `mapAdapter.drawTripPlan(option)` to render on map

### map-adapter-azure.js — New Methods

- `drawTripPlan(option)` — draws all legs on the map:
  - Walking legs: green dashed SVG polylines (reuse `_createWalkSvg` pattern, but support multiple walk segments)
  - Bus legs: colored SVG polylines per route (fetch shape via existing `/api/shape/:agency/:trip` endpoint, use `route.color` or assign from a palette)
  - Markers: origin (blue dot), destination (green/flag pin), transfer stops (orange dots), boarding/alighting stops (highlighted)
- `clearTripPlan()` — removes all trip plan overlays
- `setDestinationPin(lat, lng, onDragEnd)` — places a draggable destination marker (distinct from location pin)
- `clearDestinationPin()` — removes destination marker
- `showTripBuses(vehicles, pinnedVehicleIds)` — shows only specific buses (or all on route with toggle)

### map.css — New Styles

- `#trip-sheet` — bottom sheet with `border-radius: 14px 14px 0 0`, `box-shadow`, `max-height: 65vh`, `overflow-y: auto`, `padding-bottom: env(safe-area-inset-bottom, 16px)`
- `.trip-option` — card styles (border, border-radius, padding, tap highlight)
- `.trip-option.selected` — blue border, light blue background
- `.trip-leg-badge` — route badges (colored background, white text, rounded)
- `.dest-pin` — destination marker style (green teardrop, distinct from red location pin)
- `.geocode-dropdown` — absolute-positioned dropdown below destination input

### web/index.js — New Endpoint

- `GET /api/trip-plan/:agency_id` — query params: `originLat`, `originLng`, `destLat`, `destLng`
- Trip computation logic (algorithm described above) extracted into `web/service/tripPlanner.js`
- DB queries extracted into `web/repository/tripPlanner.js`

## File Changes Summary

| Area | Files | Changes |
|------|-------|---------|
| Backend | `web/index.js` | Add `/api/trip-plan/:agency_id` route |
| Backend | `web/service/tripPlanner.js` (new) | Trip planning algorithm |
| Backend | `web/repository/tripPlanner.js` (new) | DB queries for stops, stop_times, trips, routes |
| Frontend | `web/public/map.html` | Trip mode toggle, bottom sheet, geocoding, trip display logic |
| Frontend | `web/public/assets/map-adapter-azure.js` | `drawTripPlan`, `clearTripPlan`, `setDestinationPin`, `showTripBuses` |
| Frontend | `web/public/assets/map.css` | Bottom sheet, trip option cards, destination pin, geocode dropdown |

## Out of Scope

- Multi-agency trip planning (cross-agency transfers) — future enhancement
- Calendar/date picker for future trips — uses current time only
- Fare calculation
- Accessibility routing (wheelchair-only stops)
- Offline/PWA support
