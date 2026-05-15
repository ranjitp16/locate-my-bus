import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconClose } from './Icons';

const SHOW_DELAY_MS = 700;
const AUTO_DISMISS_MS = 12_000;
const EXIT_ANIM_MS = 220;

export function PreferencesBanner() {
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  // Once the user hovers or tabs into the banner, cancel auto-dismiss so we
  // don't yank focus or hide the notice mid-read. The X button remains.
  const [engaged, setEngaged] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const dismissingRef = useRef(false);

  useEffect(() => {
    const showId = window.setTimeout(() => {
      setVisible(true);
      // rAF needed to escape React 18's automatic batching, otherwise
      // `setVisible(true)` and `setAnimateIn(true)` collapse into one render
      // and the slide-up transition has no "from" state to animate from.
      window.requestAnimationFrame(() => setAnimateIn(true));
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(showId);
  }, []);

  useEffect(() => {
    if (!visible || engaged) return;
    const hideId = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(hideId);
  }, [visible, engaged]);

  useEffect(() => () => {
    if (exitTimerRef.current != null) window.clearTimeout(exitTimerRef.current);
  }, []);

  function dismiss() {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setAnimateIn(false);
    exitTimerRef.current = window.setTimeout(() => setVisible(false), EXIT_ANIM_MS);
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        padding: '0 16px 16px',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        onMouseEnter={() => setEngaged(true)}
        onFocus={() => setEngaged(true)}
        style={{
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: 640,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-hi)',
          borderRadius: 14,
          padding: '12px 14px 12px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          boxShadow: '0 18px 40px rgba(0,0,0,0.32)',
          fontFamily: 'var(--font-sans)',
          transform: animateIn ? 'translateY(0)' : 'translateY(120%)',
          opacity: animateIn ? 1 : 0,
          transition: 'transform 320ms cubic-bezier(.2,.7,.2,1), opacity 220ms ease',
        }}
      >
        <span
          aria-hidden="true"
          className="mono"
          style={{
            flexShrink: 0,
            marginTop: 2,
            padding: '3px 7px',
            borderRadius: 999,
            background: 'var(--signal-tint)',
            color: 'var(--signal-soft)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
        >
          FYI
        </span>

        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-soft)',
            flex: 1,
          }}
        >
          Heads up — this site keeps a few UI preferences in your browser
          (theme, last route, etc.) and uses Google Analytics for anonymous page
          counts. No accounts, no ads.{' '}
          <Link
            to="/about"
            style={{ color: 'var(--signal)', textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            Details
          </Link>
          . If you'd rather not, please leave the site.
        </p>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss notice"
          onFocus={(e) => {
            e.currentTarget.style.outline = '2px solid var(--signal)';
            e.currentTarget.style.outlineOffset = '2px';
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none';
          }}
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            padding: 6,
            margin: '-2px -4px 0 0',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: 8,
            display: 'inline-flex',
          }}
        >
          <IconClose size={14} />
        </button>
      </div>
    </div>
  );
}
