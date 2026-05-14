import type { CSSProperties, ReactNode, MouseEventHandler } from 'react';

// ── FAB ──────────────────────────────────────────────────────
type FabProps = {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
  kind?: 'surface' | 'signal';
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function FAB({ children, size = 48, style, kind = 'surface', onClick }: FabProps) {
  const colors =
    kind === 'signal'
      ? { bg: 'var(--signal)', fg: 'var(--signal-ink)' }
      : { bg: 'var(--surface)', fg: 'var(--text)' };
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colors.bg,
        color: colors.fg,
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── LiveDot ──────────────────────────────────────────────────
export function LiveDot({ size = 8, label }: { size?: number; label?: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: 'var(--live)',
      }}
    >
      <span
        className="lmb-pulse"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--live)',
          boxShadow: '0 0 0 3px color-mix(in oklab, var(--live) 25%, transparent)',
        }}
      />
      {label}
    </span>
  );
}

// ── Tag ──────────────────────────────────────────────────────
export type TagTone = 'neutral' | 'signal' | 'live' | 'hot';

const TAG_TONES: Record<TagTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'var(--surface-alt)', fg: 'var(--text-soft)', border: 'var(--border)' },
  signal: {
    bg: 'color-mix(in oklab, var(--signal) 18%, transparent)',
    fg: 'var(--signal)',
    border: 'color-mix(in oklab, var(--signal) 35%, transparent)',
  },
  live: {
    bg: 'color-mix(in oklab, var(--live) 18%, transparent)',
    fg: 'var(--live)',
    border: 'color-mix(in oklab, var(--live) 35%, transparent)',
  },
  hot: {
    bg: 'color-mix(in oklab, var(--hot) 18%, transparent)',
    fg: 'var(--hot)',
    border: 'color-mix(in oklab, var(--hot) 35%, transparent)',
  },
};

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: TagTone }) {
  const c = TAG_TONES[tone];
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ── BrandMark ────────────────────────────────────────────────
// Imported lazily by callers that also need BusIconG.
