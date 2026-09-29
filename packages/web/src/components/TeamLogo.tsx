/**
 * Team logos, drawn as SVG in each team's colors (all original designs).
 *
 * Built like a pro sports identity:
 *  - a primary mark: a crest or roundel with a layered outline (dark keyline,
 *    second-color band, primary fill), a bold angular emblem with its own
 *    keyline, and a slanted wordmark banner with the team name;
 *  - a secondary mark for small sizes (tables, chips): the same emblem without
 *    the wordmark, drawn a little larger.
 * Teams without a designed emblem (renamed or added) get a monogram.
 */
import type { ReactNode } from 'react';

export interface LogoTeam {
  abbr: string;
  city: string;
  name: string;
  colors: string[];
}

type Shape = 'shield' | 'crest' | 'roundel' | 'hex' | 'badge' | 'diamond';
interface Ink {
  /** Primary (badge) color. */
  p: string;
  /** Accent: the second team color when it reads on the badge, else white. */
  a: string;
  /** Keyline: near-black. */
  k: string;
  /** Light: off-white. */
  w: string;
  /** Steel / neutral grey. */
  s: string;
}
type Emblem = (c: Ink) => ReactNode;

const KEY = '#0e1116';
const LIGHT = '#f5f7fa';
const STEEL = '#c9d1da';

