import { Link } from 'react-router-dom';
import { BusIconG } from './BusGlyph';

export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const isMd = size === 'md';
  const tileW = isMd ? 36 : 30;
  const tileH = isMd ? 26 : 22;
  const fontSize = isMd ? 13 : 12;
  return (
    <Link
      to="/"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        textDecoration: 'none',
      }}
    >
      <div
        style={{
          width: tileW,
          height: tileH,
          borderRadius: 6,
          background: 'var(--signal)',
          color: 'var(--signal-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <BusIconG size={isMd ? 16 : 14} />
      </div>
      <div
        className="mono"
        style={{
          fontWeight: 800,
          fontSize,
          letterSpacing: 0.6,
          color: 'var(--text)',
        }}
      >
        LOCATE<span style={{ color: 'var(--text-muted)' }}>.</span>MY
        <span style={{ color: 'var(--text-muted)' }}>.</span>BUS
      </div>
    </Link>
  );
}
