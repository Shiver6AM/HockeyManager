/**
 * Trait badges (2K-style): a small tier-coloured chip per trait, and a full
 * card listing what each one does.
 */
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

/** Compact chips, for tables. */
export function TraitChips({ traits, max = 3 }: { traits: TraitView[] | undefined; max?: number }) {
  if (!traits?.length) return null;
  return (
    <span className="ml-1.5 inline-flex gap-0.5 align-middle">
      {traits.slice(0, max).map((t) => (
        <span
          key={t.id}
          title={`${t.label} (${t.tierName}): ${t.help}`}
          className={cx('inline-flex h-4 min-w-4 items-center justify-center rounded border px-0.5 text-[10px] leading-none', TIER_STYLE[t.tier])}
        >
          {ICON[t.id] ?? t.label[0]}
        </span>
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
