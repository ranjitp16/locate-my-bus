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
//
// Route geometry follows the road grid (only travels along the major/minor
// stroke lines below), so the route line lies *on* roads instead of cutting
// across blocks. Buses are placed at exact points along that polyline.
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

  // Bus route: each vertex sits on a road; segments are pure H or V so the
  // line visibly hugs the grid. Endpoints extend past the viewBox so the
  // route reads as a section of a longer trip (not something that abruptly
  // ends mid-card).
  const routeVertices: [number, number][] = [
    [-40, 110],
    [195, 110],
    [195, 410],
    [430, 410],
  ];
  const routePath =
    'M' + routeVertices.map(([x, y]) => `${x} ${y}`).join(' L');

  // Hardcoded bus positions + heading on the route. Heading is degrees where
  // 0=north, 90=east, 180=south, 270=west. The bus glyph faces east by
  // default, so we rotate by (angle − 90) when painting. All three positions
  // sit inside the visible slice of the viewBox at both card aspect ratios.
  const allBuses: { x: number; y: number; angle: number }[] = [
    { x: 195, y: 300, angle: 180 },  // live, on the vertical segment heading south
    { x: 195, y: 200, angle: 0 },    // upper, on the vertical segment heading north
    { x: 295, y: 410, angle: 90 },   // lower right, on the horizontal segment heading east
  ];
  const buses = allBuses.slice(0, busCount).map((b, i) => ({ ...b, key: i }));

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: 'var(--map-land)' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      >
        <rect x="0" y="0" width={W} height={H} fill="var(--map-land)" />

        {minors.map((d, i) => (
          <path key={`mn-${i}`} d={d} stroke="var(--map-road)" strokeWidth="2.5" fill="none" />
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
          <path
            d={routePath}
            stroke="var(--signal)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="10 6"
            style={animate ? { animation: 'lmb-dash 2.4s linear infinite' } : undefined}
          />
        )}

        {showBuses && buses.length > 0 && (
          <circle
            cx={buses[0].x}
            cy={buses[0].y}
            r={26}
            fill="color-mix(in oklab, var(--signal) 32%, transparent)"
          />
        )}

        {showBuses &&
          buses.map((b) => (
            <foreignObject key={b.key} x={b.x - 22} y={b.y - 16} width="44" height="32" overflow="visible">
              <div style={{ width: 44, height: 32, position: 'relative' }}>
                <BusMark size={42} route="24" bearing={b.angle} />
              </div>
            </foreignObject>
          ))}
      </svg>
    </div>
  );
}
