import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../theme/ThemeProvider';
import { BusIconG, BusMark } from '../components/BusGlyph';
import { FAB, LiveDot, Tag } from '../components/atoms';
import {
  IconArrowLeft, IconChevron, IconExternal, IconGear, IconLayers, IconLocation, IconPin,
  IconRefresh, IconRoute, IconSearch, IconClose, IconWalk, IconClock,
} from '../components/Icons';
import type { Agency, Route, Vehicle } from '../lib/azureMaps';
import type { LatLng, MapAdapter, StopPoint } from '../lib/maps/adapter';
import { AzureMapAdapter } from '../lib/maps/azureAdapter';
import { BmcModal } from '../components/BmcModal';
import { ComingSoonModal } from '../components/ComingSoonModal';

const POLL_INTERVAL_MS = 15_000;
// Don't draw the user→nearest-stop walking overlay when the stop is
// farther than this — the path becomes useless and burns an Azure
// Maps routing call for no gain.
const MAX_WALK_ROUTE_METERS = 5000;

// Buy Me a Coffee prompt — shown on the 2nd map-page mount onwards,
// and at most once per 24 h after a dismissal or Support click.
const BMC_VISIT_COUNT_KEY = 'lmb-map-visits';
const BMC_DISMISSED_AT_KEY = 'lmb-bmc-dismissed-at';
const BMC_MIN_VISITS = 2;
const BMC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BMC_URL = 'https://buymeacoffee.com/ranjitp16';

// Haversine great-circle distance between two lat/lng pairs, in metres.
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Polyline pre-baked for projection math. `xy` is an equirectangular
// projection of each `points[i]` into local metres around a single
// origin so segment-distance comparisons in `projectOntoPolyline` can
// happen in cheap planar squared-distance (no per-segment trig).
type Polyline = {
  points: LatLng[];
  cum: number[];
  xy: { x: number; y: number }[];
  origin: LatLng;
  cosOriginLat: number;
};

const M_PER_DEG = 111_320;

function buildPolyline(points: LatLng[]): Polyline {
  const origin = points[0];
  const cosOriginLat = Math.cos((origin.lat * Math.PI) / 180);
  const xy = points.map((p) => ({
    x: (p.lng - origin.lng) * M_PER_DEG * cosOriginLat,
    y: (p.lat - origin.lat) * M_PER_DEG,
  }));
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(points[i - 1], points[i]);
  }
  return { points, cum, xy, origin, cosOriginLat };
}

function projectOntoPolyline(q: LatLng, poly: Polyline): number {
  const qx = (q.lng - poly.origin.lng) * M_PER_DEG * poly.cosOriginLat;
  const qy = (q.lat - poly.origin.lat) * M_PER_DEG;
  const { xy, cum } = poly;
  let bestD2 = Infinity;
  let bestAlong = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const ax = xy[i];
    const bx = xy[i + 1];
    const dx = bx.x - ax.x;
    const dy = bx.y - ax.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((qx - ax.x) * dx + (qy - ax.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = qx - (ax.x + dx * t);
    const ey = qy - (ax.y + dy * t);
    const d2 = ex * ex + ey * ey;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAlong = cum[i] + (cum[i + 1] - cum[i]) * t;
    }
  }
  return bestAlong;
}

function pointAtAlong(along: number, poly: Polyline): LatLng {
  const { points, cum } = poly;
  const last = points.length - 1;
  if (along <= 0) return points[0];
  if (along >= cum[last]) return points[last];
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (along - cum[lo]) / segLen : 0;
  return {
    lat: points[lo].lat + (points[lo + 1].lat - points[lo].lat) * t,
    lng: points[lo].lng + (points[lo + 1].lng - points[lo].lng) * t,
  };
}

// Short, scale-appropriate distance label: "240 m" under 1 km, "1.2 km" above.
function formatDistance(meters: number): { value: string; unit: string } {
  if (meters < 1000) return { value: String(Math.round(meters)), unit: 'm' };
  return { value: (meters / 1000).toFixed(1), unit: 'km' };
}

