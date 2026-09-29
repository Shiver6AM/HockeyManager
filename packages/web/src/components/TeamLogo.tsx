/**
 * Team logos: an emblem for every franchise, drawn as SVG in the team's colors.
 * Each team has a badge shape and a motif that goes with its nickname
 * (Halifax Tidewater: waves; Thunder Bay Thunder: a lightning bolt…).
 * Teams without a motif (renamed or added) get a monogram.
 */
import type { ReactNode } from 'react';

export interface LogoTeam {
  abbr: string;
  city: string;
  name: string;
  colors: string[];
}

type Shape = 'shield' | 'circle' | 'hex' | 'square' | 'diamond' | 'pennant';
/** Draws the motif: `f` = main motif color, `a` = accent, `b` = badge color (for cut-outs). */
type Motif = (f: string, a: string, b: string) => ReactNode;

function star(cx: number, cy: number, R: number, r: number, n = 5, rot = -90) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = ((rot + (i * 180) / n) * Math.PI) / 180;
    const d = i % 2 ? r : R;
    pts.push(`${(cx + d * Math.cos(rad)).toFixed(1)},${(cy + d * Math.sin(rad)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const S = (w = 4) => ({ fill: 'none', strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

const MOTIFS: Record<string, { shape: Shape; draw: Motif }> = {
  // Halifax Tidewater: rolling waves under a crest.
  HAL: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M13 27c5-7 9-7 13 0s8 7 13 0 8-7 12 0" stroke={a} {...S(4.5)} />
        <path d="M13 37c5-7 9-7 13 0s8 7 13 0 8-7 12 0" stroke={f} {...S(4.5)} />
        <path d="M17 47c4-5 7-5 10 0s7 5 10 0 7-5 10 0" stroke={f} {...S(3.5)} />
      </>
    ),
  },
  // Quebec Harfangs: a snowy owl.
  QUE: {
    shape: 'circle',
    draw: (f, a, b) => (
      <>
        <path d="M17 17l8 7h14l8-7v19c0 11-6 17-15 17s-15-6-15-17z" fill={f} />
        <circle cx="26" cy="33" r="5.5" fill={b} />
        <circle cx="38" cy="33" r="5.5" fill={b} />
        <circle cx="26" cy="33" r="2.4" fill={a} />
        <circle cx="38" cy="33" r="2.4" fill={a} />
        <path d="M29.5 39h5L32 44z" fill={a} />
      </>
    ),
  },
  // Moncton Wildcats: a snarling cat.
  MON: {
    shape: 'hex',
    draw: (f, a, b) => (
      <>
        <path d="M15 14l11 9h12l11-9v22c0 11-8 17-17 17s-17-6-17-17z" fill={f} />
        <ellipse cx="25" cy="32" rx="2" ry="4.5" fill={b} />
        <ellipse cx="39" cy="32" rx="2" ry="4.5" fill={b} />
        <path d="M28.5 39h7L32 43.5z" fill={a} />
        <path d="M26 46l3-2.5h6L38 46" stroke={b} {...S(2)} />
      </>
    ),
  },
  // Kingston Frontenacs: a fort tower.
  KGN: {
    shape: 'shield',
    draw: (f, a, b) => (
      <>
        <path d="M18 18h6v5h4.5v-5h7v5H40v-5h6v13h-3v20H21V31h-3z" fill={f} />
        <path d="M28 51V43a4 4 0 0 1 8 0v8z" fill={b} />
        <rect x="30" y="31" width="4" height="6" rx="1" fill={a} />
      </>
    ),
  },
  // London Knights: a knight's helm with a plume.
  LDN: {
    shape: 'shield',
    draw: (f, a, b) => (
      <>
        <path d="M34 14c6-4 12-2 14 3-5-1-9 0-12 3z" fill={a} />
        <path d="M20 51V31c0-10 5-16 12-16s12 6 12 16v20z" fill={f} />
        <rect x="23" y="29" width="18" height="3.5" rx="1.5" fill={b} />
        <path d="M32 35v12" stroke={b} {...S(2.2)} />
      </>
    ),
  },
  // Hamilton Forge: an anvil throwing sparks.
  HAM: {
    shape: 'square',
    draw: (f, a) => (
      <>
        <path d="M13 26h30c0 5 5 7 9 7v3H42l-4 5h5v6H21v-6h5l-4-5h-3c-4 0-6-3-6-6z" fill={f} />
        <path d="M30 20l-3-6M36 20l2-7M42 21l5-5" stroke={a} {...S(2.8)} />
      </>
    ),
  },
  // Rochester Americans: a star.
  ROC: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <polygon points={star(32, 33, 19, 7.8)} fill={f} />
        <polygon points={star(32, 33, 8, 3.3)} fill={a} />
      </>
    ),
  },
  // Thunder Bay Thunder: a lightning bolt.
  TBY: {
    shape: 'diamond',
    draw: (f, a) => (
      <>
        <polygon points="37,9 18,36 30,36 25,55 47,26 35,26 41,9" fill={f} stroke={a} strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
  // Hartford Harpoons: a barbed harpoon.
  HFD: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <path d="M15 49L42 22" stroke={f} {...S(4)} />
        <path d="M51 13L36 19l9 9z" fill={f} />
        <path d="M41 24l-1 8M40 23l-8 1" stroke={f} {...S(3)} />
        <path d="M13 46l6 6M16 43l6 6" stroke={a} {...S(2.5)} />
      </>
    ),
  },
  // Hershey Chocolatiers: a chocolate bar.
  HER: {
    shape: 'square',
    draw: (f, a, b) => (
      <>
        <g transform="rotate(-18 32 33)">
          <rect x="19" y="15" width="26" height="36" rx="3" fill={f} />
          <path d="M32 15v36M19 27h26M19 39h26" stroke={b} strokeWidth="2" />
          <path d="M45 42l-7 9h7z" fill={a} />
        </g>
      </>
    ),
  },
  // Cleveland Barons: a baron's coronet.
  CLE: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M14 38l4-16 8 9 6-13 6 13 8-9 4 16z" fill={f} />
        <rect x="14" y="39" width="36" height="7" rx="2" fill={f} />
        <circle cx="18" cy="21" r="2.8" fill={a} />
        <circle cx="32" cy="17" r="2.8" fill={a} />
        <circle cx="46" cy="21" r="2.8" fill={a} />
        <circle cx="32" cy="42.5" r="2" fill={a} />
      </>
    ),
  },
  // Baltimore Clippers: a clipper ship under sail.
  BAL: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <path d="M31 12v26H15z" fill={f} />
        <path d="M34 16v22h14z" fill={f} />
        <path d="M11 41h42l-7 10H18z" fill={a} />
        <path d="M32 10v31" stroke={f} {...S(2)} />
      </>
    ),
  },
  // Atlanta Firebirds: a phoenix flame.
  ATL: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M32 9c5 10 15 14 15 27a15 15 0 0 1-30 0c0-8 6-11 6-19 4 4 6 8 6 13 2-6 3-12 3-21z" fill={f} />
        <path d="M32 31c3 5 7 7 7 12a7 7 0 0 1-14 0c0-4 3-6 4-10 1 2 2 4 2 6 1-3 1-5 1-8z" fill={a} />
      </>
    ),
  },
  // Cincinnati Stingers: a bee.
  CIN: {
    shape: 'hex',
    draw: (f, a, b) => (
      <>
        <ellipse cx="22" cy="23" rx="8" ry="5" fill={f} opacity="0.85" transform="rotate(-30 22 23)" />
        <ellipse cx="42" cy="23" rx="8" ry="5" fill={f} opacity="0.85" transform="rotate(30 42 23)" />
        <ellipse cx="32" cy="35" rx="9" ry="13" fill={a} />
        <path d="M23.5 31h17M23.5 38h17" stroke={b} strokeWidth="3.2" />
        <path d="M29 47l3 8 3-8z" fill={a} />
      </>
    ),
  },
  // Birmingham Bulls: a bull's head.
  BHM: {
    shape: 'shield',
    draw: (f, a, b) => (
      <>
        <path d="M9 18c3 9 9 12 16 12h14c7 0 13-3 16-12-1 11-7 17-14 18H23C16 35 10 29 9 18z" fill={a} />
        <path d="M22 28h20l-4 23h-12z" fill={f} />
        <circle cx="28.5" cy="46" r="1.8" fill={b} />
        <circle cx="35.5" cy="46" r="1.8" fill={b} />
        <circle cx="26.5" cy="34" r="1.8" fill={b} />
        <circle cx="37.5" cy="34" r="1.8" fill={b} />
      </>
    ),
  },
  // Providence Reds: a lighthouse on the bay.
  PRV: {
    shape: 'circle',
    draw: (f, a, b) => (
      <>
        <path d="M27 21h10l3 30H24z" fill={f} />
        <path d="M25.5 32h13M24.7 41h14.6" stroke={b} strokeWidth="3" />
        <path d="M26 21l6-8 6 8z" fill={a} />
        <path d="M38 16l12-4M38 19l12 2M26 16l-12-4M26 19l-12 2" stroke={a} {...S(2)} />
      </>
    ),
  },
  // Portland Lumberjacks: a felling axe.
  POR: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M19 51L43 19" stroke={a} {...S(4.5)} />
        <path d="M37 13c6-2 12 1 15 6l-8 9c-3-4-7-6-12-6z" fill={f} />
      </>
    ),
  },
  // Saskatoon Blades: a skate.
  SAS: {
    shape: 'square',
    draw: (f, a) => (
      <>
        <path d="M18 14h13v16l14 6c5 2 5 9-1 9H18z" fill={f} />
        <path d="M13 50h39c1-2 0-4-2-4" stroke={a} {...S(3.5)} />
        <path d="M22 45v5M42 45v5" stroke={a} {...S(2.5)} />
      </>
    ),
  },
  // Victoria Cougars: a cougar's paw print.
  VIC: {
    shape: 'hex',
    draw: (f) => (
      <>
        <path d="M22 43c0-7 5-11 10-11s10 4 10 11c0 5-4 7-10 7s-10-2-10-7z" fill={f} />
        <ellipse cx="19" cy="30" rx="4" ry="5.2" fill={f} transform="rotate(-20 19 30)" />
        <ellipse cx="27" cy="21" rx="4" ry="5.4" fill={f} />
        <ellipse cx="37" cy="21" rx="4" ry="5.4" fill={f} />
        <ellipse cx="45" cy="30" rx="4" ry="5.2" fill={f} transform="rotate(20 45 30)" />
      </>
    ),
  },
  // Regina Pats: a maple leaf.
  REG: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <polygon
          points="32,9 35.5,17 41,14 39,27 49,22 46.5,30 53,33 43,39 45,45 34.5,42.5 33.5,52 30.5,52 29.5,42.5 19,45 21,39 11,33 17.5,30 15,22 25,27 23,14 28.5,17"
          fill={f}
        />
        <path d="M32 40v14" stroke={a} {...S(2.5)} />
      </>
    ),
  },
  // Spokane Chiefs: stacked chevrons (rank insignia).
  SPO: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M16 17l16 9 16-9v7L32 33 16 24z" fill={a} />
        <path d="M16 28l16 9 16-9v7L32 44 16 35z" fill={f} />
        <path d="M16 39l16 9 16-9v7L32 55 16 46z" fill={f} />
      </>
    ),
  },
  // Kamloops Blazers: a blazing comet.
  KAM: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <path d="M12 48l22-18M14 38l18-12M22 52l16-16" stroke={a} {...S(3.5)} />
        <circle cx="41" cy="24" r="10" fill={f} />
      </>
    ),
  },
  // Milwaukee Admirals: an anchor.
  MIL: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <circle cx="32" cy="15" r="4" stroke={f} {...S(3)} />
        <path d="M32 19v33M23 27h18" stroke={f} {...S(3.5)} />
        <path d="M15 37c1 9 8 15 17 15s16-6 17-15" stroke={f} {...S(3.5)} />
        <path d="M11 39l4-5 4 5M45 39l4-5 4 5" {...S(2)} fill={a} stroke={a} />
      </>
    ),
  },
  // Omaha Lancers: a lance with a pennant.
  OMA: {
    shape: 'pennant',
    draw: (f, a) => (
      <>
        <path d="M14 52L46 16" stroke={f} {...S(3.5)} />
        <path d="M51 10l-9 3 5 5z" fill={f} />
        <path d="M41 21l-14-2 6 7-8 3 12 3z" fill={a} />
      </>
    ),
  },
  // Kansas City Scouts: a compass rose.
  KC: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <circle cx="32" cy="32" r="17" stroke={f} {...S(2.5)} />
        <polygon points="32,11 36,32 32,53 28,32" fill={f} />
        <polygon points="11,32 32,28 53,32 32,36" fill={f} />
        <polygon points="32,11 36,32 28,32" fill={a} />
      </>
    ),
  },
  // Houston Aeros: a rocket.
  HOU: {
    shape: 'shield',
    draw: (f, a, b) => (
      <>
        <path d="M32 8c8 8 10 19 8 31H24c-2-12 0-23 8-31z" fill={f} />
        <circle cx="32" cy="24" r="3.5" fill={b} />
        <path d="M24 32l-6 9h7zM40 32l6 9h-7z" fill={f} />
        <path d="M27 41h10l-5 13z" fill={a} />
      </>
    ),
  },
  // San Diego Gulls: a gull in flight.
  SD: {
    shape: 'circle',
    draw: (f, a) => (
      <>
        <path d="M8 30c9-6 17-5 24 5 7-10 15-11 24-5-9-2-16 3-24 13-8-10-15-15-24-13z" fill={f} />
        <path d="M14 46c6-3 12-3 18 0s12 3 18 0" stroke={a} {...S(2.5)} />
      </>
    ),
  },
  // Oklahoma City Stampede: a horseshoe.
  OKC: {
    shape: 'hex',
    draw: (f, _a, b) => (
      <>
        <path d="M20 15v14a12 12 0 0 0 24 0V15" stroke={f} strokeWidth="8.5" fill="none" strokeLinecap="square" />
        {[
          [20, 20],
          [20, 29],
          [44, 20],
          [44, 29],
          [25, 39],
          [39, 39],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill={b} />
        ))}
      </>
    ),
  },
  // Albuquerque Roadrunners: a desert sun.
  ABQ: {
    shape: 'diamond',
    draw: (f, a) => (
      <>
        <circle cx="32" cy="32" r="8" fill={a} />
        {[0, 90, 180, 270].map((r) => (
          <g key={r} transform={`rotate(${r} 32 32)`} stroke={f} {...S(2.5)}>
            <path d="M26 20V10M30 20V8M34 20V8M38 20V10" />
          </g>
        ))}
      </>
    ),
  },
  // Sacramento Monarchs: a monarch butterfly.
  SAC: {
    shape: 'circle',
    draw: (f, a, b) => (
      <>
        <path d="M31 30C25 16 11 14 12 25c1 8 10 9 19 7z" fill={a} />
        <path d="M33 30c6-14 20-16 19-5-1 8-10 9-19 7z" fill={a} />
        <path d="M31 34c-8 0-15 5-12 11 3 5 10 1 12-8zM33 34c8 0 15 5 12 11-3 5-10 1-12-8z" fill={f} />
        <path d="M32 22v26" stroke={b} {...S(3)} />
      </>
    ),
  },
  // Austin Outlaws: a cowboy hat.
  AUS: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M22 36c0-12 3-19 6-19 2 0 3 2 4 2s2-2 4-2c3 0 6 7 6 19z" fill={f} />
        <path d="M9 34c6 6 14 8 23 8s17-2 23-8c-3 9-12 13-23 13S12 43 9 34z" fill={f} />
        <path d="M22.3 32h19.4" stroke={a} {...S(3)} />
      </>
    ),
  },
  // Memphis Riverkings: a trident rising from the river.
  MEM: {
    shape: 'shield',
    draw: (f, a) => (
      <>
        <path d="M32 12v34M20 18v9c0 5 5 8 12 8s12-3 12-8v-9" stroke={f} {...S(3.5)} />
        <path d="M17 20l3-7 3 7zM29 14l3-7 3 7zM41 20l3-7 3 7z" fill={f} />
        <path d="M13 48c4-3 8-3 12 0s8 3 12 0 8-3 12 0" stroke={a} {...S(3)} />
      </>
    ),
  },
};

const SHAPES: Record<Shape, string> = {
  shield: 'M32 3l25 8v19c0 17-10 27-25 31C17 57 7 47 7 30V11z',
  circle: 'M32 3a29 29 0 1 1 0 58a29 29 0 1 1 0-58z',
  hex: 'M32 3l25 14.5v29L32 61 7 46.5v-29z',
  square: 'M13 4h38a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H13a9 9 0 0 1-9-9V13a9 9 0 0 1 9-9z',
  diamond: 'M32 2l30 30-30 30L2 32z',
  pennant: 'M8 5h48v36L32 61 8 41z',
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

export function TeamLogo({ team, size = 28, className }: { team: LogoTeam; size?: number; className?: string }) {
  const [c1, c2 = '#ffffff'] = team.colors;
  const m = MOTIFS[team.abbr];
  // Motif color: white or near-black, whichever reads on the badge; accent: the
  // second team color when it reads, otherwise the motif color.
  const main = contrast(c1, '#ffffff') >= contrast(c1, '#101418') ? '#ffffff' : '#101418';
  const accent = contrast(c1, c2) >= 1.9 ? c2 : main;
  const shape = m?.shape ?? 'shield';
  const id = `lg-${team.abbr}`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={`${team.city} ${team.name}`}>
      <title>{`${team.city} ${team.name}`}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={SHAPES[shape]} fill={c1} stroke={c2} strokeWidth="3.5" strokeLinejoin="round" />
      <path d={SHAPES[shape]} fill={`url(#${id})`} />
      {m ? (
        m.draw(main, accent, c1)
      ) : (
        <text x="32" y="41" textAnchor="middle" fontSize={team.abbr.length > 2 ? 19 : 24} fontWeight="800" fill={main} fontFamily="system-ui, sans-serif">
          {team.abbr}
        </text>
      )}
    </svg>
  );
}
