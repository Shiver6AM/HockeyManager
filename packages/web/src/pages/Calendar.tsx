/**
 * The season calendar: every game day with its matchups, your team's games at
 * a glance, the key dates (trade deadline, end of the season, the playoffs),
 * and a way to sim straight to any date.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, Spinner, TeamChip } from '../components/ui';
import { dayDate, dayLabel } from '../format';
import { useSim } from '../sim';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague, useTeamById } from './LeagueLayout';

type Cal = Outputs['data']['calendar'];
type Game = Cal['days'][number][number];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_TONE: Record<string, string> = {
  season: 'bg-blueline/20 text-blue-200 ring-blueline/40',
  deadline: 'bg-warn/15 text-warn ring-warn/40',
  playoffs: 'bg-goal/15 text-red-200 ring-goal/40',
};

export function CalendarPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const q = useQuery(trpc.data.calendar.queryOptions({ leagueId: L.id }));
  const c = q.data;
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // Season day -> calendar date, and back.
  const dayOfDate = useMemo(() => {
    if (!c) return new Map<string, number>();
    const last = Math.max(c.lastRegularDay + 80, ...Object.keys(c.days).map(Number));
    const m = new Map<string, number>();
    for (let d = 0; d <= last; d++) m.set(dayDate(c.season, d).toDateString(), d);
    return m;
  }, [c]);

  if (q.isLoading || !c) return <Spinner />;
  const today = c.today;
  const inSeason = c.phase !== 'offseason';
  const focusDay = selected ?? (inSeason ? today : c.lastRegularDay);
  const focusDate = dayDate(c.season, focusDay);
  const monthKey = month ?? `${focusDate.getFullYear()}-${focusDate.getMonth()}`;
  const [y, mo] = monthKey.split('-').map(Number);
  const first = new Date(y, mo, 1);
  const cells: Array<Date | null> = [...Array(first.getDay()).fill(null)];
  for (let d = 1; d <= new Date(y, mo + 1, 0).getDate(); d++) cells.push(new Date(y, mo, d));
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => {
    const d = new Date(y, mo + n, 1);
    setMonth(`${d.getFullYear()}-${d.getMonth()}`);
  };
  // Months that have anything in them (October to June).
  const seasonStart = dayDate(c.season, 0);
  const seasonEnd = dayDate(c.season, c.lastRegularDay + 75);
  const canBack = new Date(y, mo, 1) > new Date(seasonStart.getFullYear(), seasonStart.getMonth(), 1);
  const canFwd = new Date(y, mo + 1, 1) <= seasonEnd;
  const milestonesOn = (day: number) => c.milestones.filter((m) => m.day === day);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">
          {c.season}-{String(c.season + 1).slice(2)} calendar
        </h1>
        <span className="text-sm text-ice-400">{inSeason ? `Today: ${dayLabel(c.season, today, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'The offseason'}</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card
          title={first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          action={
            <div className="flex gap-1">
              <Button variant="ghost" className="px-2 py-0.5 text-xs" disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous month">
                ←
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-0.5 text-xs"
                onClick={() => {
                  setMonth(null);
                  setSelected(null);
                }}
              >
                Today
              </Button>
              <Button variant="ghost" className="px-2 py-0.5 text-xs" disabled={!canFwd} onClick={() => shift(1)} aria-label="Next month">
                →
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />;
              const day = dayOfDate.get(date.toDateString());
              const games = day !== undefined ? (c.days[day] ?? []) : [];
              const mine = games.find((g) => c.myTeamId && (g[1] === c.myTeamId || g[2] === c.myTeamId));
              const ms = day !== undefined ? milestonesOn(day) : [];
              const isToday = inSeason && day === today;
              const past = day !== undefined && (day < today || !inSeason);
              return (
                <button
                  key={i}
                  disabled={day === undefined}
                  onClick={() => day !== undefined && setSelected(day)}
                  className={cx(
                    'flex min-h-20 flex-col items-stretch gap-0.5 rounded-md border p-1 text-left transition sm:min-h-24 sm:p-1.5',
                    day === undefined ? 'border-transparent opacity-30' : 'border-rink-700 hover:border-blueline',
                    day === focusDay && selected !== null && 'border-blueline bg-blueline/10',
                    isToday && 'ring-2 ring-warn',
                    past && 'bg-rink-900/60',
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className={cx('text-xs font-semibold', isToday ? 'text-warn' : past ? 'text-ice-500' : 'text-ice-200')}>{date.getDate()}</span>
                    {games.length > 0 && <span className="hidden text-[10px] text-ice-500 sm:inline">{games.length}g</span>}
                  </span>
                  {mine && <MyGame g={mine} myTeamId={c.myTeamId!} />}
                  {ms.map((m) => (
                    <span key={m.label} className={cx('truncate rounded px-1 text-[10px] font-semibold ring-1', KIND_TONE[m.kind])} title={m.label}>
                      {m.label}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <DayPanel c={c} day={focusDay} />
          <Card title="Key dates">
            <ul className="space-y-1.5 text-sm">
              {c.milestones.map((m) => (
                <li key={m.label + m.day}>
                  <button
                    className={cx('flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-rink-800', m.day < today && inSeason && 'opacity-60')}
                    onClick={() => {
                      setSelected(m.day);
                      const d = dayDate(c.season, m.day);
                      setMonth(`${d.getFullYear()}-${d.getMonth()}`);
                    }}
                  >
                    <span className="w-24 shrink-0 text-xs text-ice-400">{dayLabel(c.season, m.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span className={cx('rounded px-1.5 text-xs font-semibold ring-1', KIND_TONE[m.kind])}>{m.label}</span>
                    {inSeason && m.day > today && <span className="ml-auto text-[11px] text-ice-500">in {m.day - today}d</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 mb-1.5 text-xs font-semibold tracking-wider text-ice-400 uppercase">Then the offseason</p>
            <ol className="space-y-1 text-sm">
              {c.offseason.map((o, i) => (
                <li key={o.label} className="flex gap-2">
                  <span className="w-4 text-ice-500">{i + 1}</span>
                  <span>
                    <span className="font-semibold text-ice-100">{o.label}</span> <span className="text-xs text-ice-400">· {o.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MyGame({ g, myTeamId }: { g: Game; myTeamId: string }) {
  const team = useTeamById();
  const [, home, away, hs, as, ot] = g;
  const isHome = home === myTeamId;
  const opp = team(isHome ? away : home);
  const played = hs !== null && as !== null;
  const mine = isHome ? hs! : as!;
  const theirs = isHome ? as! : hs!;
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span className="text-ice-500">{isHome ? 'vs' : '@'}</span>
      {opp && <TeamChip team={opp} size="sm" />}
      <span className="hidden font-semibold text-ice-100 sm:inline">{opp?.abbr}</span>
      {played && (
        <span className={cx('ml-auto font-semibold', mine > theirs ? 'text-win' : 'text-red-300')}>
          {mine > theirs ? 'W' : ot ? (ot === 2 ? 'SOL' : 'OTL') : 'L'}
          <span className="hidden sm:inline">
            {' '}
            {mine}-{theirs}
          </span>
        </span>
      )}
    </span>
  );
}

function DayPanel({ c, day }: { c: Cal; day: number }) {
  const L = useLeague();
  const team = useTeamById();
  const sim = useSim();
  const games = c.days[day] ?? [];
  const inSeason = c.phase !== 'offseason';
  const ahead = inSeason ? day - c.today : -1;
  const busy = sim.running || sim.starting || !!L.simcast?.live;
  const sorted = [...games].sort((a, b) => Number(b[1] === c.myTeamId || b[2] === c.myTeamId) - Number(a[1] === c.myTeamId || a[2] === c.myTeamId));
  const ms = c.milestones.filter((m) => m.day === day);
  return (
    <Card title={dayLabel(c.season, day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>
      {ms.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ms.map((m) => (
            <span key={m.label} className={cx('rounded px-1.5 py-0.5 text-xs font-semibold ring-1', KIND_TONE[m.kind])}>
              {m.label}
            </span>
          ))}
        </div>
      )}
      {games.length === 0 ? (
        <Empty>No games{day > c.lastRegularDay ? ' (playoff games are scheduled round by round)' : ''}.</Empty>
      ) : (
        <ul className="space-y-1">
          {sorted.map(([id, home, away, hs, as, ot]) => {
            const h = team(home);
            const a = team(away);
            const played = hs !== null;
            const mine = home === c.myTeamId || away === c.myTeamId;
            return (
              <li key={id} className={cx('flex items-center gap-2 rounded px-1.5 py-1 text-sm', mine && 'bg-goal/10 ring-1 ring-goal/30')}>
                {a && <TeamChip team={a} size="sm" />}
                <span className={cx('w-10 font-semibold', played && as! > hs! ? 'text-white' : 'text-ice-300')}>{a?.abbr}</span>
                <span className="tabular w-10 text-center text-ice-100">{played ? `${as}-${hs}` : '@'}</span>
                <span className={cx('w-10 font-semibold', played && hs! > as! ? 'text-white' : 'text-ice-300')}>{h?.abbr}</span>
                {h && <TeamChip team={h} size="sm" />}
                <span className="ml-auto text-xs text-ice-500">
                  {played ? (
                    <Link to={`/league/${L.id}/game/${id}`} className="hover:text-ice-200 hover:underline">
                      {ot === 2 ? 'SO' : ot === 1 ? 'OT' : 'Final'}
                    </Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {inSeason && ahead > 0 && L.canAdvance && (
        <div className="mt-4 border-t border-rink-700 pt-3">
          <Button disabled={busy} onClick={() => sim.start({ days: ahead })}>
            ▶ Sim to this date ({ahead} day{ahead > 1 ? 's' : ''})
          </Button>
          <p className="mt-1.5 text-xs text-ice-400">Stops the morning of {dayLabel(c.season, day, { month: 'short', day: 'numeric' })}, before its games, so you can set lines or simcast one.</p>
        </div>
      )}
      {inSeason && ahead === 0 && <Badge tone="info">Today</Badge>}
    </Card>
  );
}
