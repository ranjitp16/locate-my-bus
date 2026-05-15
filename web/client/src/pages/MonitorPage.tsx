import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIsDesktop } from '../lib/useMediaQuery';
import { useAccessKey } from '../lib/useAccessKey';
import { DesktopShell } from '../components/DesktopShell';
import { MobileNavSheet } from '../components/MobileNavSheet';
import { LiveDot, Tag } from '../components/atoms';
import { IconArrowLeft, IconBolt, IconChevron, IconRefresh } from '../components/Icons';

type Tab = 'raw' | 'analytics';

type Stats = {
  total_iterations: number;
  total_executions: number;
  avg_execution_ms: number | null;
  cache_hit_pct: number | null;
  error_pct: number | null;
  oldest_iteration_at: string | null;
};

type Iteration = {
  id: number;
  started_at: string;
  agency_count: number;
  actual_executions: number;
  avg_execution_ms: number | null;
  error_count: number;
  cache_hits: number;
};

type FeedStat = {
  agency_id: string;
  agency_name: string;
  rt_feed_url: string;
  total_executions: number;
  cache_hits: number;
  avg_download_ms: number | null;
  max_download_ms: number | null;
  avg_exec_ms: number | null;
  max_exec_ms: number | null;
  error_count: number;
  slow_incidents: number;
};

type AnalyticsResponse = {
  feedStats: FeedStat[];
  summary: {
    total_iterations: number;
    min_iteration_id: number;
    max_iteration_id: number;
    unique_feeds: number;
    cache_hit_pct: number | null;
    avg_cycle_seconds: number | null;
    slow_incidents: number;
  };
};

type LatencyPoint = {
  iteration_id: number;
  agency_id: string;
  agency_name: string;
  download_ms: number;
};

export default function MonitorPage() {
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>('raw');
  const [accessKey, setAccessKey] = useAccessKey();
  const [stats, setStats] = useState<Stats | null>(null);
  const [iterations, setIterations] = useState<Iteration[] | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [latency, setLatency] = useState<LatencyPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!accessKey) {
      setStats(null);
      setIterations(null);
      setAnalytics(null);
      setLatency(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const headers = { 'x-access-key': accessKey };
      const [s, i, a, l] = await Promise.all([
        fetch('/api/dashboard/stats', { headers }),
        fetch('/api/dashboard/iterations', { headers }),
        fetch('/api/dashboard/analytics', { headers }),
        fetch('/api/dashboard/latency', { headers }),
      ]);
      if ([s, i, a, l].some((r) => r.status === 401)) {
        setAccessKey('');
        throw new Error('Access key rejected — re-enter it.');
      }
      if (![s, i, a, l].every((r) => r.ok)) {
        throw new Error('Failed to fetch dashboard data.');
      }
      setStats(await s.json());
      setIterations(await i.json());
      setAnalytics(await a.json());
      setLatency(await l.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch dashboard data.');
      setStats(null);
      setIterations(null);
      setAnalytics(null);
      setLatency(null);
    } finally {
      setBusy(false);
    }
  }, [accessKey, setAccessKey]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTick]);

  const onRefresh = () => setRefreshTick((n) => n + 1);

  const tabs = <TabSwitch tab={tab} onChange={setTab} />;
  const body = (
    <>
      {!accessKey && (
        <AccessKeyPrompt onSubmit={setAccessKey} />
      )}
      {accessKey && error && <Banner tone="hot">{error}</Banner>}
      {accessKey && !error && (
        tab === 'raw' ? (
          <RawBody stats={stats} iterations={iterations} />
        ) : (
          <AnalyticsBody analytics={analytics} latency={latency} />
        )
      )}
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell
        rightSlot={
          accessKey ? <RefreshButton onClick={onRefresh} busy={busy} /> : null
        }
      >
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
        <MobileHeader onRefresh={onRefresh} busy={busy} hasKey={!!accessKey} />
        <div style={{ padding: '14px 18px 0' }}>{tabs}</div>
        <div style={{ padding: '0 18px' }}>{body}</div>
      </div>
    </div>
  );
}

// ── Headers / chrome ──────────────────────────────────────
function MobileHeader({ onRefresh, busy, hasKey }: { onRefresh: () => void; busy: boolean; hasKey: boolean }) {
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
      {hasKey && <RefreshButton onClick={onRefresh} busy={busy} compact />}
      <MobileNavSheet />
    </div>
  );
}

