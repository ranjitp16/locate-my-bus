import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIsDesktop } from '../lib/useMediaQuery';
import { DesktopShell } from '../components/DesktopShell';
import { LiveDot, Tag } from '../components/atoms';
import { IconArrowLeft, IconBolt, IconChevron, IconRefresh } from '../components/Icons';

type Tab = 'raw' | 'analytics';

export default function MonitorPage() {
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>('raw');

  const tabs = <TabSwitch tab={tab} onChange={setTab} />;
  const body = tab === 'raw' ? <RawBody /> : <AnalyticsBody />;

  if (isDesktop) {
    return (
      <DesktopShell>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 64px 80px' }}>
          {tabs}
          <div style={{ marginTop: 22 }}>{body}</div>
        </div>
      </DesktopShell>
    );
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 0 80px' }}>
        <MobileHeader />
        <div style={{ padding: '14px 18px 0' }}>{tabs}</div>
        <div style={{ padding: '0 18px' }}>{body}</div>
      </div>
    </div>
  );
}

function MobileHeader() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'color-mix(in oklab, var(--bg) 88%, transparent)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <Link
        to="/"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <IconArrowLeft size={16} />
      </Link>
      <span
        className="mono"
        style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 0.6,
          textAlign: 'center',
          color: 'var(--text)',
        }}
      >
        POLL<span style={{ color: 'var(--text-muted)' }}>.</span>MONITOR
      </span>
      <button
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <IconRefresh size={11} />
      </button>
    </div>
  );
}

function TabSwitch({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: 3,
        background: 'var(--surface)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        maxWidth: 360,
      }}
    >
      <TabButton active={tab === 'raw'} onClick={() => onChange('raw')}>
        Raw data
      </TabButton>
      <TabButton active={tab === 'analytics'} onClick={() => onChange('analytics')}>
        Analytics
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 10px',
        background: active ? 'var(--signal)' : 'transparent',
        color: active ? 'var(--signal-ink)' : 'var(--text-soft)',
        border: 'none',
        borderRadius: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </div>
  );
}

// ── Raw tab ────────────────────────────────────────────────
type Iter = { id: number; time: string; ago: string; agencies: number; exec: number; errors: number; cache: number };
const ITERATIONS: Iter[] = [
  { id: 156420, time: '21:25:04', ago: '2s', agencies: 5, exec: 387, errors: 0, cache: 0 },
  { id: 156419, time: '21:24:46', ago: '20s', agencies: 5, exec: 377, errors: 0, cache: 0 },
  { id: 156418, time: '21:24:28', ago: '38s', agencies: 5, exec: 354, errors: 0, cache: 0 },
  { id: 156417, time: '21:24:11', ago: '55s', agencies: 5, exec: 338, errors: 0, cache: 0 },
  { id: 156416, time: '21:23:54', ago: '1m12s', agencies: 5, exec: 337, errors: 0, cache: 12 },
  { id: 156415, time: '21:23:36', ago: '1m30s', agencies: 5, exec: 341, errors: 0, cache: 0 },
  { id: 156414, time: '21:23:19', ago: '1m47s', agencies: 5, exec: 343, errors: 0, cache: 0 },
  { id: 156413, time: '21:23:02', ago: '2m04s', agencies: 5, exec: 1247, errors: 1, cache: 0 },
  { id: 156412, time: '21:22:45', ago: '2m21s', agencies: 5, exec: 358, errors: 0, cache: 0 },
  { id: 156411, time: '21:22:27', ago: '2m39s', agencies: 5, exec: 347, errors: 0, cache: 0 },
];

const SPARK_DATA = [
  34, 35, 33, 35, 36, 34, 35, 33, 34, 35, 36, 38, 34, 33, 35, 36, 33, 34, 35, 34,
  36, 35, 33, 34, 96, 35, 33, 34, 35, 33, 35, 34, 33, 35, 36, 35, 34, 33, 35, 34,
  33, 35, 34, 36, 35, 33, 35, 34, 38, 34, 35, 34, 33, 35, 36, 33, 34, 36, 35,
];

