import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../theme/ThemeProvider';
import { BusIconG } from './BusGlyph';
import { IconActivity, IconClose, IconFlag, IconHome, IconMenu } from './Icons';

// Hamburger trigger + slide-down drawer for mobile screens, since
// DesktopShell's top-nav isn't rendered on the mobile branch of pages.
// Drop next to BrandMark in the brand row to make Home / Live map /
// Agencies / Monitor reachable from anywhere.
export function MobileNavSheet() {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const close = () => setOpen(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        style={{
          width: 40,
          height: 36,
          borderRadius: 999,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <IconMenu size={18} />
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'color-mix(in oklab, var(--bg) 60%, transparent)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)',
              padding: '18px 20px 22px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  letterSpacing: 1.2,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Navigate
              </span>
              <button
                onClick={close}
                aria-label="Close menu"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  padding: 4,
                  display: 'flex',
                  cursor: 'pointer',
                }}
              >
                <IconClose size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <NavItem to="/" end onClose={close} icon={<IconHome size={16} />} label="Home" />
              <NavItem to="/view-map" onClose={close} icon={<BusIconG size={16} />} label="Live map" />
              <NavItem to="/dash/agencies" onClose={close} icon={<IconFlag size={16} />} label="Agencies" />
              <NavItem to="/dash/monitor" onClose={close} icon={<IconActivity size={16} />} label="Monitor" />
            </div>

            <button
              onClick={toggle}
              style={{
                marginTop: 14,
                padding: '11px 14px',
                borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {theme === 'dark' ? '☾ Dark theme' : '☀ Light theme'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function NavItem({
  to,
  end,
  onClose,
  icon,
  label,
}: {
  to: string;
  end?: boolean;
  onClose: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      style={({ isActive }) => ({
        padding: '12px 14px',
        borderRadius: 10,
        background: isActive ? 'var(--surface)' : 'transparent',
        border: '1px solid ' + (isActive ? 'var(--border-hi)' : 'transparent'),
        color: isActive ? 'var(--text)' : 'var(--text-soft)',
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      })}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
