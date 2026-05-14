import { useId } from 'react';

type Direction = 'left' | 'right';

type BusMarkProps = {
  size?: number;
  route?: string | number;
  pinned?: boolean;
  live?: boolean;
  dir?: Direction;
};

// Side-view bus illustration. Picks up --signal so it follows the accent.
// Used as the map marker and as decoration in cards/lists.
export function BusMark({ size = 38, route, pinned = false, live = false, dir = 'right' }: BusMarkProps) {
  const flip = dir === 'left' ? 'scale(-1, 1) translate(-60, 0)' : undefined;
  const id = useId().replace(/:/g, '');

  return (
    <svg width={size} height={size * (40 / 60)} viewBox="0 0 60 40" overflow="visible">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--signal-soft, var(--signal))" />
          <stop offset="100%" stopColor="var(--signal)" />
        </linearGradient>
      </defs>

      {live && (
        <circle
          cx="30"
          cy="22"
          r="26"
          fill="var(--signal)"
          opacity="0.22"
          style={{ animation: 'lmb-pulse 1.8s ease-in-out infinite' }}
        />
      )}

      <g transform={flip}>
        <ellipse cx="30" cy="38" rx="22" ry="2" fill="rgba(0,0,0,0.35)" />

        <rect
          x="3"
          y="6"
          width="50"
          height="24"
          rx="6"
          fill={`url(#${id}-body)`}
          stroke="var(--signal-ink)"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
        <rect x="48" y="9" width="9" height="18" rx="4" fill={`url(#${id}-body)`} />

        <rect x="6" y="9" width="40" height="9" rx="3" fill="var(--signal-ink)" fillOpacity="0.92" />
        <rect x="18" y="9" width="1.5" height="9" fill="var(--signal)" opacity="0.5" />
        <rect x="30" y="9" width="1.5" height="9" fill="var(--signal)" opacity="0.5" />

        <rect x="40" y="9" width="6" height="18" rx="1.5" fill="var(--signal-ink)" fillOpacity="0.18" />
        <rect x="42.4" y="11" width="1" height="14" fill="var(--signal-ink)" opacity="0.3" />

        {route != null && (
          <text
            x="22"
            y="26.5"
            textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace"
            fontSize="9"
            fontWeight="800"
            fill="var(--signal-ink)"
            letterSpacing="0.5"
          >
            {route}
          </text>
        )}

        <circle cx="55" cy="14" r="1.6" fill="#FFE9A8" />
        <circle cx="55" cy="14" r="0.7" fill="#FFF7E0" />

        <circle cx="14" cy="32" r="5" fill="#10131A" />
        <circle cx="14" cy="32" r="2.2" fill="var(--signal-ink)" opacity="0.7" />
        <circle cx="14" cy="32" r="1" fill="#10131A" />
        <circle cx="44" cy="32" r="5" fill="#10131A" />
        <circle cx="44" cy="32" r="2.2" fill="var(--signal-ink)" opacity="0.7" />
        <circle cx="44" cy="32" r="1" fill="#10131A" />
      </g>

      {pinned && (
        <circle cx="50" cy="6" r="5" fill="var(--signal-ink)" stroke="var(--signal)" strokeWidth="2" />
      )}
    </svg>
  );
}

// Larger illustration version used in marketing/landing surfaces.
export function BusHero({ size = 240, route = '24' }: { size?: number; route?: string }) {
  return (
    <svg width={size} height={size * (40 / 60)} viewBox="0 0 60 40">
      <BusMark route={route} />
    </svg>
  );
}

// Inline glyph for buttons/labels — uses currentColor.
export function BusIconG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="16" height="13" rx="3" fill="currentColor" />
      <rect x="18" y="6" width="3" height="9" rx="1.5" fill="currentColor" />
      <rect x="5" y="6" width="12" height="4" rx="1.2" fill="white" fillOpacity="0.85" />
      <circle cx="7" cy="19" r="2.2" fill="black" />
      <circle cx="15" cy="19" r="2.2" fill="black" />
      <circle cx="7" cy="19" r="0.8" fill="currentColor" />
      <circle cx="15" cy="19" r="0.8" fill="currentColor" />
    </svg>
  );
}