const MAP_STYLE_KEY = 'lmb-map-style';
const AGENCY_KEY = 'lmb-agency-id';
const ROUTE_KEY = 'lmb-route-id';
const SHOW_ALL_ROUTES_KEY = 'lmb-show-all-routes';
const MAP_STYLES: { value: string; label: string }[] = [
  { value: 'road', label: 'Road' },
  { value: 'grayscale_dark', label: 'Grayscale' },
  { value: 'night', label: 'Night' },
  { value: 'satellite', label: 'Satellite' },
];

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [mapStyle, setMapStyleState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'road';
    const stored = window.localStorage.getItem(MAP_STYLE_KEY);
    if (stored) return stored;
    // No stored choice yet: pair with the app theme — Road for light,
    // Night for dark. Once the user picks a style in settings the
    // localStorage value sticks regardless of theme.
    return theme === 'dark' ? 'night' : 'road';
  });
  const setMapStyle = useCallback((next: string) => {
    setMapStyleState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(MAP_STYLE_KEY, next);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [showAllRoutes, setShowAllRoutesState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SHOW_ALL_ROUTES_KEY) === '1';
  });
  const setShowAllRoutes = useCallback((next: boolean) => {
    setShowAllRoutesState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SHOW_ALL_ROUTES_KEY, next ? '1' : '0');
    }
  }, []);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<MapAdapter | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [buses, setBuses] = useState<Vehicle[]>([]);
  const [pinnedVid, setPinnedVidRaw] = useState<string | null>(null);
  const [pollPaused, setPollPaused] = useState(false);
  // Trip-plan mode is gated behind a "coming soon" modal for the upcoming
  // launch — the bottom sheet stays in 'live' for now. `?mode=plan` in the
  // URL (from old Landing links / bookmarks) triggers the modal instead,
  // and is stripped from the URL so a refresh doesn't re-trigger it.
  const [sheetMode, setSheetMode] = useState<'live' | 'plan'>('live');
  const [planComingSoon, setPlanComingSoon] = useState(false);
  useEffect(() => {
    if (searchParams.get('mode') !== 'plan') return;
    setPlanComingSoon(true);
    const next = new URLSearchParams(searchParams);
    next.delete('mode');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // Returning visitors (with a persisted agency choice) land with the
  // bottom sheet collapsed — they've already done the agency setup.
  const [sheetCollapsed, setSheetCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AGENCY_KEY) != null;
  });
  const [lastPollAt, setLastPollAt] = useState<number>(() => Date.now());
  const [bmcOpen, setBmcOpen] = useState(false);
  // User location is best-effort — used for the popup distance stat and
  // for picking the nearest stop to walk to. Null when denied/unavailable.
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  }, []);

  // ── BMC prompt: count visits, gate on cooldown ─────────────
  useEffect(() => {
    const visits = (Number(localStorage.getItem(BMC_VISIT_COUNT_KEY)) || 0) + 1;
    localStorage.setItem(BMC_VISIT_COUNT_KEY, String(visits));
    if (visits < BMC_MIN_VISITS) return;
    const dismissedAt = Number(localStorage.getItem(BMC_DISMISSED_AT_KEY)) || 0;
    if (Date.now() - dismissedAt < BMC_COOLDOWN_MS) return;
    setBmcOpen(true);
  }, []);

  const closeBmc = useCallback(() => {
    setBmcOpen(false);
    localStorage.setItem(BMC_DISMISSED_AT_KEY, String(Date.now()));
  }, []);

  // Stops loaded for the pinned trip. Mirror of what the adapter holds,
  // kept in state so we can compute the nearest stop to the pinned bus
  // without round-tripping through the adapter.
  const [loadedStops, setLoadedStops] = useState<StopPoint[]>([]);

  const setPinnedVid = useCallback((vid: string | null) => setPinnedVidRaw(vid), []);

  // Tracks which route id we've already auto-pinned for. Reset on route
  // change so each new route gets one fresh auto-pin opportunity; never
  // reset on manual unpin so the user's intent sticks.
  const autoPinnedRouteRef = useRef<string | null>(null);

  // ── Initialize the map adapter once ───────────────────────
  // Swap providers by replacing AzureMapAdapter with another impl
  // of MapAdapter — no other change in this file should be needed.
  useEffect(() => {
    let cancelled = false;
    const adapter = new AzureMapAdapter();
    (async () => {
      if (!mapContainerRef.current) return;
      await adapter.init(mapContainerRef.current, {
        center: { lat: 44.6488, lng: -63.5752 }, // Halifax
        zoom: 12,
        style: mapStyle,
      });
      if (cancelled) {
        adapter.dispose();
        return;
      }
      adapterRef.current = adapter;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      adapterRef.current?.dispose();
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update map style when user picks a different one ─────
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !mapReady) return;
    adapter.setStyle(mapStyle);
  }, [mapStyle, mapReady]);

  // ── Load agencies once ─────────────────────────────────────
  useEffect(() => {
    fetch('/api/agencies')
      .then(async (r) => {
        if (!r.ok) throw new Error(`/api/agencies → HTTP ${r.status}`);
        return (await r.json()) as Agency[];
      })
      .then((list) => setAgencies(list))
      .catch((e) => console.error('agencies load failed', e));
  }, []);

  // ── Default selected agency on first load ─────────────────
  // Returning visitor: restore the agency from localStorage if it's
  // still in the agencies list. Otherwise pick the first.
  useEffect(() => {
    if (selectedAgency || !agencies.length) return;
    const storedId = typeof window !== 'undefined' ? window.localStorage.getItem(AGENCY_KEY) : null;
    const stored = storedId ? agencies.find((a) => a.id === storedId) : null;
    setSelectedAgency(stored ?? agencies[0]);
  }, [agencies, selectedAgency]);

  // ── Persist the selected agency ────────────────────────────
  useEffect(() => {
    if (selectedAgency && typeof window !== 'undefined') {
      window.localStorage.setItem(AGENCY_KEY, selectedAgency.id);
    }
  }, [selectedAgency]);

  // ── Load routes when agency or filter changes ─────────────
  // The trailing `1` segment restricts the response to routes that
  // currently have buses running; `0` returns every route the agency
  // publishes. The toggle lives in the settings popover.
  useEffect(() => {
    if (!selectedAgency) return;
    const filter = showAllRoutes ? 0 : 1;
    fetch(`/routes/${selectedAgency.id}/${filter}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`/routes → HTTP ${r.status}`);
        return (await r.json()) as Route[];
      })
      .then((list) => {
        setRoutes(list);
        setSelectedRoute((current) => {
          // Keep the current selection if it's still in the new list.
          if (current && list.some((r) => r.id === current.id)) return current;
          // Otherwise restore from localStorage if matching, else first.
          const storedId =
            typeof window !== 'undefined' ? window.localStorage.getItem(ROUTE_KEY) : null;
          const restored = storedId ? list.find((r) => r.id === storedId) ?? null : null;
          return restored ?? list[0] ?? null;
        });
      })
      .catch((e) => console.error('routes load failed', e));
  }, [selectedAgency, showAllRoutes]);

  // ── Persist the selected route ─────────────────────────────
  useEffect(() => {
    if (selectedRoute && typeof window !== 'undefined') {
      window.localStorage.setItem(ROUTE_KEY, selectedRoute.id);
    }
  }, [selectedRoute]);

  // ── Poll live vehicles every 15s ───────────────────────────
  useEffect(() => {
    if (!selectedAgency || !selectedRoute || pollPaused) return;
    const ctrl = new AbortController();

    const poll = async () => {
      try {
        const r = await fetch(`/live/${selectedAgency.id}/${selectedRoute.id}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`/live → HTTP ${r.status}`);
        const data = (await r.json()) as Vehicle[];
        setBuses(data);
        setLastPollAt(Date.now());
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error('live poll failed', e);
      }
    };

    poll();
    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      ctrl.abort();
      clearInterval(intervalId);
    };
  }, [selectedAgency, selectedRoute, pollPaused]);

  // ── Auto-pin the nearest bus once per route selection ─────
  // Fires when buses arrive for a freshly-selected route. If the user's
  // location is known, pin the bus with the smallest haversine distance.
  // Otherwise wait up to 1.5s for geolocation; if it doesn't resolve in
  // time, pin the last bus in the live array as a sensible fallback.
  // Guarded by `autoPinnedRouteRef` so manual unpins are never undone
  // and so we don't re-fire on every poll. Reset on route change.
  useEffect(() => {
    if (!selectedRoute) return;
    if (pinnedVid != null) return;
    if (!buses.length) return;
    if (autoPinnedRouteRef.current === selectedRoute.id) return;

    if (userLocation) {
      let bestId = buses[0].vehicle_id;
      let bestD = haversineMeters(userLocation, {
        lat: Number(buses[0].lat),
        lng: Number(buses[0].lon),
      });
      for (let i = 1; i < buses.length; i++) {
        const d = haversineMeters(userLocation, {
          lat: Number(buses[i].lat),
          lng: Number(buses[i].lon),
        });
        if (d < bestD) {
          bestD = d;
          bestId = buses[i].vehicle_id;
        }
      }
      autoPinnedRouteRef.current = selectedRoute.id;
      setPinnedVid(bestId);
      return;
    }

    // No location yet — give geolocation 1.5s to resolve before falling
    // back. If userLocation arrives during that window, the effect
    // re-runs (deps change), this timer is cleared, and the branch above
    // fires instead. If the user changes route or manually pins in the
    // meantime, cleanup also cancels the timer.
    const timerId = window.setTimeout(() => {
      if (autoPinnedRouteRef.current === selectedRoute.id) return;
      autoPinnedRouteRef.current = selectedRoute.id;
      setPinnedVid(buses[buses.length - 1].vehicle_id);
    }, 1500);
    return () => window.clearTimeout(timerId);
  }, [buses, userLocation, pinnedVid, selectedRoute, setPinnedVid]);

  // ── Sync markers (create/move/re-render/remove) ────────────
  // One effect handles position, heading, pinned state, and lifecycle.
  // Always re-renders innerHTML so bearing changes from the poll are
  // reflected; cost is small relative to the 15s polling cadence.
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !mapReady || !selectedRoute) return;

    const seen = new Set<string>();
    const routeId = selectedRoute.id;

    for (const bus of buses) {
      seen.add(bus.vehicle_id);
      const pinned = bus.vehicle_id === pinnedVid;
      const bearing = bus.head_bearing != null ? Number(bus.head_bearing) : undefined;
      const position = { lat: Number(bus.lat), lng: Number(bus.lon) };
      const html = renderToStaticMarkup(
        <BusMark
          size={42}
          route={routeId}
          pinned={pinned}
          bearing={bearing}
          idSeed={`v${bus.vehicle_id}`}
        />
      );

      if (adapter.hasMarker(bus.vehicle_id)) {
        // Pinned bus position is handled by the smooth-animation effect
        // below — let it own the position so we don't fight on each poll.
        if (pinned) {
          adapter.updateMarker(bus.vehicle_id, { html });
        } else {
          adapter.updateMarker(bus.vehicle_id, { position, html });
        }
      } else {
        adapter.addMarker({
          id: bus.vehicle_id,
          position,
          html,
          onClick: () => setPinnedVid(bus.vehicle_id),
        });
      }
    }

    for (const id of adapter.listMarkerIds()) {
      if (!seen.has(id)) adapter.removeMarker(id);
    }
  }, [buses, pinnedVid, mapReady, selectedRoute, setPinnedVid]);

  // Trip shape used by the pinned-bus animator. Kept in a ref (not
  // state) so the shape arriving mid-poll doesn't itself retrigger the
  // animation effect — the next poll will read it.
  const shapeRef = useRef<{ tripId: string; poly: Polyline } | null>(null);

  // ── Smooth-animate the pinned bus over 2s on each poll ────
  // Only animates when the *same* bus stays pinned and its position
  // changed. When the trip shape is loaded, the animation walks along
  // the polyline so a right-angled turn travels the L-shape (not the
  // hypotenuse); otherwise falls back to linear interp.
  const prevPinnedVidRef = useRef<string | null>(null);
  const prevPinnedPosRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !pinnedVid) {
      prevPinnedVidRef.current = null;
      prevPinnedPosRef.current = null;
      return;
    }
    const bus = buses.find((b) => b.vehicle_id === pinnedVid);
    if (!bus) return;
    const target = { lat: Number(bus.lat), lng: Number(bus.lon) };
    const sameBus = prevPinnedVidRef.current === pinnedVid;
    const start = sameBus ? prevPinnedPosRef.current : null;
    prevPinnedVidRef.current = pinnedVid;
    prevPinnedPosRef.current = target;

    if (!start) {
      // Pin just changed (or first frame) — snap, no animation.
      adapter.updateMarker(pinnedVid, { position: target });
      return;
    }
    if (start.lat === target.lat && start.lng === target.lng) return;

    const shape = shapeRef.current;
    const plan =
      shape && shape.tripId === bus.trip_id && shape.poly.points.length > 1
        ? {
            startAlong: projectOntoPolyline(start, shape.poly),
            targetAlong: projectOntoPolyline(target, shape.poly),
            poly: shape.poly,
          }
        : null;

    const duration = 2000;
    const startTs = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / duration);
      let lat: number;
      let lng: number;
      if (plan) {
        const along = plan.startAlong + (plan.targetAlong - plan.startAlong) * t;
        const on = pointAtAlong(along, plan.poly);
        lat = on.lat;
        lng = on.lng;
      } else {
        lat = start.lat + (target.lat - start.lat) * t;
        lng = start.lng + (target.lng - start.lng) * t;
      }
      adapter.updateMarker(pinnedVid, { position: { lat, lng } });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [buses, pinnedVid]);

  // ── Clean markers + route + stops + walk on route change ──
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    for (const id of adapter.listMarkerIds()) adapter.removeMarker(id);
    adapter.clearRoute();
    adapter.clearStops();
    adapter.clearWalkRoute();
    // Drop the previous route's vehicles too — otherwise the auto-pin
    // effect re-runs after pinnedVid is cleared, sees the stale buses,
    // and pins a bus from the previous route until the new poll lands.
    setBuses([]);
    setLoadedStops([]);
    setPinnedVid(null);
    shapeRef.current = null;
    autoPinnedRouteRef.current = null;
  }, [selectedRoute, setPinnedVid]);

  // ── Draw route polyline + stops for the *pinned* vehicle's trip ──
  // Unpinned (or no pin): nothing extra is drawn. When a vehicle is
  // pinned, we use its current trip_id to fetch the shape and the
  // ordered list of stops on that trip, then draw them through the
  // adapter. Re-fetches when the pinned vehicle's trip_id changes
  // (e.g., it finished one run and started another).
  const drawnTripIdRef = useRef<string | null>(null);
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !mapReady || !selectedAgency) return;

    if (!pinnedVid) {
      if (drawnTripIdRef.current != null) {
        adapter.clearRoute();
        adapter.clearStops();
        adapter.clearWalkRoute();
        setLoadedStops([]);
        drawnTripIdRef.current = null;
        shapeRef.current = null;
      }
      return;
    }

    const pinnedBus = buses.find((b) => b.vehicle_id === pinnedVid);
    const tripId = pinnedBus?.trip_id;
    if (!tripId || drawnTripIdRef.current === tripId) return;

    drawnTripIdRef.current = tripId;
    let cancelled = false;

    fetch(`/api/shape/${selectedAgency.id}/${tripId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`/api/shape → HTTP ${r.status}`);
        return (await r.json()) as { rows?: Array<{ pt_lat: string; pt_lon: string }> };
      })
      .then((data) => {
        if (cancelled || drawnTripIdRef.current !== tripId) return;
        const points = (data.rows ?? []).map((row) => ({
          lat: Number(row.pt_lat),
          lng: Number(row.pt_lon),
        }));
        if (points.length) {
          adapter.drawRoute(points);
          shapeRef.current = { tripId, poly: buildPolyline(points) };
        }
      })
      .catch((e) => console.error('shape load failed', e));

    type StopRow = {
      stop_id: string;
      name: string | null;
      code: string | null;
      lat: string;
      lon: string;
      arrival_time: string | null;
      wheelchair_boarding: string | null;
    };
    fetch(`/api/stops/${selectedAgency.id}/${tripId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`/api/stops → HTTP ${r.status}`);
        return (await r.json()) as StopRow[];
      })
      .then((rows) => {
        if (cancelled || drawnTripIdRef.current !== tripId) return;
        const stops: StopPoint[] = (rows ?? []).map((s) => ({
          id: String(s.stop_id),
          position: { lat: Number(s.lat), lng: Number(s.lon) },
          name: s.name ?? undefined,
          code: s.code ?? undefined,
          arrivalTime: s.arrival_time ?? undefined,
          accessible: s.wheelchair_boarding === '1',
        }));
        adapter.updateStops(stops);
        setLoadedStops(stops);
      })
      .catch((e) => console.error('stops load failed', e));

    return () => {
      cancelled = true;
    };
  }, [pinnedVid, buses, selectedAgency, mapReady]);

  // ── Sync the user-location marker through the adapter ─────
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !mapReady) return;
    adapter.setUserLocation(userLocation);
  }, [userLocation, mapReady]);

  // ── Pick the stop on the pinned trip that's nearest to the user ──
  // Doesn't depend on the bus position (which moves every 15s); only
  // re-runs when the user location moves or the stops list changes.
  const [nearestStopId, setNearestStopId] = useState<string | null>(null);
  useEffect(() => {
    if (!userLocation || !loadedStops.length) {
      setNearestStopId(null);
      return;
    }
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const stop of loadedStops) {
      const d = haversineMeters(userLocation, stop.position);
      if (d < bestD) {
        bestD = d;
        bestId = stop.id;
      }
    }
    setNearestStopId(bestId);
  }, [userLocation, loadedStops]);

  // ── Fetch + draw the walking path from user → nearest stop ──
  // Skips when geolocation is unavailable / denied. Re-runs only when
  // the user location moves materially or the target stop changes — not
  // on every poll. Hits the proxy with the required X-Azure-Maps-Proxy
  // header (otherwise the server 403s the request).
  const lastWalkKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !mapReady) return;
    if (!userLocation || !nearestStopId) {
      adapter.clearWalkRoute();
      lastWalkKeyRef.current = null;
      return;
    }
    const stop = loadedStops.find((s) => s.id === nearestStopId);
    if (!stop) return;

    // Distance gate: skip the fetch + draw when the nearest stop on
    // the pinned trip is too far to walk. Calculated before the API
    // call so out-of-range trips don't burn an Azure Maps route quota.
    // Resetting the dedup key ensures a later in-range move re-fetches.
    const distM = haversineMeters(userLocation, stop.position);
    if (distM > MAX_WALK_ROUTE_METERS) {
      adapter.clearWalkRoute();
      lastWalkKeyRef.current = null;
      return;
    }

    const key = `${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}|${nearestStopId}`;
    if (lastWalkKeyRef.current === key) return;
    lastWalkKeyRef.current = key;

    let cancelled = false;
    const url =
      `/api/maps/walk-route?originLat=${userLocation.lat}` +
      `&originLng=${userLocation.lng}` +
      `&destLat=${stop.position.lat}` +
      `&destLng=${stop.position.lng}`;
    fetch(url, { headers: { 'X-Azure-Maps-Proxy': '1' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`/api/maps/walk-route → HTTP ${r.status}`);
        return (await r.json()) as { points?: { lat: number; lng: number }[] };
      })
      .then((data) => {
        if (cancelled) return;
        const points = data.points ?? [];
        if (points.length) adapter.drawWalkRoute(points);
      })
      .catch((e) => console.error('walk-route fetch failed', e));

    return () => {
      cancelled = true;
    };
  }, [userLocation, nearestStopId, loadedStops, mapReady]);

  // ── Recenter to pinned bus ─────────────────────────────────
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !pinnedVid) return;
    const bus = buses.find((b) => b.vehicle_id === pinnedVid);
    if (!bus) return;
    adapter.setCamera({
      center: { lat: Number(bus.lat), lng: Number(bus.lon) },
      zoom: Math.max(adapter.getZoom(), 14),
      animate: true,
    });
  }, [pinnedVid, buses]);

  const pinnedBus = useMemo(
    () => buses.find((b) => b.vehicle_id === pinnedVid) ?? null,
    [buses, pinnedVid]
  );

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--map-land)' }}>
      <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Top floating bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 12,
          right: 12,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          onClick={() => navigate('/')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <IconArrowLeft size={18} />
        </button>
        <button
          onClick={() => {
            setRoutePickerOpen((o) => !o);
            setSettingsOpen(false);
          }}
          aria-label="Change route"
          aria-expanded={routePickerOpen}
          style={{
            flex: 1,
            background: routePickerOpen ? 'var(--bg-elevated)' : 'var(--surface)',
            border: '1px solid ' + (routePickerOpen ? 'var(--border-hi)' : 'var(--border)'),
            borderRadius: 14,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            color: 'var(--text)',
            textAlign: 'left',
            cursor: 'pointer',
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: 'var(--signal)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: 'var(--signal-ink)' }}>
              {selectedRoute?.id ?? '—'}
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="mono"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--text-muted)',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {selectedAgency?.name ?? 'Loading…'}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text)',
                marginTop: 2,
                lineHeight: 1.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedRoute?.long_name ?? 'Select a route'}
            </div>
          </div>
          <IconChevron
            size={14}
            style={{
              color: 'var(--text-muted)',
              transform: routePickerOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
              flexShrink: 0,
            }}
          />
        </button>
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Settings"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: settingsOpen ? 'var(--bg-elevated)' : 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid ' + (settingsOpen ? 'var(--border-hi)' : 'var(--border)'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <IconGear size={18} />
        </button>
      </div>

      {settingsOpen && (
        <>
          {/* Backdrop captures outside clicks. */}
          <div
            onClick={() => setSettingsOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 35 }}
          />
          <SettingsPopover
            mapStyle={mapStyle}
            onMapStyleChange={setMapStyle}
            theme={theme}
            onThemeChange={setTheme}
            showAllRoutes={showAllRoutes}
            onShowAllRoutesChange={setShowAllRoutes}
            onClose={() => setSettingsOpen(false)}
          />
        </>
      )}

      {routePickerOpen && (
        <>
          <div
            onClick={() => setRoutePickerOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 35 }}
          />
          <RoutePickerPopover
            routes={routes}
            selected={selectedRoute}
            showAllRoutes={showAllRoutes}
            onPick={(r) => {
              setSelectedRoute(r);
              setRoutePickerOpen(false);
            }}
            onClose={() => setRoutePickerOpen(false)}
          />
        </>
      )}

      {/* Right side FAB cluster — hidden until each button has a real
          behavior wired up. Keep the JSX so re-enabling is a one-line
          flip back to `display: 'flex'`. */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          right: 12,
          zIndex: 30,
          display: 'none',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <FAB size={44}>
          <IconLocation size={18} />
        </FAB>
        <FAB size={44}>
          <IconLayers size={18} />
        </FAB>
        <FAB size={44} onClick={() => setPinnedVid(null)}>
          <IconPin size={18} />
        </FAB>
      </div>

      {/* Pinned bus popup overlay */}
      {pinnedBus && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: 12,
            zIndex: 28,
            background: 'var(--bg-elevated)',
            border: '1.5px solid var(--signal)',
            borderRadius: 14,
            padding: '10px 12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
            minWidth: 200,
            maxWidth: 'calc(100vw - 84px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div
              style={{
                width: 28,
                height: 20,
                borderRadius: 10,
                background: 'var(--signal)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--signal-ink)' }}>
                {selectedRoute?.id}
              </span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
                Vehicle {pinnedBus.vehicle_id}
              </div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                <span style={{ color: 'var(--live)' }}>●</span> Updated{' '}
                <PollTicker from={lastPollAt} paused={pollPaused} mode="since" /> ago
              </div>
            </div>
            <button
              onClick={() => setPinnedVid(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                padding: 4,
                display: 'flex',
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              padding: '8px 0 0',
              borderTop: '1px solid var(--border)',
            }}
          >
            <PopupStat
              value={String(Math.round((pinnedBus.speed ?? 0) * 3.6))}
              unit="km/h"
              label="Speed"
            />
            <PopupStat
              value={pinnedBus.head_bearing != null ? String(Math.round(pinnedBus.head_bearing)) : '—'}
              unit={pinnedBus.head_bearing != null ? '°' : ''}
              label="Bearing"
            />
            {(() => {
              const d =
                userLocation != null
                  ? haversineMeters(userLocation, { lat: Number(pinnedBus.lat), lng: Number(pinnedBus.lon) })
                  : null;
              const disp = d != null ? formatDistance(d) : { value: '—', unit: '' };
              return <PopupStat value={disp.value} unit={disp.unit} label="Distance" />;
            })()}
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        mode={sheetMode}
        onModeChange={(m) => {
          // Plan mode is gated — opening it triggers the coming-soon modal
          // and leaves the sheet on 'live'.
          if (m === 'plan') {
            setPlanComingSoon(true);
            return;
          }
          setSheetMode(m);
          setSheetCollapsed(false);
        }}
        collapsed={sheetCollapsed}
        onToggleCollapse={() => setSheetCollapsed((c) => !c)}
        agency={selectedAgency}
        route={selectedRoute}
        agencies={agencies}
        routes={routes}
        buses={buses}
        onSelectAgency={setSelectedAgency}
        onSelectRoute={setSelectedRoute}
        pollPaused={pollPaused}
        onTogglePause={() => setPollPaused((p) => !p)}
        lastPollAt={lastPollAt}
      />

      <BmcModal open={bmcOpen} onClose={closeBmc} bmcUrl={BMC_URL} />
      <ComingSoonModal
        open={planComingSoon}
        onClose={() => setPlanComingSoon(false)}
        title="Trip planner — coming soon"
        message="The trip planner is still in the works. Hang tight — it'll be live soon. In the meantime, you can explore live buses on the map."
      />
    </div>
  );
}