function RawBody() {
  return (
    <>
      <div style={{ padding: '18px 0 0' }}>
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 0, right: 0, padding: '8px 12px' }}>
            <LiveDot label="Healthy" />
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Daemon uptime · 28d 14h
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span
              className="mono"
              style={{ fontSize: 42, fontWeight: 800, color: 'var(--text)', lineHeight: 0.95, letterSpacing: -1.5 }}
            >
              71,376
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              iterations
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 14,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
            }}
          >
            <MiniMetric value="356,385" label="Executions" />
            <MiniMetric value="331" unit="ms" label="Avg exec" />
            <MiniMetric value="0.0%" label="Error rate" tone="live" />
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 0 0' }}>
        <div
          style={{
            padding: '14px 14px 8px',
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
            <SectionLabel>Exec time · last hour</SectionLabel>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
              240 polls
            </span>
          </div>
          <Sparkline data={SPARK_DATA} />
        </div>
      </div>

      <div style={{ padding: '18px 0 4px' }}>
        <SectionLabel>Recent iterations</SectionLabel>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ITERATIONS.map((it) => (
          <IterationRow key={it.id} {...it} />
        ))}
      </div>
    </>
  );
}

function MiniMetric({ value, unit, label, tone = 'neutral' }: { value: string; unit?: string; label: string; tone?: 'neutral' | 'live' }) {
  const color = tone === 'live' ? 'var(--live)' : 'var(--text)';
  return (
    <div style={{ flex: 1 }}>
      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1, letterSpacing: -0.3 }}>
        {value}
        {unit && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, letterSpacing: 0 }}>{unit}</span>
        )}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function IterationRow({ id, time, ago, agencies, exec, errors, cache }: Iter) {
  const slow = exec > 800;
  const err = errors > 0;
  const dot = err ? 'var(--hot)' : slow ? 'var(--signal)' : 'var(--live)';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          boxShadow: `0 0 0 3px color-mix(in oklab, ${dot} 22%, transparent)`,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
          #{id}
          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontWeight: 500 }}>{ago} ago</span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {time} · {agencies} agencies{cache > 0 && ` · ${cache} cached`}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          className="mono"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: slow ? 'var(--signal)' : err ? 'var(--hot)' : 'var(--text)',
            lineHeight: 1,
          }}
        >
          {exec}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 500 }}>ms</span>
        </div>
        {err && <Tag tone="hot">{errors} err</Tag>}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(v / max) * 100}%`,
            background: v > 60 ? 'var(--signal)' : 'var(--cool)',
            borderRadius: 1,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

// ── Analytics tab ──────────────────────────────────────────
type Feed = { name: string; dlAvg: number; dlMax: number; execAvg: number; execMax: number; anomaly: boolean };
const FEEDS: Feed[] = [
  { name: 'TransLink', dlAvg: 221, dlMax: 6369, execAvg: 614, execMax: 28707, anomaly: true },
  { name: 'TTC Toronto', dlAvg: 122, dlMax: 3379, execAvg: 608, execMax: 30754, anomaly: true },
  { name: 'Edmonton Transit', dlAvg: 241, dlMax: 1382, execAvg: 331, execMax: 4595, anomaly: true },
  { name: 'Halifax Transit', dlAvg: 204, dlMax: 2495, execAvg: 58, execMax: 10758, anomaly: true },
  { name: 'London Transit', dlAvg: 25, dlMax: 19797, execAvg: 46, execMax: 855, anomaly: true },
];

const HIST_DATA = Array.from({ length: 60 }, (_, i) => {
  const base = 28 + Math.sin(i * 0.4) * 6 + (i % 7) * 1.5;
  if (i === 24) return 100;
  if (i === 41) return 60;
  return base;
});

function AnalyticsBody() {
  return (
    <>
      <div style={{ padding: '18px 0 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <BigStat value="71,293" label="Iterations" sub="#85121 → #156420" />
          <BigStat value="~20s" label="Cycle interval" sub="avg between polls" />
          <BigStat value="13.6%" label="Cache hit rate" sub="of executions" tone="signal" />
          <BigStat value="3,230" label="Slow incidents" sub="≥3× baseline" tone="hot" />
        </div>
      </div>

      <div style={{ padding: '18px 0 0' }}>
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <SectionLabel>Download latency</SectionLabel>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>Halifax Transit</div>
            </div>
            <select
              style={{
                padding: '5px 8px',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              <option>Halifax</option>
            </select>
          </div>

          <Histogram data={HIST_DATA} />

          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              avg <span style={{ color: 'var(--text)', fontWeight: 700 }}>204ms</span>
            </span>
            <span>
              p95 <span style={{ color: 'var(--text)', fontWeight: 700 }}>312ms</span>
            </span>
            <span>
              max <span style={{ color: 'var(--hot)', fontWeight: 700 }}>2495ms</span>
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <SectionLabel>Feed health</SectionLabel>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
            5 distinct rt_feed URLs
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FEEDS.map((f) => (
            <FeedHealthCard key={f.name} {...f} />
          ))}
        </div>
      </div>

      <div style={{ padding: '18px 0 4px' }}>
        <SectionLabel>Recent slow events</SectionLabel>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SlowEventRow feed="London Transit" exec={19797} time="14:08" baseline={25} />
        <SlowEventRow feed="TTC Toronto" exec={30754} time="13:51" baseline={122} />
        <SlowEventRow feed="TransLink" exec={6369} time="13:34" baseline={221} />
        <SlowEventRow feed="Halifax Transit" exec={2495} time="13:12" baseline={204} />
      </div>
    </>
  );
}

function BigStat({
  value,
  label,
  sub,
  tone = 'neutral',
}: {
  value: string;
  label: string;
  sub: string;
  tone?: 'neutral' | 'signal' | 'hot' | 'live';
}) {
  const color =
    tone === 'signal' ? 'var(--signal)' : tone === 'hot' ? 'var(--hot)' : tone === 'live' ? 'var(--live)' : 'var(--text)';
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
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
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.05, marginTop: 4, letterSpacing: -0.5 }}
      >
        {value}
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3 }}>
        {sub}
      </div>
    </div>
  );
}

function Histogram({ data }: { data: number[] }) {
  return (
    <div style={{ position: 'relative', height: 80 }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '55%',
          height: 1,
          borderTop: '1px dashed var(--border-hi)',
          opacity: 0.7,
        }}
      />
      <div
        className="mono"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          fontSize: 8,
          color: 'var(--text-muted)',
          transform: 'translateY(-100%)',
        }}
      >
        avg
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: '100%' }}>
        {data.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${v}%`,
              background: v > 50 ? 'var(--hot)' : v > 38 ? 'var(--signal)' : 'var(--cool)',
              borderRadius: '1px 1px 0 0',
              opacity: 0.85,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FeedHealthCard({ name, dlAvg, dlMax, execAvg, execMax, anomaly }: Feed) {
  const ratio = Math.min(1, Math.log(dlMax / Math.max(dlAvg, 1)) / Math.log(100));
  return (
    <div
      style={{
        padding: '11px 14px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
          {anomaly && <Tag tone="hot">Anomaly</Tag>}
        </div>
        <IconChevron size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <FeedMetric label="DL avg / max" avg={dlAvg} max={dlMax} />
        <FeedMetric label="Exec avg / max" avg={execAvg} max={execMax} />
      </div>
      <div
        style={{
          marginTop: 10,
          height: 4,
          borderRadius: 2,
          background: 'var(--surface-alt)',
          overflow: 'hidden',
        }}
      >
        <div style={{ height: '100%', width: `${ratio * 100}%`, background: 'var(--hot)', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function FeedMetric({ label, avg, max }: { label: string; avg: number; max: number }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {avg}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          /
        </span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--hot)' }}>
          {max}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 500 }}>ms</span>
        </span>
      </div>
    </div>
  );
}

function SlowEventRow({ feed, exec, time, baseline }: { feed: string; exec: number; time: string; baseline: number }) {
  const mult = Math.round(exec / baseline);
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          background: 'color-mix(in oklab, var(--hot) 15%, transparent)',
          color: 'var(--hot)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconBolt size={14} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{feed}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {time} · baseline {baseline}ms
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--hot)', lineHeight: 1 }}>
          {exec.toLocaleString()}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>ms</span>
        </div>
        <div className="mono" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', marginTop: 3 }}>
          ×{mult} baseline
        </div>
      </div>
    </div>
  );
}