/** A filled path with a dark keyline drawn behind it. */
function K({ d, fill, w = 4.5, ...rest }: { d: string; fill: string; w?: number; transform?: string; opacity?: number }) {
  return <path d={d} fill={fill} stroke={KEY} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" paintOrder="stroke" {...rest} />;
}
/** A stroke-only line with a keyline around it. */
function L({ d, color, w = 4 }: { d: string; color: string; w?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={KEY} strokeWidth={w + 4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function star(cx: number, cy: number, R: number, r: number, n = 5, rot = -90) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = ((rot + (i * 180) / n) * Math.PI) / 180;
    const d = i % 2 ? r : R;
    pts.push(`${(cx + d * Math.cos(rad)).toFixed(1)},${(cy + d * Math.sin(rad)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
/** Mirror a path's x coordinates around x = 50 (for symmetric emblems). */
const MIRROR = 'translate(100 0) scale(-1 1)';

const EMBLEMS: Record<string, { shape: Shape; draw: Emblem }> = {
  // Halifax Tidewater: a breaking wave.
  HAL: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M16 60C20 38 36 22 58 22c15 0 25 9 25 20 0 9-6 14-13 14-7 0-11-5-10-10 1-5 6-7 10-5-3-7-11-9-18-7-13 4-19 18-17 32z" fill={c.w} />
        <K d="M12 66c12-7 22 1 38-5 12-4 24-3 38 3v9c-14-6-26-6-38-2-16 6-26-2-38 5z" fill={c.a} />
      </>
    ),
  },
  // Quebec Harfangs: a snowy owl, head on.
  QUE: {
    shape: 'crest',
    draw: (c) => (
      <>
        <K d="M50 74L30 64 24 42 20 16 35 29 50 25 65 29 80 16 76 42 70 64z" fill={c.w} />
        <path d="M27 37l21 8M73 37l-21 8" stroke={KEY} strokeWidth="4" strokeLinecap="round" />
        <path d="M29 42l17 5-2 6-12-2z" fill="#f2b705" stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <path d="M71 42l-17 5 2 6 12-2z" fill="#f2b705" stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <path d="M38 45l4 1-1 4-3-1zM62 45l-4 1 1 4 3-1z" fill={KEY} />
        <path d="M45 53h10l-5 12z" fill={KEY} />
        <path d="M40 64l4 4 4-4M52 64l4 4 4-4" stroke={STEEL} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  // Moncton Wildcats: a lynx, snarling.
  MON: {
    shape: 'hex',
    draw: (c) => (
      <>
        <K d="M50 76L31 67 22 52 24 34 18 10 36 25 50 23 64 25 82 10 76 34 78 52 69 67z" fill={c.w} />
        <path d="M23 15l10 12-6 4zM77 15L67 27l6 4z" fill={c.p} />
        <path d="M30 41l14 5-3 5-9-2z" fill="#f4c542" stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <path d="M70 41l-14 5 3 5 9-2z" fill="#f4c542" stroke={KEY} strokeWidth="2" strokeLinejoin="round" />
        <path d="M37 44l2 5M63 44l-2 5" stroke={KEY} strokeWidth="2.2" />
        <path d="M45 55h10l-5 5z" fill={KEY} />
        <path d="M39 63l11-4 11 4-5 9-6-2-6 2z" fill={KEY} />
        <path d="M42.5 63.5l2 6 1.5-6.5zM57.5 63.5l-2 6-1.5-6.5z" fill={c.w} />
        <path d="M27 58l-9 2M28 62l-8 5M73 58l9 2M72 62l8 5" stroke={KEY} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  // Kingston Frontenacs: a fortress tower flying a pennant.
  KGN: {
    shape: 'crest',
    draw: (c) => (
      <>
        <L d="M50 26V11" color={c.w} w={2.5} />
        <K d="M51 10l14 4-14 5z" fill={c.a} w={3} />
        <K d="M27 28h8v6h7v-6h16v6h7v-6h8v15l-4 3v28H31V46l-4-3z" fill={c.w} />
        <path d="M43 74V62a7 7 0 0 1 14 0v12z" fill={KEY} />
        <path d="M36 48h5v8h-5zM59 48h5v8h-5z" fill={KEY} />
        <path d="M31 46h38" stroke={STEEL} strokeWidth="2" />
      </>
    ),
  },
  // London Knights: a knight's great helm with a plume.
  LDN: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M53 22c7-12 23-14 32-6-8 0-15 2-20 7 8-2 14 0 18 4-10 0-19 1-26 3z" fill={c.a} />
        <K d="M30 76V45c0-16 8-25 20-25s20 9 20 25v31l-20 7z" fill={STEEL} />
        <path d="M50 20v24" stroke="#8d97a3" strokeWidth="2.5" />
        <path d="M33 43h34v6H33z" fill={KEY} />
        <path d="M48 53h4v22h-4z" fill={KEY} />
        <path d="M37 58h2v2h-2zM37 64h2v2h-2zM61 58h2v2h-2zM61 64h2v2h-2z" fill={KEY} />
      </>
    ),
  },
  // Hamilton Forge: a hammer striking the anvil.
  HAM: {
    shape: 'badge',
    draw: (c) => (
      <>
        <K d="M16 46h50c0 7 8 10 18 10v4H63l-6 7h8v9H33v-9h8l-6-7h-9c-6 0-10-6-10-14z" fill={c.w} />
        <K d="M60 10l5 5-19 25-5-5z" fill="#9b6b3e" />
        <K d="M58 4l14 14-6 6-14-14z" fill={STEEL} />
        <K d={star(40, 40, 10, 3.5, 8)} fill={c.a} w={3} />
      </>
    ),
  },
  // Rochester Americans: a star with speed stripes.
  ROC: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <K d="M12 34h26l-4 7H8zM10 46h22l-4 7H6zM14 58h16l-4 7H10z" fill={c.a} w={3.5} />
        <K d={star(58, 46, 28, 11.5)} fill={c.w} />
        <path d={star(58, 46, 11, 4.5)} fill={c.p} />
      </>
    ),
  },
  // Thunder Bay Thunder: a lightning bolt out of a storm cloud.
  TBY: {
    shape: 'diamond',
    draw: (c) => (
      <>
        <K d="M27 44c-8 0-11-12-3-15 0-10 12-14 18-7 4-10 20-10 23 2 10-2 16 8 10 15z" fill={STEEL} />
        <K d="M53 30L34 58h14l-8 26 28-36H54l8-18z" fill={c.a} />
      </>
    ),
  },
  // Hartford Harpoons: a whale's tail and a harpoon.
  HFD: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <L d="M20 80L73 17" color={c.a} w={3.5} />
        <K d="M80 9L66 14l7 8z" fill={STEEL} w={3.5} />
        <K d="M44 66c1-10 1-18-2-24-8-8-20-6-28-14 12-4 24-2 32 6l4 4 4-4c8-8 20-10 32-6-8 8-20 6-28 14-3 6-3 14-2 24z" fill={c.w} />
        <K d="M14 68c9-6 17-6 25 0s16 6 24 0 16-6 23-2v8c-7-4-15-4-23 2s-16 6-24 0-16-6-25 0z" fill={c.a} w={3.5} />
      </>
    ),
  },
  // Hershey Chocolatiers: a cacao pod on the vine.
  HER: {
    shape: 'crest',
    draw: (c) => (
      <>
        <K d="M50 18c-6-10-17-11-24-7 8 4 16 7 24 7zM50 18c6-10 17-11 24-7-8 4-16 7-24 7z" fill="#5c8a3c" w={3.5} />
        <K d="M50 18c16 8 22 24 20 40-2 14-10 22-20 26-10-4-18-12-20-26-2-16 4-32 20-40z" fill={c.a} />
        <path d="M50 21v60M42 25c-4 18-4 38 2 54M58 25c4 18 4 38-2 54" stroke={KEY} strokeWidth="2.2" fill="none" opacity="0.7" />
      </>
    ),
  },
  // Cleveland Barons: a coronet over a monogram.
  CLE: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M28 32l4-16 9 10 9-14 9 14 9-10 4 16z" fill={c.a} />
        <K d="M28 32h44v6H28z" fill={c.a} />
        <text x="50" y="76" textAnchor="middle" fontFamily="Oswald, Inter, sans-serif" fontWeight="700" fontSize="40" fill={c.w} stroke={KEY} strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
          B
        </text>
      </>
    ),
  },
  // Baltimore Clippers: a clipper under full sail.
  BAL: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <K d="M29 60c-4-12-4-24 0-36h11c-3 12-3 24 0 36zM44 60c-4-16-4-32 0-48h12c-3 16-3 32 0 48zM60 60c-3-11-3-22 0-32h11c3 10 3 21 0 32z" fill={c.w} />
        <K d="M50 12l12-4-12-3z" fill={c.a} w={3} />
        <K d="M14 64h72l-10 14H26z" fill={c.a} />
      </>
    ),
  },
  // Atlanta Firebirds: a phoenix rising.
  ATL: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M50 56C40 42 26 38 12 40c8-8 18-11 26-9-10-6-16-12-18-20 12 4 22 12 30 26zM50 56c10-14 24-18 38-16-8-8-18-11-26-9 10-6 16-12 18-20-12 4-22 12-30 26z" fill={c.w} />
        <K d="M50 38c-4-8-4-16 0-24 4 8 4 16 0 24z" fill={c.w} />
        <K d="M50 54c-7 8-9 18-5 30 2-7 4-11 5-14 1 3 3 7 5 14 4-12 2-22-5-30z" fill="#f59f1c" />
      </>
    ),
  },
  // Cincinnati Stingers: a hornet diving.
  CIN: {
    shape: 'hex',
    draw: (c) => (
      <>
        <K d="M47 42L20 18l-5 8 28 22zM53 42l27-24 5 8-28 22z" fill={c.w} opacity={0.95} />
        <K d="M43 34h14l-7-12z" fill={KEY} />
        <K d="M50 42l13 14-13 30-13-30z" fill={KEY} w={3} />
        <path d="M41 56h18l-2.5 5h-13zM44 66h12l-2 5h-8z" fill={c.p} />
      </>
    ),
  },
  // Birmingham Bulls: a bull, head on.
  BHM: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M36 38C24 38 14 32 12 18c6 10 16 13 26 12zM64 38c12 0 22-6 24-20-6 10-16 13-26 12z" fill={c.w} />
        <K d="M34 34h32l2 16-7 22c-2 7-20 7-22 0l-7-22z" fill={c.a} />
        <path d="M37 45l9 3-2 3-7-2zM63 45l-9 3 2 3 7-2z" fill={KEY} />
        <path d="M40 62h20l-3 11H43z" fill={KEY} opacity="0.55" />
        <circle cx="50" cy="74" r="5" fill="none" stroke={STEEL} strokeWidth="2.5" />
      </>
    ),
  },
  // Providence Reds: a lighthouse throwing its beam.
  PRV: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <path d="M58 24l32-10v18zM42 24L10 14v18z" fill={c.w} opacity="0.35" />
        <K d="M42 30h16l4 46H38z" fill={c.w} />
        <path d="M40.6 44h18.8M39.6 58h20.8" stroke={c.p} strokeWidth="5" />
        <K d="M41 30h18v-9H41z" fill={KEY} w={3} />
        <K d="M40 21l10-9 10 9z" fill={c.a} w={3} />
        <path d="M44 23h12v5H44z" fill="#ffd54a" />
      </>
    ),
  },
  // Portland Lumberjacks: crossed axes over a pine.
  POR: {
    shape: 'crest',
    draw: (c) => (
      <>
        <K d="M50 10l15 24h-7l12 18h-9l11 18H28l11-18h-9l12-18h-7z" fill={c.w} />
        <L d="M24 80L68 26" color="#9b6b3e" w={3.5} />
        <L d="M76 80L32 26" color="#9b6b3e" w={3.5} />
        <K d="M64 22c6-4 14-2 18 4l-9 9c-2-5-6-8-11-8z" fill={c.a} w={3.5} />
        <K d="M36 22c-6-4-14-2-18 4l9 9c2-5 6-8 11-8z" fill={c.a} w={3.5} />
      </>
    ),
  },
  // Saskatoon Blades: crossed sabres under a star.
  SAS: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M20 78c18-18 34-38 48-60l5 3C60 43 44 63 25 82z" fill={STEEL} w={3.5} />
        <K d="M20 78c18-18 34-38 48-60l5 3C60 43 44 63 25 82z" fill={STEEL} w={3.5} transform={MIRROR} />
        <K d="M16 72l10 10M84 72l-10 10" fill="none" w={3} />
        <L d="M17 71l11 11M83 71L72 82" color={c.a} w={3.5} />
        <K d={star(50, 26, 10, 4)} fill={c.a} w={3.5} />
      </>
    ),
  },
  // Victoria Cougars: claw marks torn through.
  VIC: {
    shape: 'badge',
    draw: (c) => (
      <>
        <K d="M30 14c4 22 4 44-6 66 12-18 16-40 12-64z" fill={c.w} />
        <K d="M48 12c4 24 4 48-4 70 10-20 14-44 10-68z" fill={c.w} />
        <K d="M66 14c4 22 2 44-8 64 12-18 16-40 12-62z" fill={c.w} />
        <path d="M32 20c2 18 1 36-5 54M50 18c2 20 1 40-4 58M68 20c2 18 0 36-7 52" stroke={c.a} strokeWidth="1.8" fill="none" />
      </>
    ),
  },
  // Regina Pats: a maple leaf.
  REG: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M50 12l4.5 10 7-4-2.5 16 12.5-6-3 10 8.5 4-12.5 7 2.5 7.5-13-3-1 12h-4l-1-12-13 3 2.5-7.5-12.5-7 8.5-4-3-10 12.5 6L38.5 18l7 4z" fill={c.w} />
        <L d="M50 66v14" color={c.w} w={3} />
      </>
    ),
  },
  // Spokane Chiefs: rank chevrons under a star.
  SPO: {
    shape: 'crest',
    draw: (c) => (
      <>
        <K d={star(50, 22, 10, 4)} fill={c.a} w={3.5} />
        <K d="M20 36l30 16 30-16v10L50 62 20 46z" fill={c.w} />
        <K d="M20 52l30 16 30-16v10L50 78 20 62z" fill={c.a} />
      </>
    ),
  },
  // Kamloops Blazers: a puck blazing a trail.
  KAM: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <K d="M12 40c14 2 26 4 40 4-8 4-8 8-2 10-14 2-26-2-38-14zM16 62c12-2 24-4 36-8-6 6-4 10 2 12-12 4-26 2-38-4zM22 26c10 6 20 10 32 12-6 2-8 6-4 8-12-2-22-8-28-20z" fill={c.a} w={3.5} />
        <path d="M50 48v10a18 8 0 0 0 36 0V48" fill="#1b2027" stroke={KEY} strokeWidth="3" />
        <ellipse cx="68" cy="48" rx="18" ry="8" fill="#2c333d" stroke={KEY} strokeWidth="3" />
        <path d="M56 46c6-3 16-3 22 0" stroke={c.w} strokeWidth="1.8" fill="none" opacity="0.6" strokeLinecap="round" />
      </>
    ),
  },
  // Milwaukee Admirals: a fouled anchor with a star.
  MIL: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <L d="M50 26v50M36 34h28" color={c.w} w={4.5} />
        <L d="M22 56c2 12 12 22 28 22s26-10 28-22" color={c.w} w={4.5} />
        <K d="M16 60l6-10 6 10zM72 60l6-10 6 10z" fill={c.w} w={3} />
        <circle cx="50" cy="18" r="6" fill="none" stroke={KEY} strokeWidth="8" />
        <circle cx="50" cy="18" r="6" fill="none" stroke={c.w} strokeWidth="4" />
        <K d={star(50, 50, 7, 2.8)} fill={c.a} w={3} />
      </>
    ),
  },
  // Omaha Lancers: a lance and pennant crossing a heater shield.
  OMA: {
    shape: 'badge',
    draw: (c) => (
      <>
        <K d="M30 30h40v20c0 14-9 22-20 26-11-4-20-12-20-26z" fill={c.a} />
        <path d="M50 30v46M30 50h40" stroke={KEY} strokeWidth="2" opacity="0.5" />
        <L d="M18 84L78 14" color={STEEL} w={3.5} />
        <K d="M84 8l-12 4 5 6z" fill={STEEL} w={3} />
        <K d="M72 20l-18-2 7 8-9 4 15 3z" fill={c.w} w={3} />
      </>
    ),
  },
  // Kansas City Scouts: a compass rose.
  KC: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <K d="M50 20l5 25 25 5-25 5-5 25-5-25-25-5 25-5z" fill={c.w} w={3.5} />
        <K d="M50 28l4 18 18 4-18 4-4 18-4-18-18-4 18-4z" fill={c.w} w={0} transform="rotate(45 50 50)" opacity={0.55} />
        <path d="M50 20l5 25H45z" fill={c.a} />
        <circle cx="50" cy="50" r="4" fill={KEY} />
      </>
    ),
  },
  // Houston Aeros: a jet climbing, with contrails.
  HOU: {
    shape: 'shield',
    draw: (c) => (
      <>
        <path d="M22 80l20-20M30 84l18-18" stroke={c.w} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
        <K d="M76 16l-8 22 12 14-6 2-12-10-8 8 2 10-4 2-6-10-10-6 2-4 10 2 8-8-10-12 2-6 14 12z" fill={c.w} />
        <path d="M70 26l-6 6" stroke={c.a} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  // San Diego Gulls: a gull diving over the surf.
  SD: {
    shape: 'roundel',
    draw: (c) => (
      <>
        <K d="M10 32c12-2 24 2 32 12l8 8 8-8c8-10 20-14 32-12-10 4-18 10-24 20l-8 14-8-4-8 4-8-14c-6-10-14-16-24-20z" fill={c.w} />
        <K d="M47 54l3-6 3 6-3 4z" fill="#f2a900" w={2} />
        <K d="M14 72c10-5 18-5 26 0s16 5 24 0 14-5 22-1v7c-8-4-14-4-22 1s-16 5-24 0-16-5-26 0z" fill={c.a} w={3} />
      </>
    ),
  },
  // Oklahoma City Stampede: a horseshoe with stars.
  OKC: {
    shape: 'hex',
    draw: (c) => (
      <>
        <path d="M30 18v24a20 20 0 0 0 40 0V18" stroke={KEY} strokeWidth="18" fill="none" strokeLinecap="butt" />
        <path d="M30 18v24a20 20 0 0 0 40 0V18" stroke={c.w} strokeWidth="11" fill="none" strokeLinecap="butt" />
        {[
          [30, 26],
          [30, 38],
          [70, 26],
          [70, 38],
          [38, 56],
          [62, 56],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x - 1.5} y={y - 2.5} width="3" height="5" fill={KEY} />
        ))}
        <K d={star(50, 36, 9, 3.6)} fill={c.a} w={3} />
      </>
    ),
  },
  // Albuquerque Roadrunners: a desert sun.
  ABQ: {
    shape: 'diamond',
    draw: (c) => (
      <>
        {[0, 90, 180, 270].map((r) => (
          <g key={r} transform={`rotate(${r} 50 50)`}>
            <L d="M42 30V16M47 30V12M53 30V12M58 30V16" color={c.w} w={2.6} />
          </g>
        ))}
        <circle cx="50" cy="50" r="13" fill={c.a} stroke={KEY} strokeWidth="4" />
      </>
    ),
  },
  // Sacramento Monarchs: a royal crown.
  SAC: {
    shape: 'crest',
    draw: (c) => (
      <>
        <K d="M22 66l-4-32 14 12 18-26 18 26 14-12-4 32z" fill={c.w} />
        <K d="M22 66h56v10H22z" fill={c.a} />
        <circle cx="50" cy="44" r="4.5" fill={c.p} stroke={KEY} strokeWidth="2" />
        <circle cx="33" cy="56" r="3" fill={c.p} stroke={KEY} strokeWidth="2" />
        <circle cx="67" cy="56" r="3" fill={c.p} stroke={KEY} strokeWidth="2" />
      </>
    ),
  },
  // Austin Outlaws: hat and bandana.
  AUS: {
    shape: 'shield',
    draw: (c) => (
      <>
        <K d="M34 42c0-16 5-24 10-24 3 0 4 3 6 3s3-3 6-3c5 0 10 8 10 24z" fill={c.w} />
        <K d="M10 40c8 7 22 10 40 10s32-3 40-10c-2 10-16 16-40 16S12 50 10 40z" fill={c.w} />
        <path d="M34.5 38h31" stroke={c.a} strokeWidth="4" />
        <K d="M28 60h44l-22 22z" fill={c.a} />
        <path d="M36 64h28" stroke={KEY} strokeWidth="1.8" opacity="0.5" />
      </>
    ),
  },
  // Memphis Riverkings: a crowned trident over the river.
  MEM: {
    shape: 'shield',
    draw: (c) => (
      <>
        <L d="M50 24v44M34 32v8c0 7 7 11 16 11s16-4 16-11v-8" color={c.w} w={4} />
        <K d="M30 34l4-12 4 12zM46 26l4-12 4 12zM62 34l4-12 4 12z" fill={c.w} w={3.5} />
        <K d="M14 70c8-5 16-5 24 0s16 5 24 0 16-5 24 0v7c-8-5-16-5-24 0s-16 5-24 0-16-5-24 0z" fill={c.a} w={3} />
      </>
    ),
  },
};

const SHAPES: Record<Shape, string> = {
  shield: 'M50 4L90 15v31c0 26-17 42-40 51C27 88 10 72 10 46V15z',
  crest: 'M11 9h27l12-6 12 6h27v38c0 26-18 41-39 50C29 88 11 73 11 47z',
  roundel: 'M50 4a46 46 0 1 1 0 92a46 46 0 1 1 0-92z',
  hex: 'M50 3l42 23v48L50 97 8 74V26z',
  badge: 'M28 4h44l24 24v44L72 96H28L4 72V28z',
  diamond: 'M50 2l48 48-48 48L2 50z',
};

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (x: string, y: string) => {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};

/**
 * A team's logo. At 96px and up it's the primary mark with the wordmark
 * banner; smaller, the secondary mark (emblem only).
 */
export function TeamLogo({ team, size = 28, className, wordmark }: { team: LogoTeam; size?: number; className?: string; wordmark?: boolean }) {
  const [p, c2 = LIGHT] = team.colors;
  const e = EMBLEMS[team.abbr];
  const light = contrast(p, LIGHT) >= 2.2;
  const ink: Ink = {
    p,
    a: contrast(p, c2) >= 1.8 ? c2 : light ? LIGHT : KEY,
    k: KEY,
    w: light ? LIGHT : '#1d232b',
    s: STEEL,
  };
  const band = contrast(p, c2) >= 1.4 ? c2 : LIGHT;
  const full = wordmark ?? size >= 96;
  const shape = SHAPES[e?.shape ?? 'shield'];
  const id = `tl-${team.abbr}-${full ? 'f' : 's'}`;
  const name = team.name.toUpperCase();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={`${team.city} ${team.name}`}>
      <title>{`${team.city} ${team.name}`}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          <path d={shape} />
        </clipPath>
      </defs>
      {/* Layered outline: keyline, second-color band, primary field. */}
      <path d={shape} fill={KEY} stroke={KEY} strokeWidth="7" strokeLinejoin="round" />
      <path d={shape} fill={band} />
      <path d={shape} fill={p} transform="translate(50 50) scale(0.88) translate(-50 -50)" stroke={KEY} strokeWidth="2.5" strokeLinejoin="round" />
      <path d={shape} fill={`url(#${id})`} transform="translate(50 50) scale(0.88) translate(-50 -50)" />
      <g transform={full ? 'translate(50 44) scale(0.8) translate(-50 -50)' : 'translate(50 50) scale(0.8) translate(-50 -50)'}>
        {e ? (
          e.draw(ink)
        ) : (
          <text x="50" y="64" textAnchor="middle" fontFamily="Oswald, Inter, sans-serif" fontWeight="700" fontSize={team.abbr.length > 2 ? 34 : 44} fill={ink.w} stroke={KEY} strokeWidth="4" paintOrder="stroke">
            {team.abbr}
          </text>
        )}
      </g>
      {full && (
        <g transform="skewX(-10) translate(12 0)">
          <path d="M6 68h88l-4 17H2z" fill={KEY} />
          <path d="M8.5 70.5h83l-2.8 12H5.7z" fill={band === p ? LIGHT : band} />
          <path d="M10.5 72.5h79l-1.8 8H8.7z" fill={KEY} />
          <text
            x="49"
            y="80"
            textAnchor="middle"
            fontFamily="Oswald, Inter, sans-serif"
            fontWeight="700"
            fontSize="9"
            letterSpacing="0.6"
            fill={LIGHT}
            textLength={Math.min(74, name.length * 6.4)}
            lengthAdjust="spacingAndGlyphs"
          >
            {name}
          </text>
        </g>
      )}
    </svg>
  );
}
