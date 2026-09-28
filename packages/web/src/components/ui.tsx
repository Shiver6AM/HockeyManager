import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
