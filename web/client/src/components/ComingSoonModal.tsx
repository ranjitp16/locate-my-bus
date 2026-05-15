import { useEffect } from 'react';
import { IconClose } from './Icons';

export function ComingSoonModal({
  open,
  onClose,
  title = 'Coming soon',
  message,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coming-soon-title"
      aria-describedby="coming-soon-desc"
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
          maxWidth: 380,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-hi)',
          borderRadius: 18,
          padding: '28px 24px 22px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <button
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

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 14,
            fontSize: 32,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          🚧
        </div>

        <h2
          id="coming-soon-title"
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
          {title}
        </h2>

        <p
          id="coming-soon-desc"
          style={{
            margin: '0 0 22px',
            color: 'var(--text-soft)',
            fontSize: 14.5,
            lineHeight: 1.55,
            textAlign: 'center',
          }}
        >
          {message}
        </p>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            background: 'var(--signal)',
            color: 'var(--signal-ink)',
            border: 'none',
            borderRadius: 12,
            padding: '12px 14px',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