function RefreshButton({ onClick, busy, compact }: { onClick: () => void; busy: boolean; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: compact ? '6px 10px' : '7px 12px',
        borderRadius: compact ? 8 : 999,
        background: compact ? 'var(--surface)' : 'transparent',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? 10 : 12,
        fontWeight: 700,
        letterSpacing: compact ? 0.4 : undefined,
        textTransform: compact ? 'uppercase' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <IconRefresh size={compact ? 11 : 12} />
      {!compact && (busy ? 'Refreshing…' : 'Refresh')}
    </button>
  );
}

// Uses a *local* draft so every keystroke doesn't commit the key to the
// parent — the parent kicks off four authed fetches whenever it changes,
// and a 401 clears the key, which would wipe the user's input mid-type.
function AccessKeyPrompt({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    if (draft) onSubmit(draft);
  };
  return (
    <div
      style={{
        marginTop: 20,
        padding: '20px 18px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        maxWidth: 480,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Authentication required
      </div>
      <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, marginBottom: 12 }}>
        Enter the dashboard access key to view daemon health and feed analytics.
      </div>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Access key"
        autoFocus
        style={{
          width: '100%',
          padding: '11px 12px',
          background: 'var(--bg)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          outline: 'none',
          marginBottom: 10,
        }}
      />
      <button
        onClick={submit}
        disabled={!draft}
        style={{
          width: '100%',
          padding: '11px 14px',
          borderRadius: 10,
          background: 'var(--signal)',
          color: 'var(--signal-ink)',
          border: 'none',
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          opacity: !draft ? 0.5 : 1,
          cursor: draft ? 'pointer' : 'not-allowed',
        }}
      >
        Unlock
      </button>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'hot' | 'live'; children: React.ReactNode }) {
  const color = tone === 'hot' ? 'var(--hot)' : 'var(--live)';
  return (
    <div
      style={{
        marginTop: 14,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${color}`,
        background: `color-mix(in oklab, ${color} 8%, var(--surface))`,
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {children}
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
      <TabButton active={tab === 'raw'} onClick={() => onChange('raw')}>Raw data</TabButton>
      <TabButton active={tab === 'analytics'} onClick={() => onChange('analytics')}>Analytics</TabButton>
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

// ── Formatters ────────────────────────────────────────────
function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-US');
}

function fmtUptime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${days}d ${hours}h`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m${s.toString().padStart(2, '0')}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

// ── Raw tab ───────────────────────────────────────────────
function RawBody({ stats, iterations }: { stats: Stats | null; iterations: Iteration[] | null }) {
  const sparkData = useMemo(() => {
    if (!iterations) return [];
    const arr = iterations
      .slice()
      .reverse()
      .map((it) => it.avg_execution_ms ?? 0);
    return arr;
  }, [iterations]);
  const errorPct = stats?.error_pct;
  const errorTone: 'live' | 'hot' = (errorPct ?? 0) > 1 ? 'hot' : 'live';
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
            <LiveDot label={errorTone === 'hot' ? 'Degraded' : 'Healthy'} />
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
            Daemon uptime · {fmtUptime(stats?.oldest_iteration_at ?? null)}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
            <span
              className="mono"
              style={{ fontSize: 42, fontWeight: 800, color: 'var(--text)', lineHeight: 0.95, letterSpacing: -1.5 }}
            >
              {stats ? fmtInt(stats.total_iterations) : '—'}
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
            <MiniMetric value={stats ? fmtInt(stats.total_executions) : '—'} label="Executions" />
            <MiniMetric value={stats?.avg_execution_ms != null ? String(stats.avg_execution_ms) : '—'} unit="ms" label="Avg exec" />
            <MiniMetric
              value={stats?.error_pct != null ? `${stats.error_pct.toFixed(1)}%` : '—'}
              label="Error rate"
              tone={errorTone}
            />
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
            <SectionLabel>Exec time · last {sparkData.length} iterations</SectionLabel>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
              {sparkData.length} polls
            </span>
          </div>
          {sparkData.length > 0 ? (
            <Sparkline data={sparkData} />
          ) : (
            <SkeletonBlock height={56} />
          )}
        </div>
      </div>

      <div style={{ padding: '18px 0 4px' }}>
        <SectionLabel>Recent iterations</SectionLabel>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {iterations == null && (
          <>
            <SkeletonBlock height={52} />
            <SkeletonBlock height={52} />
            <SkeletonBlock height={52} />
          </>
        )}
        {iterations?.slice(0, 12).map((it) => (
          <IterationRow key={it.id} iter={it} />
        ))}
      </div>
    </>
  );
}

function MiniMetric({
  value, unit, label, tone = 'neutral',
}: { value: string; unit?: string; label: string; tone?: 'neutral' | 'live' | 'hot' }) {
  const color = tone === 'live' ? 'var(--live)' : tone === 'hot' ? 'var(--hot)' : 'var(--text)';
  return (
    <div style={{ flex: 1 }}>
      <div className="mono" style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1, letterSpacing: -0.3 }}>
        {value}
        {unit && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2 }}>{unit}</span>}
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

function IterationRow({ iter }: { iter: Iteration }) {
  const exec = iter.avg_execution_ms ?? 0;
  const slow = exec > 800;
  const err = iter.error_count > 0;
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
          #{iter.id}
          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontWeight: 500 }}>{fmtAgo(iter.started_at)} ago</span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {fmtTime(iter.started_at)} · {iter.agency_count} agenc{iter.agency_count === 1 ? 'y' : 'ies'}
          {iter.cache_hits > 0 && ` · ${iter.cache_hits} cached`}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          className="mono"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: err ? 'var(--hot)' : slow ? 'var(--signal)' : 'var(--text)',
            lineHeight: 1,
          }}
        >
          {exec}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 500 }}>ms</span>
        </div>
        {err && <Tag tone="hot">{iter.error_count} err</Tag>}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: v > max * 0.6 ? 'var(--signal)' : 'var(--cool)',
            borderRadius: 1,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function SkeletonBlock({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: 10,
        background: 'color-mix(in oklab, var(--text-muted) 8%, transparent)',
        opacity: 0.6,
      }}
    />
  );
}

