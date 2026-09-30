/**
 * Trait badges (2K-style): a small tier-coloured chip per trait, and a full
 * card listing what each one does.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './ui';

export interface TraitView {
  id: string;
  label: string;
  tier: number;
  tierName: string;
  kind: string;
  help: string;
}

/** Bronze, Silver, Gold, Hall of Fame. */
const TIER_STYLE: Record<number, string> = {
  1: 'border-[#b07a4a] bg-[#b07a4a]/20 text-[#e8b98c]',
  2: 'border-[#9aa7b8] bg-[#9aa7b8]/20 text-[#dbe3ee]',
  3: 'border-[#d4a72c] bg-[#d4a72c]/20 text-[#f5d879]',
  4: 'border-[#b056e0] bg-[#b056e0]/25 text-[#e7c2ff]',
};

const ICON: Record<string, string> = {
  sniper: '◎',
  playmaker: '⇄',
  clutch: '⏱',
  netFront: '⌂',
  ppSpecialist: '⚡',
  dangler: '∿',
  speedster: '»',
  faceoffAce: '⊕',
  shotBlocker: '▣',
  shutdown: '⛨',
  pkSpecialist: '✚',
  enforcer: '✊',
  ironMan: '♦',
  leader: '★',
  shootoutArtist: '✦',
  brickWall: '▦',
  bigGame: '♛',
  reboundControl: '◉',
};

const TIER_ACCENT: Record<number, string> = { 1: '#b07a4a', 2: '#9aa7b8', 3: '#d4a72c', 4: '#b056e0' };
const TIER_PIPS = (tier: number) => [1, 2, 3, 4].map((i) => (
  <span key={i} className="h-1.5 w-3 rounded-sm" style={{ background: i <= tier ? TIER_ACCENT[tier] : 'rgba(255,255,255,0.12)' }} />
));

/**
 * One chip, with a styled hover card. The card is rendered in a portal with
 * fixed positioning, so it isn't clipped by scrolling tables.
 */
function TraitChip({ t }: { t: TraitView }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 150;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);
  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="img"
        aria-label={`${t.label} (${t.tierName})`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (pos) hide();
          else show();
        }}
        className={cx(
          'inline-flex h-4 min-w-4 cursor-help items-center justify-center rounded border px-0.5 text-[10px] leading-none transition-transform hover:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-white',
          TIER_STYLE[t.tier],
        )}
      >
        {ICON[t.id] ?? t.label[0]}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-64 rounded-lg border bg-rink-950/95 p-3 text-left shadow-2xl shadow-black/60 backdrop-blur"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`, borderColor: TIER_ACCENT[t.tier] }}
          >
            <div className="flex items-center gap-2.5">
              <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-lg', TIER_STYLE[t.tier])}>{ICON[t.id] ?? t.label[0]}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{t.label}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="flex gap-0.5">{TIER_PIPS(t.tier)}</span>
                  <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: TIER_ACCENT[t.tier] }}>
                    {t.tierName}
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ice-200">{t.help}</p>
            <p className="mt-1.5 text-[10px] tracking-wider text-ice-500 uppercase">{t.kind}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Compact chips, for tables. */
export function TraitChips({ traits, max = 3 }: { traits: TraitView[] | undefined; max?: number }) {
  if (!traits?.length) return null;
  return (
    <span className="ml-1.5 inline-flex gap-0.5 align-middle">
      {traits.slice(0, max).map((t) => (
        <TraitChip key={t.id} t={t} />
      ))}
    </span>
  );
}

/** Full list, for the player page. */
export function TraitList({ traits }: { traits: TraitView[] }) {
  return (
    <ul className="space-y-2">
      {traits.map((t) => (
        <li key={t.id} className="flex items-start gap-3">
          <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-lg', TIER_STYLE[t.tier])}>{ICON[t.id] ?? t.label[0]}</span>
          <span className="min-w-0">
            <span className="block font-semibold text-white">
              {t.label} <span className={cx('ml-1 rounded border px-1 text-[10px] font-semibold uppercase', TIER_STYLE[t.tier])}>{t.tierName}</span>
            </span>
            <span className="block text-xs text-ice-400">{t.help}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
