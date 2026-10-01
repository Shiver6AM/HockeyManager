/**
 * Team logos, drawn as SVG in each team's colors (all original designs).
 *
 * Every franchise gets its own identity rather than a shared template, the way
 * a real league's marks grew up one at a time. The principles borrowed from
 * pro hockey branding:
 *  - one strong idea per mark, readable as a silhouette and in one color;
 *  - a dark keyline around everything, so marks hold up on ice white and on
 *    dark jerseys alike;
 *  - a mix of forms: free-standing marks (an animal or object with no
 *    container), roundels and crests that carry the city name, letter
 *    monograms with a symbol built into the letter, and wordmark-led logos;
 *  - forward lean and diagonals for speed; containers broken by the subject
 *    for energy; heraldic shapes only where the name calls for tradition;
 *  - a simplified secondary mark (no small type) for tables and chips.
 * Names in the artwork come from the team, so a renamed team's logo follows.
 * Teams without a designed mark (added later) get a monogram roundel.
 */
import { useId, type ReactNode } from 'react';

export interface LogoTeam {
  abbr: string;
  city: string;
  name: string;
  colors: string[];
}

/** Drawing context: the team's colors, plus a unique id prefix for gradients and text paths. */
interface Ctx {
  /** Primary color. */
  p: string;
  /** Secondary color. */
  s: string;
  t: LogoTeam;
  id: string;
}
type Draw = (c: Ctx) => ReactNode;
interface Mark {
  /** The primary mark (wordmarks and small type included). */
  full: Draw;
  /** A simpler version for small sizes (left out: the full mark is simple enough). */
  small?: Draw;
}

const KEY = '#0e1116';
const WHITE = '#f6f8fb';
const STEEL = '#c3ccd6';
const DARK_STEEL = '#7f8b98';

const OSWALD = 'Oswald, Inter, sans-serif';
const SLAB = "'Alfa Slab One', Oswald, Georgia, serif";
const SCRIPT = "Yellowtail, 'Brush Script MT', cursive";
const SERIF = "Cinzel, 'Trajan Pro', Georgia, serif";

