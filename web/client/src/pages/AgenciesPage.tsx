import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIsDesktop } from '../lib/useMediaQuery';
import { DesktopShell } from '../components/DesktopShell';
import { Tag } from '../components/atoms';
import {
  IconActivity, IconArrowLeft, IconExternal, IconPlus, IconRefresh, IconTrash,
} from '../components/Icons';
import type { Agency } from '../lib/azureMaps';

const ACCESS_KEY_STORAGE = 'dash-access-key';

export default function AgenciesPage() {
  const isDesktop = useIsDesktop();

  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [accessKey, setAccessKey] = useState<string>(() =>
    typeof window === 'undefined' ? '' : window.sessionStorage.getItem(ACCESS_KEY_STORAGE) ?? ''
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/agencies');
      const data: Agency[] = await r.json();
      setAgencies(data);
    } catch (e) {
      console.error('agencies load failed', e);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (accessKey) window.sessionStorage.setItem(ACCESS_KEY_STORAGE, accessKey);
    else window.sessionStorage.removeItem(ACCESS_KEY_STORAGE);
  }, [accessKey]);

  const runAuthed = async (label: string, doFetch: () => Promise<Response>) => {
    if (!accessKey) {
      setError(`Enter the access key to ${label}.`);
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await doFetch();
      if (r.status === 401) {
        setAccessKey('');
        throw new Error('Access key rejected — re-enter it.');
      }
      if (!r.ok) throw new Error((await r.json()).error ?? `${label} failed (${r.status})`);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Remove this agency?')) return;
    const r = await runAuthed('delete this agency', () =>
      fetch(`/api/agencies/delete/${id}`, { method: 'DELETE', headers: { 'x-access-key': accessKey } })
    );
    if (r) await reload();
  };

  const onAdd = async (form: { rt: string; stat: string; key: string }) => {
    const r = await runAuthed('onboard an agency', () =>
      fetch('/api/agencies/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body: JSON.stringify({
          rt_feed_url: form.rt,
          static_feed_url: form.stat,
          api_key: form.key || undefined,
        }),
      })
    );
    if (r) await reload();
  };

  const onRestartDaemon = async () => {
    if (!window.confirm('Restart the daemon container?')) return;
    await runAuthed('restart the daemon', () =>
      fetch('/api/daemon/kill', { method: 'POST', headers: { 'x-access-key': accessKey } })
    );
  };

  const body = (
    <AgenciesBody
      agencies={agencies}
      accessKey={accessKey}
      setAccessKey={setAccessKey}
      error={error}
      busy={busy}
      onDelete={onDelete}
      onAdd={onAdd}
      onRestartDaemon={onRestartDaemon}
    />
  );

  if (isDesktop) {
    return (
      <DesktopShell
        rightSlot={
          <button
            onClick={onRestartDaemon}
            disabled={busy}
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--hot)',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <IconRefresh size={12} /> Restart daemon
          </button>
        }
      >
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 64px 80px' }}>{body}</div>
      </DesktopShell>
    );
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 0 80px' }}>
        <MobileHeader onRestart={onRestartDaemon} busy={busy} />
        <div style={{ padding: '0 18px' }}>{body}</div>
      </div>
    </div>
  );
}

// ── Inner content (shared across mobile + desktop) ─────────
function AgenciesBody(props: {
  agencies: Agency[];
  accessKey: string;
  setAccessKey: (v: string) => void;
  error: string | null;
  busy: boolean;
  onDelete: (id: string) => void;
  onAdd: (form: { rt: string; stat: string; key: string }) => void;
  onRestartDaemon: () => void;
}) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 14 }}>
        <StatMini value={String(props.agencies.length)} label="Agencies onboarded" />
      </div>

      <AccessKeyRow value={props.accessKey} onChange={props.setAccessKey} />

      {props.error && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--hot)',
            background: 'color-mix(in oklab, var(--hot) 8%, var(--surface))',
            color: 'var(--hot)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {props.error}
        </div>
      )}

      <SectionLabel>Existing agencies</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {props.agencies.length === 0 && (
          <div
            className="mono"
            style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}
          >
            No agencies yet.
          </div>
        )}
        {props.agencies.map((a) => (
          <AgencyCard key={a.id} agency={a} onDelete={() => props.onDelete(a.id)} disabled={props.busy} />
        ))}
      </div>

      <SectionLabel>Add a new agency</SectionLabel>
      <AddAgencyForm onSubmit={props.onAdd} busy={props.busy} />
    </>
  );
}

