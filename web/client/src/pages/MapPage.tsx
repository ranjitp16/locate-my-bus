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
import type { MapAdapter } from '../lib/maps/adapter';
import { AzureMapAdapter } from '../lib/maps/azureAdapter';

const POLL_INTERVAL_MS = 15_000;

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
  const [searchParams] = useSearchParams();
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
  const [sheetMode, setSheetMode] = useState<'live' | 'plan'>(
    searchParams.get('mode') === 'plan' ? 'plan' : 'live'
  );
  // Returning visitors (with a persisted agency choice) land with the
  // bottom sheet collapsed — they've already done the agency setup.
  const [sheetCollapsed, setSheetCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AGENCY_KEY) != null;
  });
  const [lastPollAt, setLastPollAt] = useState<number>(() => Date.now());

  const setPinnedVid = useCallback((vid: string | null) => setPinnedVidRaw(vid), []);

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
      .then((r) => r.json())
      .then((list: Agency[]) => setAgencies(list))
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
      .then((r) => r.json())
      .then((list: Route[]) => {
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
        const data: Vehicle[] = await r.json();
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
      const bearing = bus.bearing != null ? Number(bus.bearing) : undefined;
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
        adapter.updateMarker(bus.vehicle_id, { position, html });
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

  // ── Clean markers + route + stops when route changes ─────
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    for (const id of adapter.listMarkerIds()) adapter.removeMarker(id);
    adapter.clearRoute();
    adapter.clearStops();
    setPinnedVid(null);
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
        drawnTripIdRef.current = null;
      }
      return;
    }

    const pinnedBus = buses.find((b) => b.vehicle_id === pinnedVid);
    const tripId = pinnedBus?.trip_id;
    if (!tripId || drawnTripIdRef.current === tripId) return;

    drawnTripIdRef.current = tripId;
    let cancelled = false;

    fetch(`/api/shape/${selectedAgency.id}/${tripId}`)
      .then((r) => r.json())
      .then((data: { rows?: Array<{ pt_lat: string; pt_lon: string }> }) => {
        if (cancelled || drawnTripIdRef.current !== tripId) return;
        const points = (data.rows ?? []).map((row) => ({
          lat: Number(row.pt_lat),
          lng: Number(row.pt_lon),
        }));
        if (points.length) adapter.drawRoute(points);
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
      .then((r) => r.json())
      .then((rows: StopRow[]) => {
        if (cancelled || drawnTripIdRef.current !== tripId) return;
        const stops = (rows ?? []).map((s) => ({
          id: String(s.stop_id),
          position: { lat: Number(s.lat), lng: Number(s.lon) },
          name: s.name ?? undefined,
          code: s.code ?? undefined,
          arrivalTime: s.arrival_time ?? undefined,
          accessible: s.wheelchair_boarding === '1',
        }));
        adapter.updateStops(stops);
      })
      .catch((e) => console.error('stops load failed', e));

    return () => {
      cancelled = true;
    };
  }, [pinnedVid, buses, selectedAgency, mapReady]);

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

      {/* Right side FAB cluster */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          right: 12,
          zIndex: 30,
          display: 'flex',
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
            <PopupStat value={String(Math.round(pinnedBus.speed ?? 0))} unit="km/h" label="Speed" />
            <PopupStat value={String(Math.round((pinnedBus.bearing ?? 0)))} unit="°" label="Bearing" />
            <PopupStat value="—" unit="min" label="ETA" />
          </div>
        </div>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        mode={sheetMode}
        onModeChange={(m) => {
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
              transform: p.collapsed ? 'rotate(180deg)' : 'none',
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