/** A filled path with a dark keyline drawn behind it. */
function K({ d, fill, w = 4, ...rest }: { d: string; fill: string; w?: number; transform?: string; opacity?: number }) {
  return <path d={d} fill={fill} stroke={KEY} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" paintOrder="stroke" {...rest} />;
}
/** A stroke-only line with a keyline around it. */
function L({ d, color, w = 4, k = 3.5 }: { d: string; color: string; w?: number; k?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={KEY} strokeWidth={w + k} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}
/** Text with a keyline. */
function T({
  x = 50,
  y,
  size,
  font = OSWALD,
  fill = WHITE,
  w = 3,
  weight = 700,
  ls = 0,
  width,
  children,
  anchor = 'middle',
  skew,
  stroke = KEY,
}: {
  x?: number;
  y: number;
  size: number;
  font?: string;
  fill?: string;
  w?: number;
  weight?: number;
  ls?: number;
  width?: number;
  children: ReactNode;
  anchor?: 'start' | 'middle' | 'end';
  skew?: number;
  stroke?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily={font}
      fontWeight={weight}
      fontSize={size}
      letterSpacing={ls}
      fill={fill}
      stroke={stroke}
      strokeWidth={w}
      strokeLinejoin="round"
      paintOrder="stroke"
      {...(width ? { textLength: width, lengthAdjust: 'spacingAndGlyphs' } : {})}
      {...(skew ? { transform: `skewX(${skew})`, style: { transformBox: 'fill-box', transformOrigin: 'center' } as React.CSSProperties } : {})}
    >
      {children}
    </text>
  );
}
/** Text set around a circle: over the top (reading left to right) or along the bottom. */
function Arc({
  id,
  r,
  cx = 50,
  cy = 50,
  text,
  bottom,
  size,
  fill = WHITE,
  font = OSWALD,
  ls = 1,
  w = 0,
}: {
  id: string;
  r: number;
  cx?: number;
  cy?: number;
  text: string;
  bottom?: boolean;
  size: number;
  fill?: string;
  font?: string;
  ls?: number;
  w?: number;
}) {
  // (Bottom text sits on a slightly larger arc so its baseline lines up with the top text's.)
  const rr = bottom ? r + size * 0.72 : r;
  const d = bottom ? `M${cx - rr} ${cy}A${rr} ${rr} 0 0 0 ${cx + rr} ${cy}` : `M${cx - rr} ${cy}A${rr} ${rr} 0 0 1 ${cx + rr} ${cy}`;
  return (
    <>
      <path id={id} d={d} fill="none" />
      <text
        fontFamily={font}
        fontWeight={700}
        fontSize={size}
        letterSpacing={ls}
        fill={fill}
        {...(w ? { stroke: KEY, strokeWidth: w, paintOrder: 'stroke', strokeLinejoin: 'round' as const } : {})}
      >
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {text}
        </textPath>
      </text>
    </>
  );
}

function star(cx: number, cy: number, R: number, r: number, n = 5, rot = -90) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = ((rot + (i * 180) / n) * Math.PI) / 180;
    const d = i % 2 ? r : R;
    pts.push(`${(cx + d * Math.cos(rad)).toFixed(2)},${(cy + d * Math.sin(rad)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
/** A toothed ring (saw blade, gear). */
function teeth(cx: number, cy: number, R: number, r: number, n: number, hook = 0) {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5 + hook) / n) * Math.PI * 2;
    const a2 = ((i + 1) / n) * Math.PI * 2;
    pts.push(`${(cx + r * Math.cos(a0)).toFixed(2)},${(cy + r * Math.sin(a0)).toFixed(2)}`);
    pts.push(`${(cx + R * Math.cos(a1)).toFixed(2)},${(cy + R * Math.sin(a1)).toFixed(2)}`);
    pts.push(`${(cx + r * Math.cos(a2)).toFixed(2)},${(cy + r * Math.sin(a2)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
/** Mirror around x = 50. */
const MIRROR = 'translate(100 0) scale(-1 1)';
const up = (s: string) => s.toUpperCase();

// ===========================================================================
// East: Maritime division
// ===========================================================================

const MARKS: Record<string, Mark> = {
  // Halifax Tidewater: a free-standing breaking wave under a harbour moon. No container, no type.
  HAL: {
    full: (c) => (
      <>
        <K d={circle(62, 38, 24)} fill={c.s} />
        <K d="M6 80C10 52 30 26 60 23c18-2 32 9 33 24 1 11-7 18-16 17-8-1-12-8-9-14 2-5 9-6 12-2 0-8-8-14-19-13-21 2-34 24-36 45z" fill={c.p} />
        <path d="M24 56c8-18 20-26 36-27 10-1 19 3 24 10" fill="none" stroke={WHITE} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M72 50c2-3 6-3 7 0" fill="none" stroke={WHITE} strokeWidth="2.4" strokeLinecap="round" />
        <K d="M4 84c10-6 20-6 30 0s20 6 30 0 20-6 32 0v8c-12-6-22-6-32 0s-20 6-30 0-20-6-30 0z" fill={c.s} w={3.5} />
        <circle cx="84" cy="20" r="2.2" fill={WHITE} stroke={KEY} strokeWidth="1.2" />
        <circle cx="90" cy="28" r="1.6" fill={WHITE} stroke={KEY} strokeWidth="1" />
      </>
    ),
  },

  // Quebec Harfangs: a classic roundel: city over the top, name below, a snowy owl at the centre.
  QUE: {
    full: (c) => (
      <>
        <K d={circle(50, 50, 46)} fill={c.p} w={3.5} />
        <path d={circle(50, 50, 33)} fill={c.s} stroke={KEY} strokeWidth="2.5" />
        <path d={circle(50, 50, 44)} fill="none" stroke={c.s} strokeWidth="1.2" />
        <Arc id={`${c.id}-t`} r={37.5} text={up(c.t.city === 'Quebec' ? 'Québec' : c.t.city)} size={10} ls={2.5} />
        <Arc id={`${c.id}-b`} r={37.5} text={up(c.t.name)} size={8.5} ls={1.5} bottom />
        <path d={star(12.5, 50, 3.2, 1.3)} fill={WHITE} />
        <path d={star(87.5, 50, 3.2, 1.3)} fill={WHITE} />
        <g transform="translate(50 52) scale(0.66) translate(-50 -46)">
          <Owl />
        </g>
      </>
    ),
    small: (c) => (
      <>
        <K d={circle(50, 50, 46)} fill={c.p} w={3.5} />
        <path d={circle(50, 50, 38)} fill={c.s} stroke={KEY} strokeWidth="2.5" />
        <g transform="translate(50 52) scale(0.8) translate(-50 -46)">
          <Owl />
        </g>
      </>
    ),
  },

  // Moncton Wildcats: a letter monogram: a heavy W torn by three claw marks.
  MON: {
    full: (c) => (
      <>
        <K d="M4 20h24l7 32 8-32h14l8 32 7-32h24L80 82H61l-11-30-11 30H20z" fill={c.p} w={5} />
        <path d="M8 22h18l7 32 8-32" fill="none" stroke={WHITE} strokeWidth="1.4" opacity="0.5" />
        {[0, 13, 26].map((dx) => (
          <path key={dx} d={`M${64 + dx} 6c2 0 3 1 2 3L${36 + dx} 92c-1 2-3 2-4 0z`} fill={c.s} stroke={KEY} strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" transform="translate(-12 0)" />
        ))}
      </>
    ),
  },

  // Kingston Frontenacs: tradition: a heater shield, the city in its chief, the old fort's keep below.
  KGN: {
    full: (c) => (
      <>
        <K d="M10 8h80v40c0 25-17 40-40 48C27 88 10 73 10 48z" fill={c.p} w={4} />
        <path d="M14 12h72v20H14z" fill={c.s} stroke={KEY} strokeWidth="2" />
        <T y={27} size={12} ls={1.5} w={2.2} width={64}>
          {up(c.t.city)}
        </T>
        <g transform="translate(50 62) scale(0.78) translate(-50 -48)">
          <Keep flag={c.s} />
        </g>
        <path d="M14 32h72" stroke={WHITE} strokeWidth="1.2" opacity="0.6" />
      </>
    ),
    small: (c) => (
      <>
        <K d="M10 8h80v40c0 25-17 40-40 48C27 88 10 73 10 48z" fill={c.p} w={4} />
        <path d="M14 12h72v14H14z" fill={c.s} />
        <g transform="translate(50 58) scale(0.9) translate(-50 -48)">
          <Keep flag={c.s} />
        </g>
      </>
    ),
  },

  // London Knights: a free-standing great helm in profile, the plume streaming back.
  LDN: {
    full: (c) => (
      <>
        <K d="M46 22C42 8 22 4 8 12c10 0 18 4 22 10C20 18 10 22 6 30c10-4 22-4 32 2C30 30 22 34 20 42c10-6 22-8 28-4z" fill={c.s} w={3.5} />
        <K d="M30 86V52c0-20 12-32 28-32 14 0 24 10 25 24l9 6-9 4v8l7 4-7 4v16z" fill={c.p} w={4} />
        <path d="M60 22c-8 4-12 14-12 28v36" fill="none" stroke={WHITE} strokeWidth="2" opacity="0.35" />
        <path d="M58 45h33" stroke={KEY} strokeWidth="4.5" strokeLinecap="round" />
        <path d="M72 62h4M72 68h4M66 62h3M66 68h3" stroke={KEY} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M30 78h53" stroke={c.s} strokeWidth="4" />
        <path d="M30 78h53" stroke={KEY} strokeWidth="1.2" />
        <circle cx="40" cy="78" r="1.6" fill={KEY} />
        <circle cx="52" cy="78" r="1.6" fill={KEY} />
        <circle cx="64" cy="78" r="1.6" fill={KEY} />
      </>
    ),
  },

  // Hamilton Forge: wordmark-led: FORGE arched in slab letters over an anvil throwing sparks.
  HAM: {
    full: (c) => (
      <>
        <K d="M14 58h52c0 6 7 9 20 9v5H64l-7 7h8v9H31v-9h8l-7-7h-8c-6 0-10-6-10-14z" fill={c.p} w={4} />
        <path d="M18 62h45" stroke={WHITE} strokeWidth="1.4" opacity="0.45" />
        {[
          [44, 54, 30, 40],
          [48, 52, 50, 36],
          [52, 54, 68, 42],
        ].map(([x1, y1, x2, y2], i) => (
          <L key={i} d={`M${x1} ${y1}L${x2} ${y2}`} color={c.s} w={2.2} k={2.5} />
        ))}
        <Arc id={`${c.id}-w`} r={34} cy={52} text={up(c.t.name)} size={20} font={SLAB} fill={c.s} ls={1} w={3.5} />
      </>
    ),
    small: (c) => (
      <>
        <K d="M8 46h56c0 8 8 12 26 12v6H64l-8 9h10v12H30V73h10l-8-9H20C12 64 8 56 8 46z" fill={c.p} w={4.5} />
        <L d="M44 40L30 18" color={c.s} w={3.5} k={3} />
        <L d="M50 38V12" color={c.s} w={3.5} k={3} />
        <L d="M56 40L72 20" color={c.s} w={3.5} k={3} />
      </>
    ),
  },

  // Rochester Americans: a monogram: a tall A in stripes, a star where the crossbar should be.
  ROC: {
    full: (c) => (
      <>
        <K d="M40 8h20l32 84H70l-6-18H36l-6 18H8z" fill={c.s} w={4.5} />
        <path d="M44 14h12l26 72h-8L50 22 26 86h-8z" fill={WHITE} opacity="0.9" />
        <path d="M47 20h6l22 60h-4L50 28 29 80h-4z" fill={c.p} />
        <K d={star(50, 58, 15, 6)} fill={WHITE} w={3} />
        <path d={star(50, 58, 8, 3.3)} fill={c.p} />
      </>
    ),
  },

  // Thunder Bay Thunder: a storm roundel with the bolt breaking out of the frame.
  TBY: {
    full: (c) => (
      <>
        <K d={circle(50, 52, 40)} fill={c.s} w={4} />
        <path d={circle(50, 52, 34)} fill="none" stroke={c.p} strokeWidth="2.5" />
        <path d="M24 46c-6 0-9-9-2-12 0-8 10-11 15-5 3-8 17-8 19 2 9-2 14 7 8 13z" fill={DARK_STEEL} stroke={KEY} strokeWidth="2.5" strokeLinejoin="round" />
        <K d="M58 2L30 54h18L36 98l40-56H56l14-40z" fill={c.p} w={4.5} />
        <path d="M58 8L36 50h14" fill="none" stroke={WHITE} strokeWidth="1.8" opacity="0.6" />
      </>
    ),
  },

  // ===========================================================================
  // East: Atlantic division
  // ===========================================================================

  // Hartford Harpoons: a whale's fluke rising out of the water, the city lettered beneath.
  HFD: {
    full: (c) => (
      <>
        <L d="M10 66L82 8" color={STEEL} w={3} />
        <K d="M82 8l-12 2 7 7z" fill={STEEL} w={3} />
        <Fluke fill={c.p} y={0} />
        <K d="M6 70c8-5 16-5 24 0s16 5 24 0 16-5 24 0 12 4 16 4v7c-4 0-8-3-16-3s-16 6-24 6-16-6-24-6-16 6-24 6z" fill={c.s} w={3} />
        <T y={97} size={12} ls={3} w={2.6} width={76} fill={c.p}>
          {up(c.t.city)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <L d="M8 76L86 8" color={STEEL} w={3.5} />
        <g transform="translate(50 50) scale(1.15) translate(-50 -46)">
          <Fluke fill={c.p} y={0} />
        </g>
        <K d="M4 80c9-6 18-6 27 0s18 6 27 0 18-6 38 0v9c-20-6-29-6-38 0s-18 6-27 0-18-6-27 0z" fill={c.s} w={3} />
      </>
    ),
  },

  // Hershey Chocolatiers: a confectioner's oval medallion with a split cocoa pod and the name around it.
  HER: {
    full: (c) => (
      <>
        <K d="M50 4c25 0 44 21 44 46S75 96 50 96 6 75 6 50 25 4 50 4z" fill={c.s} w={3.5} />
        <path d="M50 12c20 0 36 17 36 38S70 88 50 88 14 71 14 50 30 12 50 12z" fill={c.p} stroke={KEY} strokeWidth="2.5" />
        <Arc id={`${c.id}-n`} r={30} text={up(c.t.name)} size={8} fill={c.s} ls={1.2} />
        <g transform="translate(50 56) rotate(-30) translate(-50 -56)">
          <K d="M50 30c10 0 16 12 16 26S60 82 50 82 34 70 34 56s6-26 16-26z" fill={c.s} w={3} />
          <path d="M50 30v52M42 34c-3 8-3 36 0 44M58 34c3 8 3 36 0 44" fill="none" stroke={KEY} strokeWidth="1.4" opacity="0.6" />
          <path d="M44 46c4-4 8-4 12 0-4 4-8 4-12 0zM44 58c4-4 8-4 12 0-4 4-8 4-12 0zM44 70c4-4 8-4 12 0-4 4-8 4-12 0z" fill={WHITE} stroke={KEY} strokeWidth="1.2" />
        </g>
        <path d={star(22, 72, 2.4, 1)} fill={c.s} />
        <path d={star(78, 72, 2.4, 1)} fill={c.s} />
      </>
    ),
    small: (c) => (
      <>
        <K d="M50 4c25 0 44 21 44 46S75 96 50 96 6 75 6 50 25 4 50 4z" fill={c.p} w={3.5} />
        <path d="M50 10c22 0 38 18 38 40S72 90 50 90 12 72 12 50 28 10 50 10z" fill="none" stroke={c.s} strokeWidth="3" />
        <g transform="translate(50 50) rotate(-30) scale(1.15) translate(-50 -56)">
          <K d="M50 30c10 0 16 12 16 26S60 82 50 82 34 70 34 56s6-26 16-26z" fill={c.s} w={3} />
          <path d="M44 46c4-4 8-4 12 0-4 4-8 4-12 0zM44 58c4-4 8-4 12 0-4 4-8 4-12 0zM44 70c4-4 8-4 12 0-4 4-8 4-12 0z" fill={WHITE} stroke={KEY} strokeWidth="1.2" />
        </g>
      </>
    ),
  },

  // Cleveland Barons: old money: a crowned serif B, standing on its own.
  CLE: {
    full: (c) => (
      <>
        <K d="M22 30l6-18 10 10 12-16 12 16 10-10 6 18z" fill={c.s} w={3.5} />
        <circle cx="28" cy="12" r="3" fill={c.s} stroke={KEY} strokeWidth="2" />
        <circle cx="50" cy="6" r="3" fill={c.s} stroke={KEY} strokeWidth="2" />
        <circle cx="72" cy="12" r="3" fill={c.s} stroke={KEY} strokeWidth="2" />
        <path d="M24 30h52" stroke={KEY} strokeWidth="3" />
        <T y={94} size={74} font={SERIF} weight={900} fill={c.s} w={5}>
          B
        </T>
        <T y={94} size={74} font={SERIF} weight={900} fill="none" w={1.6} stroke={c.p}>
          B
        </T>
      </>
    ),
  },

  // Baltimore Clippers: a clipper under full sail, the name in script on the swell.
  BAL: {
    full: (c) => (
      <>
        <L d="M36 14v50M54 8v56M70 18v46" color={c.s} w={2} k={2.6} />
        <K d="M37 18c10 4 12 14 12 22H37zM37 44c10 3 12 10 12 16H37z" fill={WHITE} w={3} />
        <K d="M55 12c12 5 14 16 14 26H55zM55 42c12 4 14 12 14 20H55z" fill={WHITE} w={3} />
        <K d="M71 22c8 3 10 10 10 16H71zM71 42c8 3 10 9 10 14H71z" fill={WHITE} w={3} />
        <K d="M14 64h78l-10 12H24z" fill={c.p} w={4} />
        <path d="M54 6l8 3-8 3z" fill={c.s} stroke={KEY} strokeWidth="1.5" />
        <T y={95} size={24} font={SCRIPT} weight={400} fill={c.s} w={3.5} skew={-6}>
          {c.t.name}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <L d="M34 12v62M54 6v68M72 16v58" color={c.s} w={2.4} k={3} />
        <K d="M35 16c12 5 14 16 14 26H35zM35 46c12 4 14 12 14 20H35z" fill={WHITE} w={3.2} />
        <K d="M55 10c14 6 16 18 16 30H55zM55 44c14 5 16 13 16 22H55z" fill={WHITE} w={3.2} />
        <K d="M73 20c9 4 11 11 11 18H73zM73 44c9 3 11 10 11 16H73z" fill={WHITE} w={3.2} />
        <K d="M8 74h86l-12 14H20z" fill={c.p} w={4.5} />
      </>
    ),
  },

  // Atlanta Firebirds: a phoenix rising, wings flung wide: pure silhouette, no frame.
  ATL: {
    full: (c) => (
      <>
        {/* Flame tail */}
        <K d="M50 58c-12 8-14 22-8 38 1-9 4-14 8-16 4 2 7 7 8 16 6-16 4-30-8-38z" fill="#f2a900" w={3.5} />
        <path d="M50 66c-4 6-4 14-2 20M50 66c4 6 4 14 2 20" fill="none" stroke={c.p} strokeWidth="2" />
        {/* Wings: three swept feather blades a side */}
        <K d="M48 52C38 30 22 20 2 18c8 5 12 9 14 13-6-2-11-2-14-1 9 4 15 8 18 13-5-1-9 0-12 1 12 3 22 9 28 18z" fill={c.p} w={4} />
        <K d="M48 52C38 30 22 20 2 18c8 5 12 9 14 13-6-2-11-2-14-1 9 4 15 8 18 13-5-1-9 0-12 1 12 3 22 9 28 18z" fill={c.p} w={4} transform={MIRROR} />
        <path d="M10 22c14 2 26 12 34 26M90 22c-14 2-26 12-34 26" fill="none" stroke="#f2a900" strokeWidth="2.2" />
        {/* Body, neck and head in profile, beak to the right */}
        <K d="M50 62c-7-8-9-20-7-30 1-8 3-14 7-18 4-3 9-3 12 0l9 4-9 2c-2 4-2 8 0 14 2 10 0 20-12 28z" fill={c.p} w={4} />
        <path d="M54 16c-6-4-10-10-10-14 4 2 8 4 12 8" fill="#f2a900" stroke={KEY} strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="59" cy="17.5" r="1.8" fill={WHITE} stroke={KEY} strokeWidth="0.8" />
        <path d="M47 36c0 8 2 15 4 20" fill="none" stroke="#f2a900" strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },

  // Cincinnati Stingers: a hornet diving inside a honeycomb hexagon.
  CIN: {
    full: (c) => (
      <>
        <K d="M50 3l42 24v46L50 97 8 73V27z" fill={c.s} w={3.5} />
        <path d="M50 10l36 21v38L50 90 14 69V31z" fill="none" stroke={c.p} strokeWidth="3" />
        <g transform="translate(50 50) rotate(-35) translate(-50 -50)">
          {/* Wings */}
          <path d="M48 40c-12-14-28-16-34-8 4 8 18 12 32 12zM52 40c12-14 28-16 34-8-4 8-18 12-32 12z" fill={WHITE} opacity="0.85" stroke={KEY} strokeWidth="2.2" strokeLinejoin="round" />
          {/* Head, thorax, abdomen */}
          <K d={circle(50, 26, 7)} fill={c.s} w={3} />
          <K d="M44 36c0-4 3-6 6-6s6 2 6 6v6H44z" fill={c.p} w={3} />
          <K d="M50 42c9 0 13 8 13 18 0 10-6 18-13 28-7-10-13-18-13-28s4-18 13-18z" fill={c.p} w={3.5} />
          <path d="M38 54h24M38.5 64h23M41 74h18" stroke={KEY} strokeWidth="4.5" />
          <path d="M44 22l-8-10M56 22l8-10" stroke={KEY} strokeWidth="2" strokeLinecap="round" />
          <path d="M45 24l3 2M55 24l-3 2" stroke={c.p} strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </>
    ),
  },

  // Birmingham Bulls: a bull's head, horns wide, over a slab wordmark.
  BHM: {
    full: (c) => (
      <>
        <K d="M30 26C18 26 8 18 6 8c8 6 16 8 26 6zM70 26c12 0 22-8 24-18-8 6-16 8-26 6z" fill={c.s} w={3.5} />
        <K d="M30 18c6-4 14-6 20-6s14 2 20 6c4 6 4 14 0 22l-6 22c-2 6-8 9-14 9s-12-3-14-9l-6-22c-4-8-4-16 0-22z" fill={c.p} w={4} />
        <path d="M34 34l9 4M66 34l-9 4" stroke={KEY} strokeWidth="3.5" strokeLinecap="round" />
        <path d="M36 35l6 2.5M64 35l-6 2.5" stroke={c.s} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M40 58c2 4 6 6 10 6s8-2 10-6" fill="none" stroke={KEY} strokeWidth="2" />
        <K d={circle(50, 62, 4)} fill="none" w={2.5} />
        <path d="M42 54h3M55 54h3" stroke={KEY} strokeWidth="3" strokeLinecap="round" />
        <T y={93} size={21} font={SLAB} fill={c.s} w={3.5} ls={1}>
          {up(c.t.name)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <K d="M28 34C14 34 4 24 2 10c10 8 18 10 30 8zM72 34c14 0 24-10 26-24-10 8-18 10-30 8z" fill={c.s} w={4} />
        <K d="M28 24c7-5 15-7 22-7s15 2 22 7c5 7 5 17 0 26l-7 26c-2 7-9 11-15 11s-13-4-15-11l-7-26c-5-9-5-19 0-26z" fill={c.p} w={4.5} />
        <path d="M32 42l10 5M68 42l-10 5" stroke={KEY} strokeWidth="4" strokeLinecap="round" />
        <path d="M42 66h4M54 66h4" stroke={KEY} strokeWidth="3.5" strokeLinecap="round" />
      </>
    ),
  },

  // Providence Reds: a pure script wordmark climbing to the right, underlined by its own tail.
  PRV: {
    full: (c) => (
      <>
        <path d="M14 78c20 6 46 4 76-12" fill="none" stroke={KEY} strokeWidth="9" strokeLinecap="round" />
        <path d="M14 78c20 6 46 4 76-12" fill="none" stroke={c.s} strokeWidth="4" strokeLinecap="round" />
        <g transform="rotate(-12 50 56)">
          <T y={70} size={46} font={SCRIPT} weight={400} fill={c.p} w={6}>
            {c.t.name}
          </T>
        </g>
      </>
    ),
    small: (c) => (
      <>
        <K d={circle(50, 50, 45)} fill={c.p} w={3.5} />
        <path d={circle(50, 50, 39)} fill="none" stroke={WHITE} strokeWidth="2" />
        <T y={72} size={64} font={SCRIPT} weight={400} fill={WHITE} w={4} x={47}>
          {c.t.name[0]}
        </T>
      </>
    ),
  },

  // ===========================================================================
  // West: Prairie division
  // ===========================================================================

  // Portland Lumberjacks: crossed felling axes inside a circular saw blade.
  POR: {
    full: (c) => (
      <>
        <K d={teeth(50, 50, 48, 41, 24, 0.25)} fill={STEEL} w={3} />
        <path d={circle(50, 50, 38)} fill={c.p} stroke={KEY} strokeWidth="2.5" />
        <path d={circle(50, 50, 33)} fill="none" stroke={c.s} strokeWidth="1.6" strokeDasharray="5 3" />
        <g transform="rotate(40 50 50)">
          <L d="M50 18v66" color="#a8743f" w={4.5} />
          <K d="M50 22c8-2 14 0 18 4l-2 14c-6-2-12-2-16 0z" fill={STEEL} w={3} />
          <path d="M66 26l-2 14" stroke={c.s} strokeWidth="2.5" />
        </g>
        <g transform="rotate(-40 50 50)">
          <L d="M50 18v66" color="#a8743f" w={4.5} />
          <K d="M50 22c-8-2-14 0-18 4l2 14c6-2 12-2 16 0z" fill={STEEL} w={3} />
          <path d="M34 26l2 14" stroke={c.s} strokeWidth="2.5" />
        </g>
        <circle cx="50" cy="50" r="4" fill={c.s} stroke={KEY} strokeWidth="2" />
      </>
    ),
  },

  // Saskatoon Blades: a skate in full stride over the prairie, the city set under the blade.
  SAS: {
    full: (c) => (
      <>
        <path d="M2 30h22M6 40h20M10 50h18" stroke={c.s} strokeWidth="3.5" strokeLinecap="round" />
        <K d="M34 14h20c4 0 6 3 6 6v14l18 8c6 3 8 8 8 14H30l2-12c1-6 1-12 0-18z" fill={c.p} w={4} />
        <path d="M44 22h10M44 28h10M60 36l8 4" stroke={WHITE} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M30 56h56" stroke={KEY} strokeWidth="2" />
        <L d="M36 58v6M78 58v6" color={STEEL} w={3} k={2.5} />
        <K d="M20 66h66c6 0 8-3 8-6 2 6-2 10-8 10H24z" fill={c.s} w={3.5} />
        <T y={92} size={14} ls={2.5} w={2.8} width={84} fill={c.s}>
          {up(c.t.city)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <K d="M30 10h24c4 0 7 3 7 7v18l20 9c7 3 9 9 9 16H26l2-14c1-7 1-14 0-22z" fill={c.p} w={4.5} />
        <path d="M42 20h12M42 28h12" stroke={WHITE} strokeWidth="2.6" strokeLinecap="round" />
        <L d="M34 62v8M80 62v8" color={STEEL} w={3.5} k={2.5} />
        <K d="M14 72h72c7 0 9-4 9-7 3 7-2 12-9 12H18z" fill={c.s} w={4} />
      </>
    ),
  },

  // Victoria Cougars: a cougar's head in profile, mid-snarl, standing on its own.
  VIC: {
    full: (c) => (
      <>
        <K d="M14 40C14 34 19 30 27 28 35 21 43 17 53 17L61 5 71 20C82 27 89 40 87 54 85 67 77 77 65 85L57 73C49 71 41 67 35 61L22 60 20 56 31 53 18 47z" fill={c.p} w={4.5} />
        <path d="M20 56l11-3-13-6c0 4 1 7 2 9z" fill="#7a1020" />
        <path d="M19 47l2 6 2-5zM22 56l2-5 2 4z" fill={WHITE} stroke={KEY} strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M62 9l5 10-6 1z" fill={c.s} />
        <path d="M13.5 38l6-1.5-2.5 5z" fill={KEY} />
        <path d="M34 33l10-4 3 4-9 3z" fill="#f2b705" stroke={KEY} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="42" cy="32" r="1.2" fill={KEY} />
        <path d="M29 30c6-4 14-6 21-4" fill="none" stroke={KEY} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="24" cy="44" r="1" fill={KEY} />
        <circle cx="27.5" cy="45.5" r="1" fill={KEY} />
        <circle cx="26" cy="41.5" r="1" fill={KEY} />
        <path d="M38 62c12 4 24 2 34-6M58 72c8-2 16-8 20-16" fill="none" stroke={c.s} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M54 24c10 2 20 10 24 22" fill="none" stroke={WHITE} strokeWidth="1.6" opacity="0.4" />
      </>
    ),
  },

  // Regina Pats: a regimental cap badge: a starburst, the crown, the city on a scroll.
  REG: {
    full: (c) => (
      <>
        <K d={star(50, 46, 44, 32, 12, -90)} fill={STEEL} w={3.5} />
        <path d={star(50, 46, 38, 28, 12, -90)} fill="none" stroke={DARK_STEEL} strokeWidth="1.4" />
        <K d={circle(50, 46, 24)} fill={c.p} w={3} />
        <path d={circle(50, 46, 20)} fill="none" stroke={WHITE} strokeWidth="1.4" />
        <K d="M36 50l-2-14 7 6 9-10 9 10 7-6-2 14z" fill="#e8b923" w={2.6} />
        <path d="M36 50h28" stroke={KEY} strokeWidth="2" />
        <circle cx="50" cy="31" r="2" fill="#e8b923" stroke={KEY} strokeWidth="1.2" />
        <path d="M42 58l8-3 8 3-8 3z" fill={WHITE} stroke={KEY} strokeWidth="1.2" />
        {/* Scroll */}
        <K d="M6 74l10-4v14l-10 4 4-7z" fill={c.s} w={2.6} />
        <K d="M94 74l-10-4v14l10 4-4-7z" fill={c.s} w={2.6} />
        <K d="M14 70c12 4 24 6 36 6s24-2 36-6v14c-12 4-24 6-36 6s-24-2-36-6z" fill={c.s} w={3} />
        <T y={85} size={10} ls={2} w={0} width={52}>
          {up(c.t.city)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <K d={star(50, 50, 48, 35, 12, -90)} fill={STEEL} w={3.5} />
        <K d={circle(50, 50, 28)} fill={c.p} w={3} />
        <K d="M33 56l-3-17 9 7 11-12 11 12 9-7-3 17z" fill="#e8b923" w={2.8} />
        <path d="M33 56h34" stroke={KEY} strokeWidth="2.2" />
      </>
    ),
  },

  // Spokane Chiefs: a fire chief's cross: the badge as the whole logo, a big S at its heart.
  SPO: {
    full: (c) => (
      <>
        <K d="M38 4h24l-4 22 14-14 16 16-14 14 22-4v24l-22-4 14 14-16 16-14-14 4 22H38l4-22-14 14-16-16 14-14-22 4V38l22 4-14-14 16-16 14 14z" fill={c.p} w={3.5} />
        <path d="M42 8h16l-3 18M42 92h16l-3-18" fill="none" stroke={WHITE} strokeWidth="1.3" opacity="0.4" />
        <K d={circle(50, 50, 19)} fill={c.s} w={3} />
        <path d={circle(50, 50, 15.5)} fill="none" stroke={WHITE} strokeWidth="1.2" />
        <T y={63} size={34} font={SLAB} fill={WHITE} w={3}>
          {c.t.city[0]}
        </T>
      </>
    ),
  },

  // Kamloops Blazers: a mountain with its peak on fire; the city in italic caps beneath.
  KAM: {
    full: (c) => (
      <>
        <K d="M50 6c-4 8 0 12-4 18-3-4-2-8-2-10-6 6-8 14-4 20h20c4-8 0-16-6-20 1 4 0 8-2 10 0-8 2-12-2-18z" fill={c.p} w={3.5} />
        <path d="M50 18c-3 6 0 10-2 14h6c2-5-1-9-4-14z" fill="#ffd166" />
        <K d="M4 76L34 34l10 12 6-8 6 8 10-12 30 42z" fill={c.s} w={4} />
        <path d="M34 34l6 12-6-2-4 8M66 34l-6 12 6-2 4 8" fill={WHITE} stroke={KEY} strokeWidth="1.8" strokeLinejoin="round" />
        <T y={95} size={15} ls={1.5} w={3} width={86} fill={c.p} skew={-12}>
          {up(c.t.city)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <K d="M50 2c-5 10 0 15-5 22-4-5-3-10-3-13-7 8-10 18-5 26h26c5-10 0-20-8-26 1 5 0 10-3 13 0-10 3-15-2-22z" fill={c.p} w={4} />
        <K d="M2 88L34 40l10 14 6-9 6 9 10-14 32 48z" fill={c.s} w={4.5} />
        <path d="M34 40l7 14-7-2-5 9M66 40l-7 14 7-2 5 9" fill={WHITE} stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },

  // Milwaukee Admirals: a ship's wheel with a fouled anchor at the hub; no type, no frame.
  MIL: {
    full: (c) => (
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i} transform={`rotate(${i * 45} 50 50)`}>
            <L d="M50 50V6" color={c.s} w={4} k={3.2} />
            <K d="M47 2h6l1 7h-8z" fill={c.s} w={2.5} />
          </g>
        ))}
        <path d={circle(50, 50, 33)} fill="none" stroke={KEY} strokeWidth="12" />
        <path d={circle(50, 50, 33)} fill="none" stroke={c.s} strokeWidth="7" />
        <path d={circle(50, 50, 33)} fill="none" stroke={KEY} strokeWidth="1.2" strokeDasharray="2 7" />
        <K d={circle(50, 50, 22)} fill={c.p} w={3} />
        {/* Anchor */}
        <L d="M50 34v30M43 40h14" color={WHITE} w={3} k={2.5} />
        <circle cx="50" cy="32" r="3" fill="none" stroke={WHITE} strokeWidth="2.5" />
        <path d="M38 56c2 8 6 10 12 10s10-2 12-10" fill="none" stroke={WHITE} strokeWidth="3" strokeLinecap="round" />
        <path d="M36 54l3 5 3-4M64 54l-3 5-3-4" fill="none" stroke={WHITE} strokeWidth="2.4" strokeLinejoin="round" />
      </>
    ),
  },

  // Omaha Lancers: a monogram: a big O run through by a lance flying a pennant.
  OMA: {
    full: (c) => (
      <>
        <path d={circle(50, 52, 34)} fill="none" stroke={KEY} strokeWidth="22" />
        <path d={circle(50, 52, 34)} fill="none" stroke={c.p} strokeWidth="15" />
        <path d={circle(50, 52, 34)} fill="none" stroke={WHITE} strokeWidth="1.4" opacity="0.5" />
        <L d="M8 92L88 12" color={STEEL} w={4} />
        <K d="M88 12l-14 4 10 10z" fill={STEEL} w={3} />
        <K d="M68 26c8 2 16 0 22 4-6 2-10 6-12 12-4-6-8-10-14-10z" fill={c.s} w={3} />
        <path d="M8 92l10-10" stroke={c.s} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },

  // ===========================================================================
  // West: Frontier division
  // ===========================================================================

  // Kansas City Scouts: a compass rose pointing the way, the KC monogram at its centre.
  KC: {
    full: (c) => (
      <>
        <K d={star(50, 50, 48, 10, 4, -90)} fill={c.s} w={3.5} />
        <path d="M50 2L46 46 50 50zM98 50L54 46 50 50zM50 98l4-44-4-4zM2 50l44 4 4-4z" fill={KEY} opacity="0.25" />
        <K d={star(50, 50, 30, 8, 4, -45)} fill={STEEL} w={3} />
        <K d={circle(50, 50, 19)} fill={c.p} w={3} />
        <path d={circle(50, 50, 15.5)} fill="none" stroke={c.s} strokeWidth="1.4" />
        <T y={58} size={20} font={SLAB} fill={WHITE} w={2.5}>
          {c.t.abbr.slice(0, 2)}
        </T>
      </>
    ),
  },

  // Houston Aeros: a rocket climbing out of orbit, the name in a fast italic underneath.
  HOU: {
    full: (c) => (
      <>
        <path d="M8 54c20-24 56-34 86-30" fill="none" stroke={KEY} strokeWidth="8" strokeLinecap="round" />
        <path d="M8 54c20-24 56-34 86-30" fill="none" stroke={c.s} strokeWidth="3.5" strokeLinecap="round" />
        <g transform="rotate(45 50 40)">
          <K d="M44 60c-2 8 0 16 6 22 6-6 8-14 6-22z" fill={c.s} w={3} />
          <path d="M47 62c-1 6 0 11 3 15 3-4 4-9 3-15z" fill="#ffd166" />
          <K d="M50 6c8 8 12 20 12 34v20H38V40c0-14 4-26 12-34z" fill={WHITE} w={4} />
          <path d="M42 16h16" stroke={c.p} strokeWidth="0" />
          <K d="M50 6c4 4 7 9 9 14H41c2-5 5-10 9-14z" fill={c.s} w={3} />
          <K d={circle(50, 34, 5.5)} fill={c.p} w={2.5} />
          <K d="M38 44l-10 14v6l10-4zM62 44l10 14v6l-10-4z" fill={c.p} w={3} />
        </g>
        <path d={star(18, 22, 4, 1.6)} fill={WHITE} />
        <path d={star(30, 8, 2.6, 1)} fill={WHITE} />
        <T y={95} size={22} ls={1} w={3.5} fill={c.p} skew={-14} stroke={KEY}>
          {up(c.t.name)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <path d="M4 66c22-28 60-40 94-36" fill="none" stroke={KEY} strokeWidth="9" strokeLinecap="round" />
        <path d="M4 66c22-28 60-40 94-36" fill="none" stroke={c.s} strokeWidth="4" strokeLinecap="round" />
        <g transform="translate(50 50) scale(1.15) rotate(45) translate(-50 -44)">
          <K d="M44 60c-2 8 0 16 6 22 6-6 8-14 6-22z" fill={c.s} w={3} />
          <K d="M50 6c8 8 12 20 12 34v20H38V40c0-14 4-26 12-34z" fill={WHITE} w={4} />
          <K d="M50 6c4 4 7 9 9 14H41c2-5 5-10 9-14z" fill={c.s} w={3} />
          <K d={circle(50, 34, 5.5)} fill={c.p} w={2.5} />
          <K d="M38 44l-10 14v6l10-4zM62 44l10 14v6l-10-4z" fill={c.p} w={3} />
        </g>
      </>
    ),
  },

  // San Diego Gulls: a gull gliding over a curling Pacific swell; the simplest mark in the league.
  SD: {
    full: (c) => (
      <>
        <K d={circle(50, 50, 44)} fill={c.p} w={3.5} />
        <path d={circle(50, 50, 38)} fill="none" stroke={c.s} strokeWidth="1.6" />
        <K d="M8 66c14-8 26-6 34 2 10 10 26 10 34-2 4-6 12-6 16 0v10c-12 20-74 22-84 0z" fill={c.s} w={3} />
        <K d="M10 40c10-6 22-6 30 2l10 6 10-6c8-8 22-10 32-4-8 0-16 4-22 10l-8 6c-4 3-8 3-12 0l-8-6c-8-6-18-10-32-8z" fill={WHITE} w={3.5} />
        <path d="M66 42c6-4 14-6 22-6M34 42c-6-4-14-6-22-6" fill="none" stroke={DARK_STEEL} strokeWidth="2" />
        <path d="M50 46l4 2-4 1z" fill="#f2a900" stroke={KEY} strokeWidth="1" />
      </>
    ),
  },

  // Oklahoma City Stampede: a lucky horseshoe, open to the sky, with OKC branded inside.
  OKC: {
    full: (c) => (
      <>
        <K d="M20 88L10 50C6 26 24 6 50 6s44 20 40 44L80 88H62l8-38c2-14-6-26-20-26S28 36 30 50l8 38z" fill={STEEL} w={4} />
        {[
          [18, 72],
          [14, 52],
          [20, 32],
          [82, 72],
          [86, 52],
          [80, 32],
        ].map(([x, y]) => (
          <rect key={`${x}${y}`} x={x - 2} y={y - 3} width="4" height="6" rx="1" fill={KEY} />
        ))}
        <K d={star(50, 58, 22, 9)} fill={c.s} w={3.5} />
        <T y={68} size={17} font={SLAB} fill={WHITE} w={3} ls={-0.5}>
          {c.t.abbr}
        </T>
        <path d="M30 94h40" stroke={c.p} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },

  // Albuquerque Roadrunners: a roadrunner at full sprint across a desert sun.
  ABQ: {
    full: (c) => (
      <>
        <K d="M12 72a40 40 0 0 1 76 0z" fill={c.s} w={3.5} />
        <path d="M18 64h64M24 54h52" stroke={c.p} strokeWidth="2.5" opacity="0.5" />
        <K d="M14 50l20 6c8-10 22-14 34-10l10-14 4 2-6 14 18 4-18 4c-4 8-12 12-22 12L34 78l-4-4 10-6c-8-2-14-6-18-12z" fill={c.p} w={4} />
        <path d="M72 28l2-10 4 4-2 8M76 30l6-8 2 6-4 4" fill={c.p} stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="76" cy="36" r="1.8" fill={WHITE} stroke={KEY} strokeWidth="0.8" />
        <path d="M44 72l-6 16h-6M54 70l2 18h-6" fill="none" stroke={KEY} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M44 72l-6 16h-6M54 70l2 18h-6" fill="none" stroke={c.s} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 82h18M2 88h14" stroke={c.p} strokeWidth="3" strokeLinecap="round" />
        <path d="M30 56c10-2 22 0 30 6" fill="none" stroke={WHITE} strokeWidth="2" opacity="0.6" />
      </>
    ),
  },

  // Sacramento Monarchs: royalty: a jewelled crown over the name in a classical serif.
  SAC: {
    full: (c) => (
      <>
        <K d="M18 58L12 22l18 16 20-26 20 26 18-16-6 36z" fill="#d9b44a" w={4} />
        <path d="M18 58h64" stroke={KEY} strokeWidth="3" />
        <K d="M18 58h64v8H18z" fill="#d9b44a" w={3} />
        <circle cx="12" cy="22" r="4" fill={c.p} stroke={KEY} strokeWidth="2" />
        <circle cx="50" cy="12" r="4.5" fill={c.p} stroke={KEY} strokeWidth="2" />
        <circle cx="88" cy="22" r="4" fill={c.p} stroke={KEY} strokeWidth="2" />
        <circle cx="34" cy="62" r="2.2" fill={c.p} />
        <circle cx="50" cy="62" r="2.2" fill={c.p} />
        <circle cx="66" cy="62" r="2.2" fill={c.p} />
        <path d="M50 30l5 8-5 8-5-8z" fill={c.p} stroke={KEY} strokeWidth="1.5" />
        <T y={90} size={15} font={SERIF} weight={900} fill={c.p} w={3} ls={1} width={88}>
          {up(c.t.name)}
        </T>
      </>
    ),
    small: (c) => (
      <>
        <K d="M14 74L6 26l22 20 22-32 22 32 22-20-8 48z" fill="#d9b44a" w={4.5} />
        <K d="M14 74h72v10H14z" fill="#d9b44a" w={3.5} />
        <circle cx="6" cy="26" r="5" fill={c.p} stroke={KEY} strokeWidth="2.2" />
        <circle cx="50" cy="14" r="5.5" fill={c.p} stroke={KEY} strokeWidth="2.2" />
        <circle cx="94" cy="26" r="5" fill={c.p} stroke={KEY} strokeWidth="2.2" />
        <path d="M50 40l7 10-7 10-7-10z" fill={c.p} stroke={KEY} strokeWidth="2" />
      </>
    ),
  },

  // Austin Outlaws: a lawman's star with bullet holes, the city stamped across it.
  AUS: {
    full: (c) => (
      <>
        <K d={star(50, 50, 47, 24, 6, -90)} fill={c.p} w={4} />
        {Array.from({ length: 6 }, (_, i) => {
          const a = ((-90 + i * 60) * Math.PI) / 180;
          return <circle key={i} cx={50 + 47 * Math.cos(a)} cy={50 + 47 * Math.sin(a)} r="4.5" fill={c.p} stroke={KEY} strokeWidth="2.5" />;
        })}
        <path d={star(50, 50, 38, 20, 6, -90)} fill="none" stroke={WHITE} strokeWidth="1.4" opacity="0.5" />
        <K d="M8 42h84v16H8z" fill={c.s} w={3} />
        <T y={55} size={12} ls={2.5} w={0} width={72}>
          {up(c.t.city)}
        </T>
        <circle cx="34" cy="28" r="2.6" fill={KEY} stroke={DARK_STEEL} strokeWidth="1" />
        <circle cx="64" cy="72" r="2.6" fill={KEY} stroke={DARK_STEEL} strokeWidth="1" />
        <circle cx="58" cy="26" r="2" fill={KEY} stroke={DARK_STEEL} strokeWidth="1" />
      </>
    ),
    small: (c) => (
      <>
        <K d={star(50, 50, 47, 24, 6, -90)} fill={c.p} w={4} />
        {Array.from({ length: 6 }, (_, i) => {
          const a = ((-90 + i * 60) * Math.PI) / 180;
          return <circle key={i} cx={50 + 47 * Math.cos(a)} cy={50 + 47 * Math.sin(a)} r="5" fill={c.p} stroke={KEY} strokeWidth="2.5" />;
        })}
        <K d={circle(50, 50, 14)} fill={c.s} w={3} />
        <circle cx="54" cy="46" r="3.5" fill={KEY} />
      </>
    ),
  },

  // Memphis Riverkings: a crowned catfish leaping out of the Mississippi.
  MEM: {
    full: (c) => (
      <>
        <K d="M4 80c10-6 20-6 30 0s20 6 30 0 20-6 32 0v8c-12-6-22-6-32 0s-20 6-30 0-20-6-30 0z" fill={c.s} w={3} />
        <K d="M40 27l6-13 8 15z" fill={c.p} w={3} />
        <K d="M14 44c2-12 14-18 28-17 16 1 30 12 36 28l12-6-4 14 8 12-14-4c-10-6-20-10-30-12-10-2-20-2-28-6-5-2-8-5-8-9z" fill={c.p} w={4} />
        <path d="M18 50c10 4 22 4 32 6 10 2 18 6 26 12" fill="none" stroke={WHITE} strokeWidth="4" strokeLinecap="round" opacity="0.85" />
        <path d="M44 50l-6 10 12-6z" fill={c.p} stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <path d="M14 46c-6 4-10 12-8 22M17 48c-3 6-3 14 1 20M15 41c-6-4-11-5-14-3" fill="none" stroke={KEY} strokeWidth="3.6" strokeLinecap="round" />
        <path d="M14 46c-6 4-10 12-8 22M17 48c-3 6-3 14 1 20M15 41c-6-4-11-5-14-3" fill="none" stroke={c.p} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 44h8" stroke={KEY} strokeWidth="2" strokeLinecap="round" />
        <circle cx="25" cy="37" r="2.4" fill={WHITE} stroke={KEY} strokeWidth="1.2" />
        <path d="M18 24l-2-10 7 5 4-9 4 9 7-5-2 10z" fill="#e8b923" stroke={KEY} strokeWidth="2.2" strokeLinejoin="round" transform="rotate(-12 26 22)" />
        <path d="M84 76c2-6 6-8 10-8M70 76c0-6 4-10 8-10" fill="none" stroke={c.s} strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
};

/** A whale's tail: two swept flukes on a stem rising out of the water. */
function Fluke({ fill, y }: { fill: string; y: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <K d="M44 74c1-10 2-18 4-24-8-1-16-6-22-14-4-5-6-12-6-18 5 5 12 8 20 9 6 1 9 4 10 8 1-4 4-7 10-8 8-1 15-4 20-9 0 6-2 13-6 18-6 8-14 13-22 14 2 6 3 14 4 24z" fill={fill} w={4} />
      <path d="M50 31v18" stroke={KEY} strokeWidth="1.6" opacity="0.6" />
    </g>
  );
}

/** Quebec's snowy owl, head on (drawn on a 100 grid, centre ~50,46). */
function Owl() {
  return (
    <>
      <K d="M50 78L28 66 22 42 18 14 34 28 50 24 66 28 82 14 78 42 72 66z" fill={WHITE} w={4} />
      <path d="M25 36l23 9M75 36l-23 9" stroke={KEY} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M28 42l18 5-2 7-13-2z" fill="#f2b705" stroke={KEY} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M72 42l-18 5 2 7 13-2z" fill="#f2b705" stroke={KEY} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M37 45l4 1-1 5-3-1zM63 45l-4 1 1 5 3-1z" fill={KEY} />
      <path d="M45 55h10l-5 12z" fill={KEY} />
      <path d="M36 66l4 4 4-4M56 66l4 4 4-4M46 72l4 3 4-3" stroke={DARK_STEEL} strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  );
}

/** Kingston's fort keep with a pennant (centre ~50,48). */
function Keep({ flag }: { flag: string }) {
  return (
    <>
      <L d="M50 26V8" color={WHITE} w={2.5} k={3} />
      <K d="M51 7l16 5-16 5z" fill={flag} w={2.8} />
      <K d="M24 28h9v7h8v-7h18v7h8v-7h9v16l-5 4v30H29V48l-5-4z" fill={WHITE} w={4} />
      <path d="M43 78V64a7 7 0 0 1 14 0v14z" fill={KEY} />
      <path d="M35 52h5v9h-5zM60 52h5v9h-5z" fill={KEY} />
      <path d="M29 48h42" stroke={DARK_STEEL} strokeWidth="2" />
    </>
  );
}

/** A monogram roundel for teams without a designed mark. */
function Monogram({ c }: { c: Ctx }) {
  return (
    <>
      <K d={circle(50, 50, 45)} fill={c.p} w={3.5} />
      <path d={circle(50, 50, 38)} fill="none" stroke={c.s} strokeWidth="3" />
      <T y={63} size={c.t.abbr.length > 2 ? 30 : 38} fill={WHITE} w={3.5}>
        {c.t.abbr}
      </T>
    </>
  );
}

/**
 * A team's logo. From 48px up it's the primary mark; smaller, the simplified
 * secondary mark (when the team has one), so chips and tables stay legible.
 */
export function TeamLogo({ team, size = 28, className, wordmark }: { team: LogoTeam; size?: number; className?: string; wordmark?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [p, s = WHITE] = team.colors;
  const c: Ctx = { p, s, t: team, id: `tl${uid}` };
  const m = MARKS[team.abbr];
  const full = wordmark ?? size >= 48;
  const draw = m ? (!full && m.small ? m.small : m.full) : null;
  return (
    <svg viewBox="-4 -4 108 108" width={size} height={size} className={className} role="img" aria-label={`${team.city} ${team.name}`}>
      <title>{`${team.city} ${team.name}`}</title>
      <defs>
        {/* A thin light contour around the whole mark, like a jersey crest's outer stitching, so dark marks read on dark backgrounds. */}
        <filter id={`${c.id}-halo`} x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology in="SourceAlpha" operator="dilate" radius={size < 40 ? 2.6 : 1.8} result="grown" />
          <feFlood floodColor="#f4f6fa" floodOpacity="0.9" />
          <feComposite in2="grown" operator="in" result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${c.id}-halo)`}>{draw ? draw(c) : <Monogram c={c} />}</g>
    </svg>
  );
}
