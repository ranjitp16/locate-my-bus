import { Link } from 'react-router-dom';
import { useIsDesktop } from '../lib/useMediaQuery';
import { BrandMark } from '../components/BrandMark';
import { BusMark, BusIconG } from '../components/BusGlyph';
import { LiveDot, Tag } from '../components/atoms';
import { IconArrowRight, IconPin, IconRoute } from '../components/Icons';
import { MiniMap } from '../components/MiniMap';
import { DesktopShell } from '../components/DesktopShell';

const ROUTE_TAPE = [
  '1', '2', '4', '7', '10', '14', '20', '21', '24', '25',
  '28', '32', '41', '52', '57', '63', '85', '90', 'M1', 'M2',
];

export default function Landing() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopLanding /> : <MobileLanding />;
}

// ── Mobile ───────────────────────────────────────────────────
function MobileLanding() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 60 }}>
        {/* Brand row */}
        <div style={{ padding: '24px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <BrandMark />
          <button
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-soft)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            EN
          </button>
        </div>

        {/* Editorial headline */}
        <div style={{ padding: '22px 20px 14px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <span
              className="lmb-pulse"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--live)',
                boxShadow: '0 0 0 3px color-mix(in oklab, var(--live) 25%, transparent)',
              }}
            />
            <span
              className="mono"
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)' }}
            >
              Live · 5 cities
            </span>
          </div>
          <h1
            className="display"
            style={{
              fontSize: 42,
              lineHeight: 0.95,
              fontWeight: 600,
              letterSpacing: -1.6,
              color: 'var(--text)',
              fontFeatureSettings: '"ss01" 1',
            }}
          >
            Your bus,
            <br />
            <span style={{ fontStyle: 'italic', fontWeight: 500, color: 'var(--signal-soft)' }}>on the map.</span>
          </h1>
        </div>

        <div style={{ padding: '0 16px' }}>
          <LiveTrackerHero />
        </div>

        {/* Primary CTAs */}
        <div style={{ padding: '18px 20px 0', display: 'flex', gap: 10 }}>
          <Link
            to="/view-map"
            style={{
              flex: 1,
              padding: '14px 18px',
              background: 'var(--signal)',
              color: 'var(--signal-ink)',
              border: 'none',
              borderRadius: 999,
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 15,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 8px 20px color-mix(in oklab, var(--signal) 30%, transparent)',
              textDecoration: 'none',
            }}
          >
            <BusIconG size={16} />
            Open the map
          </Link>
          <Link
            to="/view-map"
            style={{
              padding: '14px 16px',
              background: 'transparent',
              color: 'var(--text)',
              border: '1.5px solid var(--border-hi)',
              borderRadius: 999,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
            aria-label="Plan a trip"
          >
            <IconRoute size={15} />
          </Link>
        </div>

        <div style={{ padding: '20px 20px 0' }}>
          <TodayStrip />
        </div>

        {/* Story */}
        <div style={{ padding: '24px 20px 0' }}>
          <div
            className="display"
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: -0.6,
              color: 'var(--text)',
              marginBottom: 14,
              lineHeight: 1.15,
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Pick a route.</span>
            <br />
            Watch it move.
            <br />
            <span style={{ color: 'var(--text-muted)' }}>Catch your ride.</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-soft)', fontFamily: 'var(--font-sans)' }}>
            Every <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>15 seconds</span>,
            Locate My Bus pulls fresh vehicle positions straight from the transit
            agency. No estimates, no scraping — just where the bus actually is.
          </p>
        </div>

        <div style={{ marginTop: 22 }}>
          <RouteTape />
        </div>

        <div style={{ padding: '18px 20px 0' }}>
          <div
            style={{
              paddingTop: 18,
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>by Ranjit Pandey</span>
            <Link to="/dash/agencies" style={{ color: 'var(--text-soft)', textDecoration: 'none' }}>
              Manage agencies →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mobile live tracker card — mini-map + arrival card.
function LiveTrackerHero() {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 22,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.15)',
      }}
    >
      <div style={{ height: 240, position: 'relative' }}>
        <MiniMap busCount={3} showRoute />

        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 70,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#3B82F6',
            boxShadow: '0 0 0 4px rgba(59,130,246,0.25), 0 0 0 12px rgba(59,130,246,0.1)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '6px 10px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'var(--text-soft)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        >
          <IconPin size={11} /> Halifax · NS
        </div>

        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '6px 10px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-soft)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        >
          <span style={{ color: 'var(--signal)' }}>●</span>
          <span style={{ color: 'var(--text)' }}>3</span> buses
        </div>
      </div>

      <div
        style={{
          padding: '14px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <BusMark size={48} route="24" live />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            Route 24 · Leiblin Park
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span
              className="display"
              style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: -0.6 }}
            >
              4
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-soft)', fontWeight: 600 }}>min away</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            <span style={{ color: 'var(--live)' }}>●</span> Updated 3s ago · 380m · 22 km/h
          </div>
        </div>
        <Link
          to="/view-map"
          style={{
            padding: '8px 12px',
            borderRadius: 999,
            background: 'var(--signal-tint)',
            color: 'var(--signal-soft)',
            border: '1px solid color-mix(in oklab, var(--signal) 30%, transparent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            flexShrink: 0,
            textDecoration: 'none',
          }}
        >
          Track
        </Link>
      </div>
    </div>
  );
}

