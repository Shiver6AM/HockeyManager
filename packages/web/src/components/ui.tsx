import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, onColor } from '../format';

export interface TeamLike {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: [string, string] | string[];
}

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-rink-700 bg-rink-900 shadow-sm shadow-black/30', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-rink-700 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold tracking-wider text-ice-300 uppercase">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'primary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-blueline text-white hover:bg-blue-500',
    secondary: 'bg-rink-700 text-ice-50 hover:bg-rink-600',
    ghost: 'text-ice-300 hover:bg-rink-800 hover:text-ice-50',
    danger: 'bg-goal/90 text-white hover:bg-goal',
  };
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    />
  );
}

export function TeamChip({ team, size = 'md' }: { team: TeamLike; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-10 w-10 text-sm' : size === 'sm' ? 'h-5 w-5 text-[8px]' : 'h-7 w-7 text-[10px]';
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-md font-display font-semibold tracking-wide ring-1 ring-white/10', dims)}
      style={{ background: team.colors[0], color: onColor(team.colors[0]), boxShadow: `inset 0 -3px 0 ${team.colors[1]}` }}
      title={`${team.city} ${team.name}`}
    >
      {team.abbr}
    </span>
  );
}

export function TeamLink({ leagueId, team, full = false }: { leagueId: string; team: TeamLike; full?: boolean }) {
  return (
    <Link to={`/league/${leagueId}/team/${team.id}`} className="inline-flex items-center gap-2 hover:text-white hover:underline">
      <TeamChip team={team} size="sm" />
      <span>{full ? `${team.city} ${team.name}` : team.city}</span>
    </Link>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-ice-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ice-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-goal/40 bg-goal/10 px-3 py-2 text-sm text-red-200">{errorMessage(error)}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  const tones = {
    neutral: 'bg-rink-700 text-ice-300',
    good: 'bg-win/15 text-win',
    bad: 'bg-goal/15 text-red-300',
    warn: 'bg-warn/15 text-warn',
    info: 'bg-blueline/15 text-blue-300',
  };
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold', tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ice-500">{children}</p>;
}

export function Rating({ value }: { value: number }) {
  const tone = value >= 85 ? 'text-win' : value >= 75 ? 'text-ice-50' : value >= 65 ? 'text-ice-300' : 'text-ice-500';
  return <span className={cx('tabular font-semibold', tone)}>{value}</span>;
}

/** Centered dialog; closes on Escape or a click on the backdrop. */
export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-3xl rounded-xl border border-rink-600 bg-rink-900 shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-rink-700 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold tracking-wider text-ice-200 uppercase">{title}</h2>
          <button onClick={onClose} className="rounded px-2 text-lg text-ice-400 hover:text-white" aria-label="Close">
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

const GRADE_SCALE: Record<string, number> = { 'A+': 1, A: 0.92, 'A-': 0.84, 'B+': 0.74, B: 0.66, 'B-': 0.58, 'C+': 0.48, C: 0.4, 'C-': 0.32, D: 0.18, F: 0 };

/** Grey (low ceiling) → green (elite), for a scouting grade. */
export function gradeColor(grade: string): { bg: string; fg: string } {
  const t = GRADE_SCALE[grade] ?? 0;
  const hue = Math.round(220 - 78 * t);
  const sat = Math.round(6 + 62 * t);
  const light = Math.round(34 + 6 * t);
  return { bg: `hsl(${hue} ${sat}% ${light}%)`, fg: t > 0.55 ? '#ffffff' : '#cbd5e1' };
}

/** Scouts' grade for a player's ceiling as a colour-scaled chip, with the projected role on hover (or shown). */
export function PotentialBadge({ potential, showLabel }: { potential?: { grade: string; projection: string } | null; showLabel?: boolean }) {
  if (!potential) return null;
  const c = gradeColor(potential.grade);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`Potential: ${potential.projection} (${potential.grade})`}>
      <span className="inline-flex min-w-7 justify-center rounded px-1 py-0.5 text-[11px] font-bold" style={{ background: c.bg, color: c.fg }}>
        {potential.grade}
      </span>
      {showLabel && <span className="text-xs text-ice-400">{potential.projection}</span>}
    </span>
  );
}

/** A trade-value meter, like the trade screen's. */
export function ValueBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Trade value ${pct}/100 to your front office`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-rink-700">
        <span className={cx('block h-1.5 rounded-full', pct >= 65 ? 'bg-win' : pct >= 40 ? 'bg-blueline' : pct >= 20 ? 'bg-warn' : 'bg-goal')} style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
      <span className="tabular w-6 text-right text-[11px] text-ice-400">{pct}</span>
    </span>
  );
}