// Re-renders once a second to update its own text node, without forcing the
// whole MapPage tree to re-render every tick.
// Popover triggered by the top-bar gear. Three independent controls:
// Azure Maps style, app theme, and a toggle that flips the route list
// between "running only" and "all routes". All three persist in
// localStorage so the user's choices survive a reload.
function SettingsPopover({
  mapStyle,
  onMapStyleChange,
  theme,
  onThemeChange,
  showAllRoutes,
  onShowAllRoutesChange,
  onClose,
}: {
  mapStyle: string;
  onMapStyleChange: (s: string) => void;
  theme: 'dark' | 'light';
  onThemeChange: (t: 'dark' | 'light') => void;
  showAllRoutes: boolean;
  onShowAllRoutesChange: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        right: 12,
        zIndex: 50,
        width: 260,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-hi)',
        borderRadius: 14,
        padding: 14,
        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          }}
        >
          Settings
        </span>
        <button
          onClick={onClose}
          aria-label="Close settings"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            padding: 4,
            display: 'flex',
            cursor: 'pointer',
          }}
        >
          <IconClose size={14} />
        </button>
      </div>

      <SettingsSection label="Map style">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {MAP_STYLES.map((s) => (
            <SettingsOption
              key={s.value}
              label={s.label}
              active={mapStyle === s.value}
              onClick={() => onMapStyleChange(s.value)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection label="App theme">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <SettingsOption label="Dark" active={theme === 'dark'} onClick={() => onThemeChange('dark')} />
          <SettingsOption label="Light" active={theme === 'light'} onClick={() => onThemeChange('light')} />
        </div>
      </SettingsSection>

      <SettingsSection label="Routes">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <SettingsOption label="Running" active={!showAllRoutes} onClick={() => onShowAllRoutesChange(false)} />
          <SettingsOption label="All" active={showAllRoutes} onClick={() => onShowAllRoutesChange(true)} />
        </div>
      </SettingsSection>
    </div>
  );
}

// Drop-down picker that replaces what used to be a row in the bottom
// sheet. Renders the same list of routes the parent has fetched, with
// the active route highlighted and tickmarked.
function RoutePickerPopover({
  routes,
  selected,
  showAllRoutes,
  onPick,
  onClose,
}: {
  routes: Route[];
  selected: Route | null;
  showAllRoutes: boolean;
  onPick: (r: Route) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        left: 60, // clear of the back button
        right: 60, // clear of the gear button
        zIndex: 50,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-hi)',
        borderRadius: 14,
        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
        maxHeight: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Choose route
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {routes.length} {showAllRoutes ? 'available' : 'running'}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close route picker"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            padding: 4,
            display: 'flex',
            cursor: 'pointer',
          }}
        >
          <IconClose size={14} />
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {routes.length === 0 && (
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-muted)', padding: '16px 14px', textAlign: 'center' }}
          >
            No routes available.
          </div>
        )}
        {routes.map((r) => {
          const isActive = selected?.id === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: isActive ? 'color-mix(in oklab, var(--signal) 12%, var(--bg-elevated))' : 'transparent',
                border: 'none',
                color: 'var(--text)',
                textAlign: 'left',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <span
                className="mono"
                style={{
                  display: 'inline-flex',
                  minWidth: 32,
                  padding: '3px 6px',
                  borderRadius: 6,
                  background: isActive ? 'var(--signal)' : 'var(--surface)',
                  color: isActive ? 'var(--signal-ink)' : 'var(--text)',
                  fontSize: 11,
                  fontWeight: 800,
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {r.id}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.long_name}
              </span>
              {isActive && <IconChevron size={14} style={{ color: 'var(--signal)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SettingsOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        background: active ? 'var(--signal)' : 'var(--surface)',
        color: active ? 'var(--signal-ink)' : 'var(--text-soft)',
        border: '1px solid ' + (active ? 'var(--signal)' : 'var(--border)'),
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function PollTicker({ from, paused, mode }: { from: number; paused: boolean; mode: 'since' | 'next' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);
  const sec = Math.max(0, Math.floor((now - from) / 1000));
  if (mode === 'since') return <>{sec}s</>;
  const next = Math.max(0, Math.round(POLL_INTERVAL_MS / 1000) - sec);
  return <>{next}s</>;
}

function PopupStat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>{unit}</span>
      </div>
      <div
        className="mono"
        style={{
          fontSize: 8,
          fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Bottom sheet ───────────────────────────────────────────
type SheetProps = {
  mode: 'live' | 'plan';
  onModeChange: (m: 'live' | 'plan') => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  agency: Agency | null;
  route: Route | null;
  agencies: Agency[];
  routes: Route[];
  buses: Vehicle[];
  onSelectAgency: (a: Agency) => void;
  onSelectRoute: (r: Route) => void;
  pollPaused: boolean;
  onTogglePause: () => void;
  lastPollAt: number;
};

function BottomSheet(p: SheetProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        boxShadow: '0 -10px 30px rgba(0,0,0,0.3)',
        paddingBottom: p.collapsed ? 12 : 24,
        maxHeight: '70vh',
        overflowY: 'auto',
      }}
    >
      {/* Tap-to-toggle target with a chevron that rotates to match
          state — was a thin drag bar that didn't read as collapsible. */}
      <button
        onClick={p.onToggleCollapse}
        aria-label={p.collapsed ? 'Expand sheet' : 'Collapse sheet'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 0 4px',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
        }}
      >
        <IconChevron
          size={24}
          stroke={2.25}
          style={{
            // Source glyph points right; rotate so it points up when
            // collapsed and down when expanded.
            transform: p.collapsed ? 'rotate(-90deg)' : 'rotate(90deg)',
            transition: 'transform 150ms ease',
          }}
        />
      </button>

      <div
        style={{
          padding: '6px 18px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: p.collapsed ? 'none' : '1px solid var(--border)',
        }}
      >
        <button
          onClick={p.onToggleCollapse}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--text)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <LiveDot label={p.pollPaused ? 'Paused' : 'Polling'} />
          {!p.pollPaused && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Next in{' '}
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                <PollTicker from={p.lastPollAt} paused={p.pollPaused} mode="next" />
              </span>
            </span>
          )}
          <IconChevron
            size={14}
            style={{
              color: 'var(--text-muted)',
              transform: p.collapsed ? 'none' : 'rotate(180deg)',
              transition: 'transform 150ms ease',
            }}
          />
        </button>
        <button
          onClick={p.onTogglePause}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-soft)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <IconRefresh size={12} />
          {p.pollPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {!p.collapsed && (
        p.mode === 'live' ? (
          <LiveSheet
            agency={p.agency}
            route={p.route}
            agencies={p.agencies}
            routes={p.routes}
            buses={p.buses}
            onSelectAgency={p.onSelectAgency}
            onSelectRoute={p.onSelectRoute}
            onPlanTrip={() => p.onModeChange('plan')}
          />
        ) : (
          <PlanSheet onClose={() => p.onModeChange('live')} />
        )
      )}
    </div>
  );
}

function LiveSheet(p: {
  agency: Agency | null;
  route: Route | null;
  agencies: Agency[];
  routes: Route[];
  buses: Vehicle[];
  onSelectAgency: (a: Agency) => void;
  onSelectRoute: (r: Route) => void;
  onPlanTrip: () => void;
}) {
  const [showAgencyDetails, setShowAgencyDetails] = useState(false);
  return (
    <>
      <div style={{ padding: '14px 18px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PickerRow
          label="Agency"
          value={p.agency?.name ?? 'Choose…'}
          sub={p.agency?.timezone ?? `${p.agencies.length} available`}
          tag={`${p.agencies.length} loaded`}
          options={p.agencies.map((a) => ({ key: a.id, label: a.name }))}
          onPick={(key) => {
            const a = p.agencies.find((x) => x.id === key);
            if (a) p.onSelectAgency(a);
          }}
        />

        {p.agency && (
          <AgencyDetails
            agency={p.agency}
            open={showAgencyDetails}
            onToggle={() => setShowAgencyDetails((o) => !o)}
          />
        )}
      </div>

      <div style={{ padding: '14px 18px 8px' }}>
        <button
          onClick={p.onPlanTrip}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border-hi)',
            background: 'var(--surface)',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: 'var(--signal)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--signal-ink)',
              }}
            >
              <IconRoute size={14} />
            </span>
            Plan a trip
          </span>
          <IconChevron size={14} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
    </>
  );
}

// Collapsible row showing metadata for the currently selected agency.
// Content re-renders whenever the `agency` prop changes; the open/closed
// state is owned by the parent so the row stays as the user left it
// across agency selections.
function AgencyDetails({ agency, open, onToggle }: { agency: Agency; open: boolean; onToggle: () => void }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '10px 12px',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-muted)',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            width: 60,
            flexShrink: 0,
            textAlign: 'left',
          }}
        >
          Details
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: 'var(--text-soft)',
            fontFamily: 'var(--font-sans)',
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {agency.timezone ?? '—'} · {agency.language ?? '—'}
          {agency.phone ? ` · ${agency.phone}` : ''}
        </span>
        <IconChevron
          size={14}
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
          }}
        />
      </button>
      {open && (
        <div
          style={{
            padding: '4px 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: '1px solid var(--border)',
          }}
        >
          <DetailRow label="Name" value={agency.name} />
          <DetailRow label="Timezone" value={agency.timezone ?? '—'} mono />
          <DetailRow label="Language" value={agency.language ?? '—'} mono />
          <DetailRow label="Phone" value={agency.phone ?? '—'} mono />
          <DetailLink label="Website" href={agency.url} />
          <DetailLink label="Fares" href={agency.fare_url} />
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingTop: 6 }}>
      <span
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          width: 70,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text)',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontWeight: 500,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailLink({ label, href }: { label: string; href?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingTop: 6 }}>
      <span
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          width: 70,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            fontSize: 12,
            color: 'var(--signal-soft)',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{href}</span>
          <IconExternal size={11} />
        </a>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
      )}
    </div>
  );
}