// ── Analytics tab ─────────────────────────────────────────
function AnalyticsBody({ analytics, latency }: { analytics: AnalyticsResponse | null; latency: LatencyPoint[] | null }) {
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);
  const summary = analytics?.summary;

  const feedStats = analytics?.feedStats ?? [];
  // Default the selected agency to the first feed once loaded.
  useEffect(() => {
    if (selectedAgencyId == null && feedStats.length) {
      setSelectedAgencyId(feedStats[0].agency_id);
    }
  }, [feedStats, selectedAgencyId]);

  const selectedFeed = useMemo(
    () => feedStats.find((f) => f.agency_id === selectedAgencyId) ?? null,
    [feedStats, selectedAgencyId]
  );

  const agencyLatency = useMemo(
    () => (latency ?? []).filter((p) => p.agency_id === selectedAgencyId).map((p) => p.download_ms),
    [latency, selectedAgencyId]
  );

  const latencyStats = useMemo(() => {
    if (!agencyLatency.length) return null;
    const sorted = agencyLatency.slice().sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const max = sorted[sorted.length - 1];
    return { avg, p95, max };
  }, [agencyLatency]);

  // Top slow events across agencies — sorted by raw download_ms desc, capped.
  const slowEvents = useMemo(() => {
    if (!latency || !analytics) return [];
    const avgByAgency = new Map(feedStats.map((f) => [f.agency_id, f.avg_download_ms ?? 0]));
    return latency
      .map((p) => ({
        feed: p.agency_name,
        agency_id: p.agency_id,
        exec: p.download_ms,
        baseline: avgByAgency.get(p.agency_id) ?? 0,
        iteration_id: p.iteration_id,
      }))
      .filter((e) => e.baseline > 0 && e.exec > 3 * e.baseline)
      .sort((a, b) => b.exec - a.exec)
      .slice(0, 5);
  }, [latency, analytics, feedStats]);

  return (
    <>
      <div style={{ padding: '18px 0 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <BigStat
            value={summary ? fmtInt(summary.total_iterations) : '—'}
            label="Iterations"
            sub={summary ? `#${summary.min_iteration_id} → #${summary.max_iteration_id}` : '—'}
          />
          <BigStat
            value={summary?.avg_cycle_seconds != null ? `~${summary.avg_cycle_seconds}s` : '—'}
            label="Cycle interval"
            sub="avg between polls"
          />
          <BigStat
            value={summary?.cache_hit_pct != null ? `${summary.cache_hit_pct}%` : '—'}
            label="Cache hit rate"
            sub="of executions"
            tone="signal"
          />
          <BigStat
            value={summary ? fmtInt(summary.slow_incidents) : '—'}
            label="Slow incidents"
            sub="≥3× baseline"
            tone={summary && summary.slow_incidents > 0 ? 'hot' : 'neutral'}
          />
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
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                {selectedFeed?.agency_name ?? '—'}
              </div>
            </div>
            <select
              value={selectedAgencyId ?? ''}
              onChange={(e) => setSelectedAgencyId(e.target.value || null)}
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
              {feedStats.length === 0 && <option value="">—</option>}
              {feedStats.map((f) => (
                <option key={f.agency_id} value={f.agency_id}>{f.agency_name}</option>
              ))}
            </select>
          </div>

          {agencyLatency.length > 0 ? (
            <Histogram data={agencyLatency} />
          ) : (
            <SkeletonBlock height={80} />
          )}

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
              avg <span style={{ color: 'var(--text)', fontWeight: 700 }}>{latencyStats ? `${latencyStats.avg}ms` : '—'}</span>
            </span>
            <span>
              p95 <span style={{ color: 'var(--text)', fontWeight: 700 }}>{latencyStats ? `${latencyStats.p95}ms` : '—'}</span>
            </span>
            <span>
              max <span style={{ color: 'var(--hot)', fontWeight: 700 }}>{latencyStats ? `${latencyStats.max}ms` : '—'}</span>
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <SectionLabel>Feed health</SectionLabel>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
            {summary ? `${summary.unique_feeds} distinct rt_feed URLs` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {analytics == null && (
            <>
              <SkeletonBlock height={88} />
              <SkeletonBlock height={88} />
            </>
          )}
          {feedStats.map((f) => (
            <FeedHealthCard key={f.agency_id} feed={f} />
          ))}
        </div>
      </div>

      <div style={{ padding: '18px 0 4px' }}>
        <SectionLabel>Recent slow events</SectionLabel>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slowEvents.length === 0 && (
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}
          >
            No slow events in the recent window.
          </div>
        )}
        {slowEvents.map((e, i) => (
          <SlowEventRow key={`${e.agency_id}-${e.iteration_id}-${i}`} feed={e.feed} exec={e.exec} baseline={e.baseline} />
        ))}
      </div>
    </>
  );
}