// ── Mobile header (replicates AppHeader from design) ───────
function MobileHeader({ onRestart, busy }: { onRestart: () => void; busy: boolean }) {
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
        MANAGE<span style={{ color: 'var(--text-muted)' }}>.</span>AGENCIES
      </span>
      <button
        onClick={onRestart}
        disabled={busy}
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--hot)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: busy ? 0.5 : 1,
        }}
      >
        <IconRefresh size={11} />
        Restart
      </button>
      <Link
        to="/dash/monitor"
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          background: 'transparent',
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
          textDecoration: 'none',
        }}
      >
        <IconActivity size={11} />
        Monitor
      </Link>
    </div>
  );
}

// ── Atoms ──────────────────────────────────────────────────
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
        margin: '20px 0 10px',
      }}
    >
      {children}
    </div>
  );
}

function StatMini({ value, label, tone = 'neutral' }: { value: string; label: string; tone?: 'neutral' | 'signal' | 'live' }) {
  const color = tone === 'signal' ? 'var(--signal)' : tone === 'live' ? 'var(--live)' : 'var(--text)';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="mono" style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, letterSpacing: -0.5 }}>
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text-muted)',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function AccessKeyRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Access key
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Required for changes"
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
        }}
      />
    </div>
  );
}

function AgencyCard({ agency, onDelete, disabled }: { agency: Agency; onDelete: () => void; disabled: boolean }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {agency.name}
            {agency.url && (
              <a
                href={agency.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
              >
                <IconExternal size={12} />
              </a>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            {agency.timezone ?? '—'} · {agency.language ?? '—'} · {agency.phone ?? '—'}
          </div>
        </div>
        <Tag tone="live">Live</Tag>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--border)',
        }}
      >
        <InlineStat value="—" label="Routes" />
        <InlineStat value="15s" label="Polling" />
        <InlineStat value="0%" label="Errors" />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onDelete}
          disabled={disabled}
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            background: 'transparent',
            border: '1px solid var(--hot)',
            color: 'var(--hot)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <IconTrash size={11} />
          Remove
        </button>
      </div>
    </div>
  );
}

function InlineStat({ value, label, tone = 'neutral' }: { value: string; label: string; tone?: 'neutral' | 'hot' | 'live' }) {
  const color = tone === 'hot' ? 'var(--hot)' : tone === 'live' ? 'var(--live)' : 'var(--text)';
  return (
    <div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
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

function AddAgencyForm({ onSubmit, busy }: { onSubmit: (f: { rt: string; stat: string; key: string }) => void; busy: boolean }) {
  const [rt, setRt] = useState('');
  const [stat, setStat] = useState('');
  const [key, setKey] = useState('');
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px dashed var(--border-hi)',
        background: 'var(--surface)',
        padding: 16,
      }}
    >
      <FormField label="Realtime feed URL" placeholder="https://…/VehiclePositions.pb" required value={rt} onChange={setRt} />
      <FormField label="Static feed URL" placeholder="https://…/gtfs.zip" required value={stat} onChange={setStat} />
      <FormField label="API key" placeholder="Optional" mono value={key} onChange={setKey} />

      <button
        onClick={() => {
          if (!rt || !stat) return;
          onSubmit({ rt, stat, key });
        }}
        disabled={busy || !rt || !stat}
        style={{
          marginTop: 6,
          width: '100%',
          padding: '13px 16px',
          borderRadius: 12,
          background: 'var(--signal)',
          color: 'var(--signal-ink)',
          border: 'none',
          fontFamily: 'var(--font-mono)',
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: busy || !rt || !stat ? 0.5 : 1,
        }}
      >
        <IconPlus size={14} stroke={2.5} />
        Onboard agency
      </button>
      <div
        className="mono"
        style={{
          marginTop: 10,
          fontSize: 10,
          color: 'var(--text-muted)',
          textAlign: 'center',
          letterSpacing: 0.3,
        }}
      >
        GTFS static will parse · daemon picks up RT in &lt;15s
      </div>
    </div>
  );
}

function FormField({
  label,
  placeholder,
  required = false,
  mono = false,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  required?: boolean;
  mono?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label} {required && <span style={{ color: 'var(--hot)' }}>*</span>}
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '11px 12px',
          background: 'var(--bg)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 13,
          outline: 'none',
        }}
      />
    </div>
  );
}
