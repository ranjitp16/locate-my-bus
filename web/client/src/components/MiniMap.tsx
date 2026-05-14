import { BusMark } from './BusGlyph';

type MiniMapProps = {
  width?: number | string;
  height?: number | string;
  showBuses?: boolean;
  showRoute?: boolean;
  animate?: boolean;
  busCount?: 1 | 2 | 3;
};

// Stylized SVG map tile used as decoration on Landing. Themed via CSS vars.
// The real interactive map (Azure Maps SDK) is wired up on the Map page.
export function MiniMap({
  width = '100%',
  height = '100%',
  showBuses = true,
  showRoute = true,
  animate = true,
  busCount = 3,
}: MiniMapProps) {
  const W = 390;
  const H = 600;

  const majors = [
    { d: 'M0 110 H390', w: 8 },
    { d: 'M0 340 H390', w: 10 },
    { d: 'M70 0 V600', w: 7 },
    { d: 'M240 0 V600', w: 8 },
  ];
  const minors = [
    'M0 60 H390', 'M0 180 H390', 'M0 250 H390', 'M0 280 H390', 'M0 410 H390', 'M0 470 H390', 'M0 535 H390',
    'M30 0 V600', 'M120 0 V600', 'M160 0 V600', 'M195 0 V600', 'M295 0 V600', 'M340 0 V600',
  ];
  const diag = [
    'M0 600 Q140 420 200 320 T390 100',
    'M0 200 Q120 240 240 280 T390 380',
  ];

  const water = 'M260 380 Q300 410 340 400 Q380 390 390 420 L390 540 Q360 555 320 540 Q280 530 260 510 Z';
  const park = 'M30 380 Q60 360 100 380 Q120 410 90 440 Q50 460 30 430 Z';
  const routePath = 'M40 140 Q120 130 180 180 Q230 230 220 320 Q210 410 130 430 Q70 440 50 380 Q40 320 80 290';

  const busOffsets = busCount === 1 ? [0.4] : busCount === 2 ? [0.25, 0.75] : [0.18, 0.5, 0.82];

  // Precomputed samples along the route path for bus placement.
  const samples: [number, number][] = [
    [40, 140], [70, 135], [105, 138], [140, 150], [170, 170],
    [195, 195], [215, 230], [225, 270], [222, 310], [218, 350],
    [212, 380], [195, 405], [165, 420], [130, 430], [95, 432],
    [70, 420], [55, 400], [50, 380], [55, 350], [70, 320],
  ];

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: 'var(--map-land)' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      >
        <rect x="0" y="0" width={W} height={H} fill="var(--map-land)" />
        <rect x="70" y="110" width="170" height="230" fill="var(--map-land-2)" opacity="0.5" />
        <rect x="240" y="0" width="150" height="110" fill="var(--map-land-2)" opacity="0.4" />

        <path d={park} fill="var(--map-park)" />
        <path d={water} fill="var(--map-water)" />

        {minors.map((d, i) => (
          <path key={`mn-${i}`} d={d} stroke="var(--map-road)" strokeWidth="2.5" fill="none" />
        ))}
        {diag.map((d, i) => (
          <path key={`dg-${i}`} d={d} stroke="var(--map-road)" strokeWidth="2.5" fill="none" />
        ))}
        {majors.map((m, i) => (
          <path key={`mj-${i}`} d={m.d} stroke="var(--map-road-mj)" strokeWidth={m.w} fill="none" />
        ))}

        <text x="170" y="50" fill="var(--map-label)" fontSize="9" fontWeight="600" letterSpacing="1">
          DOWNTOWN
        </text>
        <text x="50" y="500" fill="var(--map-label)" fontSize="8" fontWeight="500" letterSpacing="0.5">
          FAIRMOUNT
        </text>
        <text x="300" y="200" fill="var(--map-label)" fontSize="8" fontWeight="500" letterSpacing="0.5">
          NORTH END
        </text>

        {showRoute && (
          <>
            <path d={routePath} stroke="var(--signal)" strokeWidth="4.5" fill="none" strokeLinecap="round" opacity="0.25" />
            <path
              d={routePath}
              stroke="var(--signal)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="10 6"
              style={animate ? { animation: 'lmb-dash 2.4s linear infinite' } : undefined}
            />
          </>
        )}

        {showBuses &&
          busOffsets.map((t, i) => {
            const idx = Math.min(samples.length - 1, Math.floor(t * (samples.length - 1)));
            const next = samples[Math.min(samples.length - 1, idx + 1)];
            const [x, y] = samples[idx];
            const dir: 'left' | 'right' = next[0] >= x ? 'right' : 'left';
            return (
              <foreignObject key={i} x={x - 22} y={y - 16} width="44" height="32" overflow="visible">
                <div style={{ width: 44, height: 32, position: 'relative' }}>
                  <BusMark size={42} route="24" live={i === 0} dir={dir} />
                </div>
              </foreignObject>
            );
          })}
      </svg>
    </div>
  );
}
