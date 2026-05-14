// String-template version of BusMark for use as raw SVG markup
// (e.g. as content of Azure Maps' atlas.HtmlMarker), so the map
// page doesn't need to pull in react-dom/server.
// Keep the markup in sync with components/BusGlyph.tsx :: BusMark.
let _id = 0;

export function busMarkSvgString(opts: {
  size?: number;
  route?: string | number;
  pinned?: boolean;
  live?: boolean;
  dir?: 'left' | 'right';
}): string {
  const { size = 38, route, pinned = false, live = false, dir = 'right' } = opts;
  const flip = dir === 'left' ? `transform="scale(-1, 1) translate(-60, 0)"` : '';
  const id = `bm-s-${++_id}`;
  const w = size;
  const h = size * (40 / 60);

  return `
<svg width="${w}" height="${h}" viewBox="0 0 60 40" overflow="visible">
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--signal-soft, var(--signal))"/>
      <stop offset="100%" stop-color="var(--signal)"/>
    </linearGradient>
  </defs>
  ${live ? `<circle cx="30" cy="22" r="26" fill="var(--signal)" opacity="0.22" style="animation: lmb-pulse 1.8s ease-in-out infinite"/>` : ''}
  <g ${flip}>
    <ellipse cx="30" cy="38" rx="22" ry="2" fill="rgba(0,0,0,0.35)"/>
    <rect x="3" y="6" width="50" height="24" rx="6" fill="url(#${id}-body)" stroke="var(--signal-ink)" stroke-opacity="0.18" stroke-width="1"/>
    <rect x="48" y="9" width="9" height="18" rx="4" fill="url(#${id}-body)"/>
    <rect x="6" y="9" width="40" height="9" rx="3" fill="var(--signal-ink)" fill-opacity="0.92"/>
    <rect x="18" y="9" width="1.5" height="9" fill="var(--signal)" opacity="0.5"/>
    <rect x="30" y="9" width="1.5" height="9" fill="var(--signal)" opacity="0.5"/>
    <rect x="40" y="9" width="6" height="18" rx="1.5" fill="var(--signal-ink)" fill-opacity="0.18"/>
    <rect x="42.4" y="11" width="1" height="14" fill="var(--signal-ink)" opacity="0.3"/>
    ${route != null ? `<text x="22" y="26.5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="800" fill="var(--signal-ink)" letter-spacing="0.5">${route}</text>` : ''}
    <circle cx="55" cy="14" r="1.6" fill="#FFE9A8"/>
    <circle cx="55" cy="14" r="0.7" fill="#FFF7E0"/>
    <circle cx="14" cy="32" r="5" fill="#10131A"/>
    <circle cx="14" cy="32" r="2.2" fill="var(--signal-ink)" opacity="0.7"/>
    <circle cx="14" cy="32" r="1" fill="#10131A"/>
    <circle cx="44" cy="32" r="5" fill="#10131A"/>
    <circle cx="44" cy="32" r="2.2" fill="var(--signal-ink)" opacity="0.7"/>
    <circle cx="44" cy="32" r="1" fill="#10131A"/>
  </g>
  ${pinned ? `<circle cx="50" cy="6" r="5" fill="var(--signal-ink)" stroke="var(--signal)" stroke-width="2"/>` : ''}
</svg>`.trim();
}