function BigStat({
  value, label, sub, tone = 'neutral',
}: { value: string; label: string; sub: string; tone?: 'neutral' | 'signal' | 'hot' | 'live' }) {
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
  const max = Math.max(1, ...data);
  return (
    <div style={{ position: 'relative', height: 80 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: '100%' }}>
        {data.map((v, i) => {
          const pct = (v / max) * 100;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(2, pct)}%`,
                background: pct > 60 ? 'var(--hot)' : pct > 38 ? 'var(--signal)' : 'var(--cool)',
                borderRadius: '1px 1px 0 0',
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FeedHealthCard({ feed }: { feed: FeedStat }) {
  const avgDl = feed.avg_download_ms ?? 0;
  const maxDl = feed.max_download_ms ?? 0;
  const ratio = maxDl > 0 && avgDl > 0
    ? Math.min(1, Math.log(maxDl / Math.max(avgDl, 1)) / Math.log(100))
    : 0;
  const anomaly = feed.slow_incidents > 0;
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
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{feed.agency_name}</span>
          {anomaly && <Tag tone="hot">Anomaly</Tag>}
        </div>
        <IconChevron size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <FeedMetric label="DL avg / max" avg={feed.avg_download_ms} max={feed.max_download_ms} />
        <FeedMetric label="Exec avg / max" avg={feed.avg_exec_ms} max={feed.max_exec_ms} />
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

function FeedMetric({ label, avg, max }: { label: string; avg: number | null; max: number | null }) {
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
          {avg ?? '—'}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>/</span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--hot)' }}>
          {max ?? '—'}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 500 }}>ms</span>
        </span>
      </div>
    </div>
  );
}

function SlowEventRow({ feed, exec, baseline }: { feed: string; exec: number; baseline: number }) {
  const mult = baseline > 0 ? Math.round(exec / baseline) : 0;
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
          baseline {baseline}ms
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