function PickerRow(props: {
  label: string;
  value: string;
  sub?: string;
  tag?: string;
  tagTone?: 'signal' | 'live' | 'neutral' | 'hot';
  highlight?: boolean;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 12,
          border: props.highlight ? '1.5px solid var(--signal)' : '1px solid var(--border)',
          background: props.highlight
            ? 'color-mix(in oklab, var(--signal) 8%, var(--surface))'
            : 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-muted)',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            width: 60,
            flexShrink: 0,
          }}
        >
          {props.label}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {props.value}
          </div>
          {props.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{props.sub}</div>}
        </div>
        {props.tag && <Tag tone={props.tagTone ?? 'signal'}>{props.tag}</Tag>}
        <IconChevron size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 6,
            background: 'var(--surface)',
            border: '1px solid var(--border-hi)',
            borderRadius: 12,
            boxShadow: '0 12px 24px rgba(0,0,0,0.25)',
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 50,
          }}
        >
          {props.options.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                props.onPick(o.key);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                textAlign: 'left',
                fontSize: 13,
                borderBottom: '1px solid var(--border)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trip plan sheet (hardcoded result list for now) ────────
function PlanSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div
        style={{
          padding: '14px 18px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          Plan a trip
        </span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
        >
          <IconClose size={14} />
        </button>
      </div>

      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
          }}
        >
          <IconSearch size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            placeholder="Where to?"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              color: 'var(--text)',
            }}
          />
        </div>
      </div>

      <div style={{ padding: '14px 18px 0' }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}
        >
          3 options found
        </div>
        <TripOption tag="Fastest" mins="22" walk="6" transfers={0} buses={['24']} />
        <TripOption tag="Less walking" mins="28" walk="3" transfers={1} buses={['24', '14']} />
        <TripOption tag="Direct" mins="35" walk="2" transfers={0} buses={['7']} />
      </div>
    </>
  );
}

function TripOption({
  tag,
  mins,
  walk,
  transfers,
  buses,
}: {
  tag: string;
  mins: string;
  walk: string;
  transfers: number;
  buses: string[];
}) {
  return (
    <div
      style={{
        marginBottom: 10,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          background: 'color-mix(in oklab, var(--signal) 14%, var(--surface))',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--signal)',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          {tag}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {transfers === 0 ? 'Direct' : `${transfers} transfer${transfers > 1 ? 's' : ''}`}
          </span>
        </span>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div
            className="display"
            style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: -0.5 }}
          >
            {mins}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 2 }}>min</span>
          </div>
          <div
            className="mono"
            style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'inline-flex', gap: 6 }}
          >
            <IconWalk size={11} /> {walk} min walk
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {buses.map((b, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 999,
                background: 'var(--signal)',
                color: 'var(--signal-ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <BusIconG size={11} />
              {b}
            </span>
          ))}
        </div>
        <IconClock size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
    </div>
  );
}
