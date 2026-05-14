import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../theme/ThemeProvider';
import { BrandMark } from './BrandMark';
import { BusIconG } from './BusGlyph';
import { IconHome } from './Icons';
import { Tag } from './atoms';

type DesktopNavProps = {
  rightSlot?: ReactNode;
};

function NavTab({
  to,
  children,
  badge,
  end,
}: {
  to: string;
  children: ReactNode;
  badge?: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        padding: '8px 14px',
        borderRadius: 999,
        background: isActive ? 'var(--surface)' : 'transparent',
        border: '1px solid ' + (isActive ? 'var(--border-hi)' : 'transparent'),
        color: isActive ? 'var(--text)' : 'var(--text-soft)',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
      })}
    >
      {children}
      {badge && <Tag tone="live">{badge}</Tag>}
    </NavLink>
  );
}

export function DesktopNav({ rightSlot }: DesktopNavProps) {
  const { theme, toggle } = useTheme();
  return (
    <div
      style={{
        height: 68,
        padding: '0 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in oklab, var(--bg) 85%, transparent)',
        backdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <BrandMark />
        <div style={{ display: 'flex', gap: 4 }}>
          <NavTab to="/" end>
            <IconHome size={14} />
            Home
          </NavTab>
          <NavTab to="/view-map">
            <BusIconG size={14} />
            Live map
          </NavTab>
          <NavTab to="/dash/agencies">Agencies</NavTab>
          <NavTab to="/dash/monitor">Monitor</NavTab>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {rightSlot}
        <button
          onClick={toggle}
          style={{
            padding: '7px 12px',
            borderRadius: 999,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {theme === 'dark' ? '☾' : '☀'} {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>
    </div>
  );
}

// Wraps a page with the desktop nav at the top and lets children fill the rest.
export function DesktopShell({ children, rightSlot }: { children: ReactNode; rightSlot?: ReactNode }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <DesktopNav rightSlot={rightSlot} />
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
