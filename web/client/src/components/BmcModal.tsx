import { useEffect, useRef } from 'react';
import { IconClose } from './Icons';

const BMC_YELLOW = '#FFDD00';
const BMC_BLACK = '#0D0C22';
const BMC_LOGO_SRC = 'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png';

export function BmcModal({
  open,
  onClose,
  bmcUrl,
}: {
  open: boolean;
  onClose: () => void;
  bmcUrl: string;
}) {
  const supportRef = useRef<HTMLAnchorElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => supportRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
      lastFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bmc-title"
      aria-describedby="bmc-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 400,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-hi)',
          borderRadius: 18,
          padding: '28px 24px 22px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            padding: 6,
            display: 'flex',
            cursor: 'pointer',
            borderRadius: 8,
          }}
        >
          <IconClose size={16} />
        </button>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div
            style={{
              padding: 6,
              background: '#FFFFFF',
              border: '2px solid #FFFFFF',
              borderRadius: 999,
              boxShadow: '0 6px 18px rgba(13,12,34,0.25)',
              display: 'inline-flex',
              lineHeight: 0,
            }}
          >
            <img
              src={BMC_LOGO_SRC}
              alt=""
              aria-hidden="true"
              width={120}
              height={33}
              style={{ display: 'block', borderRadius: 999 }}
            />
          </div>
        </div>

        <h2
          id="bmc-title"
          style={{
            margin: '0 0 8px',
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text)',
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          Enjoying Locate My Bus?
        </h2>

        <p
          id="bmc-desc"
          style={{
            margin: '0 0 22px',
            color: 'var(--text-soft)',
            fontSize: 14.5,
            lineHeight: 1.55,
            textAlign: 'center',
          }}
        >
          If this app's been useful and you'd like to support what I do, you can buy
          me a coffee. Or don't — it's free to use either way. Cheers!
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              background: 'var(--surface-alt)',
              color: 'var(--text-soft)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '12px 14px',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Maybe later
          </button>
          <a
            ref={supportRef}
            href={bmcUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            style={{
              flex: 1.4,
              background: BMC_YELLOW,
              color: BMC_BLACK,
              border: `1px solid ${BMC_BLACK}`,
              borderRadius: 12,
              padding: '12px 14px',
              fontWeight: 700,
              fontSize: 14,
              textAlign: 'center',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = BMC_BLACK;
              (e.currentTarget as HTMLAnchorElement).style.color = BMC_YELLOW;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = BMC_YELLOW;
              (e.currentTarget as HTMLAnchorElement).style.color = BMC_BLACK;
            }}
          >
            <span aria-hidden="true">☕</span> Buy me a coffee
          </a>
        </div>
      </div>
    </div>
  );
}
