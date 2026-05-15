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
import { proxyAuthOptions, proxyTransformRequest } from '../lib/azureMaps';

const POLL_INTERVAL_MS = 15_000;

type AtlasNs = typeof import('azure-maps-control');

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme } = useTheme();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<AtlasNs['Map']> | null>(null);
  const markersRef = useRef<Map<string, { marker: InstanceType<AtlasNs['HtmlMarker']>; el: HTMLDivElement }>>(new Map());
  const atlasRef = useRef<AtlasNs | null>(null);

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
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [lastPollAt, setLastPollAt] = useState<number>(() => Date.now());

  const setPinnedVid = useCallback((vid: string | null) => setPinnedVidRaw(vid), []);

  // ── Initialize Azure Maps once ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const atlas = await import('azure-maps-control');
      await import('azure-maps-control/dist/atlas.min.css');
      if (cancelled || !mapContainerRef.current) return;
      atlasRef.current = atlas;

      const map = new atlas.Map(mapContainerRef.current, {
        center: [-63.5752, 44.6488], // Halifax
        zoom: 12,
        style: theme === 'dark' ? 'grayscale_dark' : 'road',
        language: 'en-US',
        authOptions: proxyAuthOptions,
        transformRequest: proxyTransformRequest,
      });

      map.events.add('ready', () => {
        if (cancelled) return;
        mapInstanceRef.current = map;
        setMapReady(true);
      });
    })();
    return () => {
      cancelled = true;
      mapInstanceRef.current?.dispose();
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update map style on theme change ───────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const next = theme === 'dark' ? 'grayscale_dark' : 'road';
    const current = (map.getStyle() as { style?: string }).style;
    if (current === next) return;
    map.setStyle({ style: next });
  }, [theme, mapReady]);

  // ── Load agencies once ─────────────────────────────────────
  useEffect(() => {
    fetch('/api/agencies')
      .then((r) => r.json())
      .then((list: Agency[]) => setAgencies(list))
      .catch((e) => console.error('agencies load failed', e));
  }, []);

  // ── Default selected agency on first load ─────────────────
  useEffect(() => {
    if (!selectedAgency && agencies.length) setSelectedAgency(agencies[0]);
  }, [agencies, selectedAgency]);

  // ── Load routes when agency changes ────────────────────────
  useEffect(() => {
    if (!selectedAgency) return;
    fetch(`/routes/${selectedAgency.id}/1`)
      .then((r) => r.json())
      .then((list: Route[]) => {
        setRoutes(list);
        setSelectedRoute(list[0] ?? null);
      })
      .catch((e) => console.error('routes load failed', e));
  }, [selectedAgency]);

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
  // One effect handles position, heading, pinned state, and lifecycle. Always
  // re-renders innerHTML so bearing changes from the poll are reflected; cost
  // is small relative to the 15s polling cadence.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const atlas = atlasRef.current;
    if (!map || !atlas || !mapReady || !selectedRoute) return;

    const seen = new Set<string>();
    const routeId = selectedRoute.id;

    for (const bus of buses) {
      seen.add(bus.vehicle_id);
      const pinned = bus.vehicle_id === pinnedVid;
      const bearing = bus.bearing != null ? Number(bus.bearing) : undefined;
      const position: [number, number] = [Number(bus.lon), Number(bus.lat)];
      const html = renderToStaticMarkup(
        <BusMark
          size={42}
          route={routeId}
          live
          pinned={pinned}
          bearing={bearing}
          idSeed={`v${bus.vehicle_id}`}
        />
      );

      const existing = markersRef.current.get(bus.vehicle_id);
      if (existing) {
        existing.marker.setOptions({ position });
        existing.el.innerHTML = html;
      } else {
        const wrap = document.createElement('div');
        wrap.dataset.vid = bus.vehicle_id;
        wrap.style.cursor = 'pointer';
        wrap.innerHTML = html;
        wrap.addEventListener('click', (e) => {
          e.stopPropagation();
          const vid = (e.currentTarget as HTMLDivElement).dataset.vid;
          if (vid) setPinnedVid(vid);
        });
        const marker = new atlas.HtmlMarker({ htmlContent: wrap, position });
        map.markers.add(marker);
        markersRef.current.set(bus.vehicle_id, { marker, el: wrap });
      }
    }

    for (const [vid, entry] of markersRef.current.entries()) {
      if (!seen.has(vid)) {
        map.markers.remove(entry.marker);
        markersRef.current.delete(vid);
      }
    }
  }, [buses, pinnedVid, mapReady, selectedRoute, setPinnedVid]);

  // ── Clean markers when route changes ───────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    for (const entry of markersRef.current.values()) {
      map.markers.remove(entry.marker);
    }
    markersRef.current.clear();
    setPinnedVid(null);
  }, [selectedRoute, setPinnedVid]);

  // ── Recenter to pinned bus ─────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !pinnedVid) return;
    const bus = buses.find((b) => b.vehicle_id === pinnedVid);
    if (!bus) return;
    map.setCamera({
      center: [Number(bus.lon), Number(bus.lat)],
      zoom: Math.max(map.getCamera().zoom ?? 14, 14),
      type: 'ease',
      duration: 400,
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
        <div
          style={{
            flex: 1,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
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
          <IconChevron size={14} style={{ color: 'var(--text-muted)' }} />
        </div>
        <button
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
          <IconGear size={18} />
        </button>
      </div>

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
      {/* Drag handle doubles as a tap-to-collapse target. */}
      <button
        onClick={p.onToggleCollapse}
        aria-label={p.collapsed ? 'Expand sheet' : 'Collapse sheet'}
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '8px 0 4px',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-hi)' }} />
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
          label="Route"
          value={p.route ? `${p.route.id} · ${p.route.long_name}` : 'Choose…'}
          sub={`${p.buses.length} buses running`}
          tag={p.buses.length ? 'Live' : 'Idle'}
          tagTone={p.buses.length ? 'live' : 'neutral'}
          highlight
          options={p.routes.map((r) => ({ key: r.id, label: `${r.id} · ${r.long_name}` }))}
          onPick={(key) => {
            const r = p.routes.find((x) => x.id === key);
            if (r) p.onSelectRoute(r);
          }}
        />

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