function TodayStrip() {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span
          className="mono"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)' }}
        >
          Right now
        </span>
        <LiveDot label="Live" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <TickerStat value="142" label="Buses tracked" />
        <TickerStat value="779" label="Routes covered" />
        <TickerStat value="5" label="Agencies" />
      </div>
    </div>
  );
}

function TickerStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div
        className="display"
        style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: -0.5 }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

function RouteTape() {
  const doubled = [...ROUTE_TAPE, ...ROUTE_TAPE];
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        padding: '10px 0',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, width: 'max-content', animation: 'lmb-tape 28s linear infinite' }}>
        {doubled.map((r, i) => (
          <span
            key={i}
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: 999,
              background: i % 5 === 0 ? 'var(--signal)' : 'var(--surface)',
              color: i % 5 === 0 ? 'var(--signal-ink)' : 'var(--text-soft)',
              border: '1px solid var(--border)',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            <BusIconG size={11} />
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Desktop ──────────────────────────────────────────────────
function DesktopLanding() {
  return (
    <DesktopShell>
      {/* Hero */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 1fr',
          gap: 48,
          padding: '56px 64px 32px',
          alignItems: 'center',
          maxWidth: 1440,
          margin: '0 auto',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              marginBottom: 22,
            }}
          >
            <span
              className="lmb-pulse"
              style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--live)' }}
            />
            <span
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Live · 5 cities · 779 routes
            </span>
          </div>

          <h1
            className="display"
            style={{
              fontSize: 88,
              lineHeight: 0.92,
              fontWeight: 600,
              letterSpacing: -3,
              color: 'var(--text)',
              marginBottom: 28,
            }}
          >
            Your bus,
            <br />
            <span style={{ fontStyle: 'italic', fontWeight: 500, color: 'var(--signal-soft)' }}>on the map.</span>
          </h1>

          <p
            style={{
              fontSize: 18,
              lineHeight: 1.55,
              color: 'var(--text-soft)',
              maxWidth: 500,
              marginBottom: 36,
              fontWeight: 500,
            }}
          >
            Live vehicle positions for any GTFS-realtime transit agency — refreshed every{' '}
            <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>15 seconds</span>,
            straight from the source. Pick a route, pin a bus, watch it move.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/view-map"
              style={{
                padding: '16px 24px',
                background: 'var(--signal)',
                color: 'var(--signal-ink)',
                border: 'none',
                borderRadius: 999,
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                whiteSpace: 'nowrap',
                boxShadow: '0 12px 28px color-mix(in oklab, var(--signal) 30%, transparent)',
                textDecoration: 'none',
              }}
            >
              <BusIconG size={18} />
              Open the map
              <IconArrowRight size={16} />
            </Link>
            <Link
              to="/view-map"
              style={{
                padding: '16px 22px',
                background: 'transparent',
                color: 'var(--text)',
                border: '1.5px solid var(--border-hi)',
                borderRadius: 999,
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 15,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                textDecoration: 'none',
              }}
            >
              <IconRoute size={16} />
              Plan a trip
            </Link>
          </div>

          <div
            style={{
              marginTop: 44,
              paddingTop: 24,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 36,
            }}
          >
            <TrustStat value="156,420" label="Polls today" />
            <TrustStat value="0.0%" label="Error rate" tone="live" />
            <TrustStat value="< 15s" label="Latency" />
            <TrustStat value="MIT" label="Open source" />
          </div>
        </div>

        <DesktopTrackerHero />
      </div>

      {/* Agency cards strip */}
      <div style={{ padding: '24px 64px 0', maxWidth: 1440, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            Tracked agencies
          </div>
          <Link
            to="/dash/agencies"
            style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}
          >
            Add yours →
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          <AgencyMini name="Halifax Transit" buses="142" routes="87" />
          <AgencyMini name="TTC Toronto" buses="1,820" routes="240" />
          <AgencyMini name="TransLink" buses="1,470" routes="215" />
          <AgencyMini name="London Transit" buses="78" routes="42" />
          <AgencyMini name="ETS Edmonton" buses="—" routes="195" stale />
        </div>
      </div>

      <div style={{ marginTop: 36 }}>
        <RouteTape />
      </div>
    </DesktopShell>
  );
}

function TrustStat({ value, label, tone = 'neutral' }: { value: string; label: string; tone?: 'neutral' | 'live' }) {
  const color = tone === 'live' ? 'var(--live)' : 'var(--text)';
  return (
    <div>
      <div
        className="display"
        style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1, letterSpacing: -0.5 }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

function AgencyMini({ name, buses, routes, stale }: { name: string; buses: string; routes: string; stale?: boolean }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
        {stale ? (
          <Tag tone="hot">Stale</Tag>
        ) : (
          <span
            className="lmb-pulse"
            style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div>
          <div
            className="mono"
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: stale ? 'var(--text-muted)' : 'var(--text)',
              lineHeight: 1,
            }}
          >
            {buses}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            buses
          </div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-soft)', lineHeight: 1 }}>
            {routes}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            routes
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopTrackerHero() {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 28,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        boxShadow: '0 30px 60px rgba(0,0,0,0.25), 0 8px 18px rgba(0,0,0,0.15)',
        height: 520,
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <MiniMap busCount={3} showRoute />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--text-soft)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
        }}
      >
        <IconPin size={12} /> Halifax, NS · Route 24
      </div>

      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-soft)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
          }}
        >
          <LiveDot label="Polling · 7s" />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '54%',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#3B82F6',
          boxShadow: '0 0 0 5px rgba(59,130,246,0.25), 0 0 0 14px rgba(59,130,246,0.12)',
          transform: 'translate(-50%, -50%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          right: 20,
          padding: '16px 18px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 12px 28px rgba(0,0,0,0.32)',
        }}
      >
        <BusMark size={60} route="24" live />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            Route 24 · Leiblin Park
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span
              className="display"
              style={{ fontSize: 36, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: -0.8 }}
            >
              4
            </span>
            <span style={{ fontSize: 15, color: 'var(--text-soft)', fontWeight: 600 }}>min away · 380 m</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            <span style={{ color: 'var(--live)' }}>●</span> Vehicle #2218 · 22 km/h · updated 3s ago
          </div>
        </div>
        <Link
          to="/view-map"
          style={{
            padding: '12px 18px',
            borderRadius: 999,
            background: 'var(--signal)',
            color: 'var(--signal-ink)',
            border: 'none',
            fontWeight: 700,
            fontSize: 13,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textDecoration: 'none',
          }}
        >
          <IconPin size={14} /> Pin bus
        </Link>
      </div>
    </div>
  );
}
