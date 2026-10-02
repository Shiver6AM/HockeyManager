/**
 * Simcast: watch a game play by play on a rink, with everyone else in the
 * league who joins. Shots and goals appear where they were taken; the home
 * team's logo is at center ice.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, Spinner, TeamChip } from '../components/ui';
import { TeamLogo } from '../components/TeamLogo';
import { trpcClient, useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Wire = NonNullable<Outputs['simcast']['state']>;
/** What the page shows: every play so far (the server sends only new ones each second) and the latest box score. */
type View = Omit<Wire, 'box'> & { box: NonNullable<Wire['box']> };
type Play = View['plays'][number];
type TeamV = View['home'];

/**
 * Follows the simcast: asks once a second for the plays it doesn't have yet
 * (a few hundred bytes, instead of the whole game every time).
 */
function useSimcast(leagueId: string) {
  const [view, setView] = useState<View | null | undefined>(undefined);
  const have = useRef<{ sid: string; plays: Play[]; box: View['box'] } | null>(null);
  const refresh = useCallback(async () => {
    const h = have.current;
    const r = await trpcClient.simcast.state.query({ leagueId, sid: h?.sid, after: h?.plays.length });
    if (!r) {
      have.current = null;
      setView(null);
      return null;
    }
    const same = h && h.sid === r.sid;
    const plays = same ? (r.plays.length || r.from !== h.plays.length ? [...h.plays.slice(0, r.from), ...r.plays] : h.plays) : r.plays;
    const box = r.box ?? (same ? h.box : null);
    if (!box || (!same && r.from !== 0)) {
      // Out of step (a new simcast started): start over.
      have.current = null;
      return null;
    }
    have.current = { sid: r.sid, plays, box };
    const v = { ...r, plays, box };
    setView(v);
    return v;
  }, [leagueId]);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      let v: View | null = null;
      try {
        v = await refresh();
      } catch {
        /* a blip: try again */
      }
      // (No simcast on, or it's over: no need to ask every second.)
      if (!stop) timer = setTimeout(loop, v && !v.done ? 1000 : 4000);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  return { view, refresh };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function SimcastPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { view: v, refresh } = useSimcast(L.id);
  const games = useQuery({ ...trpc.simcast.games.queryOptions({ leagueId: L.id }), enabled: v === null });
  const start = useMutation(
    trpc.simcast.start.mutationOptions({
      onSuccess: () => {
        void refresh();
        void qc.invalidateQueries();
      },
    }),
  );
  // Someone else started (or ended) a simcast: the league overview says so before the next slow check.
  const liveGame = L.simcast?.live ? L.simcast.gameId : null;
  useEffect(() => {
    void refresh();
  }, [liveGame, refresh]);
  if (v === undefined) return <Spinner />;
  if (v) return <Broadcast v={v} refresh={refresh} />;

  const g = games.data;
  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Simcast</h1>
      <Card title="Watch a game live">
        <p className="mb-3 text-sm text-ice-300">
          Pick one of the next game day's games to watch play by play. Everyone in the league can join from the top of the screen. While it's on,
          the league can't sim; when it ends, the game counts exactly as you saw it.
        </p>
        <ErrorBox error={start.error} />
        {!g ? (
          <Spinner />
        ) : g.games.length === 0 ? (
          <Empty>{g.phase === 'offseason' ? 'No games in the offseason.' : 'No games on the next game day.'}</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {g.games.map((x) => (
              <li key={x.id}>
                <button
                  disabled={start.isPending}
                  onClick={() => start.mutate({ leagueId: L.id, gameId: x.id })}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:border-blueline hover:bg-rink-800 disabled:opacity-60',
                    x.mine ? 'border-goal/60 bg-goal/5' : 'border-rink-600 bg-rink-900',
                  )}
                >
                  <TeamChip team={x.away} />
                  <span className="flex-1 text-sm">
                    <span className="block font-semibold text-white">
                      {x.away.abbr} @ {x.home.abbr}
                    </span>
                    <span className="block text-xs text-ice-400">
                      {x.away.city} at {x.home.city}
                      {x.gameNumber ? ` · game ${x.gameNumber}` : ''}
                      {x.watched ? ' · watched' : ''}
                    </span>
                  </span>
                  <TeamChip team={x.home} />
                  <span className="text-xs font-semibold text-blueline">▶ Watch</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Broadcast({ v, refresh }: { v: View; refresh: () => Promise<unknown> }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const control = useMutation(
    trpc.simcast.control.mutationOptions({
      onSuccess: () => {
        void refresh();
        void qc.invalidateQueries({ queryKey: trpc.leagues.overview.queryKey({ leagueId: L.id }) });
      },
    }),
  );
  const act = (action: 'speed' | 'pause' | 'resume' | 'skip-period' | 'skip-end' | 'end', speed?: number) => control.mutate({ leagueId: L.id, action, speed });
  const canRun = v.canControl;
  // Follows the period being played unless the viewer picks another one (or all of them).
  const [picked, setPeriod] = useState<number | 'all' | null>(null);
  const period = picked ?? v.period;
  const feedRef = useRef<HTMLOListElement>(null);
  const plays = v.plays;
  const last = plays[plays.length - 1];
  const lastGoal = [...plays].reverse().find((p) => p.type === 'goal');
  const [flash, setFlash] = useState<Play | null>(null);
  // The last goal already shown when this viewer joined isn't celebrated again.
  const seenGoal = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (seenGoal.current === undefined) {
      seenGoal.current = lastGoal?.t ?? null;
      return;
    }
    if (!lastGoal || seenGoal.current === lastGoal.t) return;
    seenGoal.current = lastGoal.t;
    setFlash(lastGoal);
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [lastGoal, plays.length]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 });
  }, [plays.length]);
  const inPeriod = (p: Play) => period === 'all' || p.period === period;
  const shotsOnRink = plays.filter((p) => p.x != null && inPeriod(p));
  const periods = [...new Set(plays.map((p) => p.period))];
  const teamOf = (side: 'home' | 'away' | null) => (side === 'home' ? v.home : side === 'away' ? v.away : null);
  const awayColor = useAwayColor(v.home, v.away);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Simcast</h1>
        {v.done ? <Badge>Final</Badge> : v.paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="bad">● Live</Badge>}
        {v.seriesNote && <span className="text-xs text-ice-400">{v.seriesNote}</span>}
        <span className="ml-auto text-xs text-ice-400" title={v.viewers.join(', ')}>
          Started by {v.host} · {v.viewers.length} watching{v.viewers.length ? `: ${v.viewers.slice(0, 4).join(', ')}${v.viewers.length > 4 ? '…' : ''}` : ''}
        </span>
      </div>

      <Scoreboard v={v} />
      <SituationBar v={v} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-3">
          <div className="relative">
            <Rink home={v.home} away={v.away} plays={shotsOnRink} latest={last} />
            {flash && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="animate-[goalpop_3.5s_ease-out_forwards] rounded-xl border-2 border-goal bg-rink-950/90 px-6 py-3 text-center shadow-2xl">
                  <div className="flex items-center justify-center gap-3">
                    {teamOf(flash.side) && <TeamChip team={teamOf(flash.side)!} size="lg" />}
                    <p className="font-display text-4xl font-bold tracking-widest text-goal uppercase">Goal!</p>
                  </div>
                  <p className="mt-1 text-sm text-white">{flash.player}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ice-400">
            <span className="flex items-center gap-1.5">
              <Dot kind="goal" color="#f5f7fa" /> Goal
            </span>
            <span className="flex items-center gap-1.5">
              <Dot kind="shot" color="#f5f7fa" /> Save
            </span>
            <span className="flex items-center gap-1.5">
              <Dot kind="miss" color="#f5f7fa" /> Missed / blocked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: awayColor }} /> {v.away.abbr}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.home.colors[0] }} /> {v.home.abbr}
            </span>
            <span className="ml-auto flex gap-1">
              {([...periods, 'all'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p === v.period ? null : p)}
                  className={cx('rounded px-2 py-0.5', period === p ? 'bg-blueline text-white' : 'bg-rink-800 hover:bg-rink-700')}
                  title={p === 'all' ? 'Every period' : p === v.period ? 'The period being played (follows the game)' : undefined}
                >
                  {p === 'all' ? 'All' : p <= 3 ? `P${p}` : p === 4 ? 'OT' : `${p - 3}OT`}
                </button>
              ))}
            </span>
          </div>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {canRun ? (
                <>
                  {!v.done &&
                    (v.paused ? (
                      <Button onClick={() => act('resume')} disabled={control.isPending}>
                        ▶ Resume
                      </Button>
                    ) : (
                      <Button variant="ghost" onClick={() => act('pause')} disabled={control.isPending}>
                        ❚❚ Pause
                      </Button>
                    ))}
                  {!v.done && (
                    <div className="flex overflow-hidden rounded-lg border border-rink-600">
                      {v.speeds.map((s) => (
                        <button
                          key={s}
                          onClick={() => act('speed', s)}
                          className={cx('px-2.5 py-1 text-sm', v.speed === s ? 'bg-blueline text-white' : 'text-ice-300 hover:bg-rink-800')}
                        >
                          {s}×
                        </button>
                      ))}
                    </div>
                  )}
                  {!v.done && (
                    <Button variant="ghost" onClick={() => act('skip-period')} disabled={control.isPending}>
                      ⏭ Skip {v.intermission ? 'intermission' : 'period'}
                    </Button>
                  )}
                  {!v.done && (
                    <Button variant="ghost" onClick={() => act('skip-end')} disabled={control.isPending}>
                      Skip to final
                    </Button>
                  )}
                  <Button variant="ghost" className="ml-auto" onClick={() => act('end')} disabled={control.isPending}>
                    {v.done ? 'Close simcast' : 'End simcast'}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-ice-400">
                  {v.host} is running this simcast ({v.speed}× speed). {v.done ? 'The game is over.' : ''}
                </p>
              )}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded bg-rink-800">
              <div className="h-full bg-blueline transition-all duration-1000" style={{ width: `${v.progress * 100}%` }} />
            </div>
            <ErrorBox error={control.error} />
            {v.done && (
              <p className="mt-2 text-xs text-ice-400">
                The result stands when the league sims this day.{' '}
                <Link to={`/league/${L.id}/scores`} className="text-ice-200 hover:underline">
                  Scores
                </Link>
              </p>
            )}
          </Card>
        </div>

        <Card title="Play by play">
          <ol ref={feedRef} className="max-h-[36rem] space-y-1 overflow-y-auto pr-1 text-sm">
            {[...plays].filter(inPeriod).reverse().map((p, i) => {
              const team = teamOf(p.side);
              const big = p.type === 'goal' || p.type === 'period-start' || p.type === 'period-end' || p.type === 'final' || p.type === 'shootout';
              return (
                <li
                  key={`${p.t}-${i}`}
                  className={cx(
                    'flex items-start gap-2 rounded px-1.5 py-1',
                    p.type === 'goal' && 'bg-goal/15 ring-1 ring-goal/40',
                    (p.type === 'period-start' || p.type === 'period-end' || p.type === 'final') && 'bg-rink-800',
                    i === 0 && 'animate-[fadein_0.4s_ease-out]',
                  )}
                >
                  <span className="tabular w-14 shrink-0 text-xs text-ice-500">
                    {p.period <= 3 ? `P${p.period}` : 'OT'} {mmss((p.period <= 3 || v.playoff ? 1200 : 300) - p.clock)}
                  </span>
                  {team ? <TeamChip team={team} size="sm" /> : <span className="w-5" />}
                  <span className={cx('flex-1', big ? 'font-semibold text-white' : p.type === 'penalty' || p.type === 'fight' ? 'text-warn' : 'text-ice-200')}>
                    {p.text}
                    {(p.type === 'goal' || p.type === 'final' || p.type === 'period-end') && (
                      <span className="ml-1 text-xs font-normal text-ice-400">
                        ({v.away.abbr} {p.awayScore}, {v.home.abbr} {p.homeScore})
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <BoxScoreCard v={v} />
    </div>
  );
}

/** Power plays (with the time left) and empty nets. */
function SituationBar({ v }: { v: View }) {
  const pen = v.penalties;
  if ((!pen && !v.emptyNet) || v.done) return null;
  const team = (side: 'home' | 'away') => (side === 'home' ? v.home : v.away);
  const items: React.ReactNode[] = [];
  if (pen) {
    const h = Math.min(2, pen.home.length);
    const a = Math.min(2, pen.away.length);
    const hMen = 5 - h;
    const aMen = 5 - a;
    const clock = (xs: number[]) => mmss(Math.min(...xs.slice(0, 2)));
    if (h === a) {
      items.push(
        <span key="even" className="rounded-md bg-rink-800 px-2.5 py-1 text-sm font-semibold text-ice-100">
          {hMen} on {aMen} · <span className="tabular">{clock([...pen.home, ...pen.away])}</span>
        </span>,
      );
    } else {
      const pp: 'home' | 'away' = h > a ? 'away' : 'home';
      const short = pp === 'home' ? pen.away : pen.home;
      items.push(
        <span key="pp" className="inline-flex items-center gap-2 rounded-md bg-warn/15 px-2.5 py-1 text-sm font-semibold text-warn ring-1 ring-warn/40">
          <TeamChip team={team(pp)} size="sm" /> Power play {team(pp).abbr} · {Math.max(hMen, aMen)} on {Math.min(hMen, aMen)} ·{' '}
          <span className="tabular font-display text-base">{clock(short)}</span>
        </span>,
      );
    }
  }
  if (v.emptyNet) {
    items.push(
      <span key="en" className="inline-flex animate-pulse items-center gap-2 rounded-md bg-goal/15 px-2.5 py-1 text-sm font-semibold text-red-200 ring-1 ring-goal/50">
        <TeamChip team={team(v.emptyNet)} size="sm" /> Empty net: {team(v.emptyNet).abbr} goalie pulled for an extra attacker
      </span>,
    );
  }
  return <div className="flex flex-wrap items-center justify-center gap-2">{items}</div>;
}

function BoxScoreCard({ v }: { v: View }) {
  const [tab, setTab] = useState<'away' | 'home'>('away');
  const t = tab === 'home' ? v.home : v.away;
  const b = v.box[tab];
  const f = v.box.final;
  return (
    <Card
      title={f ? 'Box score' : 'Box score (so far)'}
      action={
        <div className="flex overflow-hidden rounded-lg border border-rink-600 text-xs">
          {(['away', 'home'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-1.5 px-2.5 py-1', tab === k ? 'bg-blueline text-white' : 'text-ice-300 hover:bg-rink-800')}>
              <TeamChip team={k === 'home' ? v.home : v.away} size="sm" /> {(k === 'home' ? v.home : v.away).abbr}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="-mx-4 overflow-x-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>{t.abbr} skaters</th>
                <th>Pos</th>
                <th className="num">G</th>
                <th className="num">A</th>
                <th className="num">P</th>
                {f && <th className="num">+/-</th>}
                <th className="num">SOG</th>
                <th className="num">Hits</th>
                <th className="num">Blk</th>
                <th className="num">PIM</th>
                {f && <th className="num">TOI</th>}
              </tr>
            </thead>
            <tbody>
              {b.skaters.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{p.name}</td>
                  <td className="text-ice-400">{p.pos}</td>
                  <td className="num">{p.g || ''}</td>
                  <td className="num">{p.a || ''}</td>
                  <td className="num font-semibold text-white">{p.p || ''}</td>
                  {f && <td className={cx('num', (p.pm ?? 0) > 0 ? 'text-win' : (p.pm ?? 0) < 0 ? 'text-red-300' : '')}>{p.pm ? (p.pm > 0 ? `+${p.pm}` : p.pm) : ''}</td>}
                  <td className="num">{p.sog || ''}</td>
                  <td className="num">{p.hits || ''}</td>
                  <td className="num">{p.blk || ''}</td>
                  <td className="num">{p.pim || ''}</td>
                  {f && <td className="num text-ice-300">{p.toi != null ? mmss(p.toi) : ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <table className="table text-xs">
            <thead>
              <tr>
                <th>Goalies</th>
                <th className="num">SA</th>
                <th className="num">SV</th>
                <th className="num">GA</th>
                <th className="num">SV%</th>
              </tr>
            </thead>
            <tbody>
              {b.goalies.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{g.name}</td>
                  <td className="num">{g.sa}</td>
                  <td className="num">{g.sv}</td>
                  <td className="num">{g.ga}</td>
                  <td className="num">{g.sa ? (g.sv / g.sa).toFixed(3).replace(/^0/, '') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function Scoreboard({ v }: { v: View }) {
  const side = (t: TeamV, score: number, shots: number, align: 'left' | 'right') => (
    <div className={cx('flex min-w-0 items-center gap-1.5 sm:gap-3', align === 'right' && 'flex-row-reverse text-right')}>
      <span className="sm:hidden">
        <TeamChip team={t} size="md" />
      </span>
      <span className="hidden sm:inline">
        <TeamChip team={t} size="lg" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="hidden truncate text-xs tracking-wider text-ice-400 uppercase sm:block">{t.city}</p>
        <p className="truncate font-display text-base font-semibold text-white uppercase sm:text-lg">
          <span className="sm:hidden">{t.abbr}</span>
          <span className="hidden sm:inline">{t.name}</span>
        </p>
        <p className="text-[11px] whitespace-nowrap text-ice-400 sm:text-xs">SOG {shots}</p>
      </div>
      <p className="tabular px-1 font-display text-3xl font-bold text-white sm:px-3 sm:text-5xl">{score}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-rink-600 bg-gradient-to-b from-rink-800 to-rink-900 p-3 sm:gap-4 sm:p-4">
      {side(v.away, v.awayScore, v.awayShots, 'left')}
      <div className="w-20 text-center sm:w-28">
        <p className="text-[10px] font-semibold tracking-wider text-ice-400 uppercase sm:text-[11px]">{v.done ? 'Final' : v.intermission ? 'Intermission' : v.periodName}</p>
        {!v.done && <p className="tabular font-display text-2xl text-warn sm:text-3xl">{v.intermission ? '0:00' : mmss(v.timeLeft)}</p>}
      </div>
      {side(v.home, v.homeScore, v.homeShots, 'right')}
    </div>
  );
}

/** Shot markers: a filled puck-star for goals, a ring for saves, a small cross for misses and blocks. */
function Dot({ kind, color }: { kind: 'goal' | 'shot' | 'miss'; color: string }) {
  return (
    <svg viewBox="-3 -3 6 6" width={12} height={12}>
      <Marker kind={kind} color={color} x={0} y={0} />
    </svg>
  );
}

function Marker({ kind, color, x, y, big }: { kind: 'goal' | 'shot' | 'miss'; color: string; x: number; y: number; big?: boolean }) {
  const r = big ? 1.4 : 1;
  if (kind === 'goal')
    return (
      <g transform={`translate(${x} ${y}) scale(${r})`}>
        <circle r={2.4} fill={color} stroke="#0e1116" strokeWidth={0.5} />
        <path d="M0 -1.5 L0.45 -0.45 L1.5 -0.45 L0.65 0.2 L0.95 1.3 L0 0.65 L-0.95 1.3 L-0.65 0.2 L-1.5 -0.45 L-0.45 -0.45 Z" fill="#fff" />
      </g>
    );
  if (kind === 'shot') return <circle cx={x} cy={y} r={1.3 * r} fill="none" stroke={color} strokeWidth={0.7} />;
  return (
    <g transform={`translate(${x} ${y})`} stroke={color} strokeWidth={0.55} opacity={0.75}>
      <line x1={-0.9} y1={-0.9} x2={0.9} y2={0.9} />
      <line x1={-0.9} y1={0.9} x2={0.9} y2={-0.9} />
    </g>
  );
}

function colorDistance(a: string, b: string) {
  const rgb = (h: string) => {
    const x = h.replace('#', '');
    const n = parseInt(x.length === 3 ? x.replace(/./g, (c) => c + c) : x, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [p, q] = [rgb(a), rgb(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** A regulation rink (200 × 85 ft), center ice at the origin. */
/** Marker colors: two teams in similar colors, the away team uses its second color (or grey). */
function useAwayColor(home: TeamV, away: TeamV) {
  return useMemo(() => {
    const [a1, a2] = away.colors;
    if (colorDistance(a1, home.colors[0]) > 90) return a1;
    return a2 && colorDistance(a2, home.colors[0]) > 90 ? a2 : '#8a96a8';
  }, [home, away]);
}

/** Every shot is drawn as if the home team attacked the right-hand net all game (they switch ends each period). */
const shown = (p: Play) => (p.period % 2 === 1 ? { x: p.x!, y: p.y! } : { x: -p.x!, y: -p.y! });

function Rink({ home, away, plays, latest }: { home: TeamV; away: TeamV; plays: Play[]; latest?: Play }) {
  const awayColor = useAwayColor(home, away);
  const RED = '#c8102e';
  const BLUE = '#1f4fbf';
  const colorOf = (side: 'home' | 'away' | null) => (side === 'home' ? home.colors[0] : awayColor);
  const markers = useMemo(() => plays.filter((p) => p.type === 'goal' || p.type === 'shot' || p.type === 'miss' || p.type === 'block'), [plays]);
  return (
    <svg viewBox="-102 -45 204 90" className="w-full rounded-xl bg-rink-900" role="img" aria-label={`Rink: ${away.city} at ${home.city}`}>
      <defs>
        <clipPath id="rink-clip">
          <rect x={-100} y={-42.5} width={200} height={85} rx={28} />
        </clipPath>
        <radialGradient id="ice" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3ecf5" />
        </radialGradient>
      </defs>
      <rect x={-100} y={-42.5} width={200} height={85} rx={28} fill="url(#ice)" />
      <g clipPath="url(#rink-clip)">
        {/* Goal lines, blue lines, center line */}
        {[-89, 89].map((x) => (
          <line key={x} x1={x} y1={-42.5} x2={x} y2={42.5} stroke={RED} strokeWidth={0.35} />
        ))}
        {[-25, 25].map((x) => (
          <rect key={x} x={x - 0.5} y={-42.5} width={1} height={85} fill={BLUE} />
        ))}
        <rect x={-0.5} y={-42.5} width={1} height={85} fill={RED} />
        {/* Center ice: the home team's logo */}
        <circle r={15} fill="none" stroke={BLUE} strokeWidth={0.35} />
        <g opacity={0.9}>
          <svg x={-12} y={-12} width={24} height={24} viewBox="0 0 100 100" overflow="visible">
            <TeamLogo team={home} size={100} />
          </svg>
        </g>
        {/* Faceoff circles and dots */}
        {[-69, 69].map((x) =>
          [-22, 22].map((y) => (
            <g key={`${x}${y}`}>
              <circle cx={x} cy={y} r={15} fill="none" stroke={RED} strokeWidth={0.35} />
              <circle cx={x} cy={y} r={1} fill={RED} />
            </g>
          )),
        )}
        {[-20, 20].map((x) => [-22, 22].map((y) => <circle key={`n${x}${y}`} cx={x} cy={y} r={1} fill={RED} />))}
        {/* Creases and nets */}
        {[-1, 1].map((d) => (
          <g key={d}>
            <path d={`M ${d * 89} -4 A 6 6 0 0 ${d > 0 ? 0 : 1} ${d * 89} 4 Z`} fill="#8fc1f0" fillOpacity={0.55} stroke={RED} strokeWidth={0.3} />
            <rect x={d > 0 ? 89 : -92.3} y={-3} width={3.3} height={6} fill="none" stroke="#444" strokeWidth={0.5} />
          </g>
        ))}
        {/* Shots are drawn with each team attacking one end all game */}
        <text x={50} y={-37} textAnchor="middle" fontSize={3.4} fontWeight={700} fill={colorOf('home')} opacity={0.75}>
          {home.abbr} shots →
        </text>
        <text x={-50} y={-37} textAnchor="middle" fontSize={3.4} fontWeight={700} fill={colorOf('away')} opacity={0.75}>
          ← {away.abbr} shots
        </text>
        {/* Shots */}
        {markers.map((p, i) => {
          const kind = p.type === 'goal' ? 'goal' : p.type === 'shot' ? 'shot' : 'miss';
          const isLatest = latest && p.t === latest.t && p.type === latest.type;
          const { x, y } = shown(p);
          return (
            <g key={`${p.t}-${i}`}>
              {isLatest && <circle cx={x} cy={y} r={4.5} fill="none" stroke={colorOf(p.side)} strokeWidth={0.5} className="animate-ping" style={{ transformOrigin: `${x}px ${y}px` }} />}
              <Marker kind={kind} color={colorOf(p.side)} x={x} y={y} big={kind === 'goal'} />
              <title>{p.text}</title>
            </g>
          );
        })}
      </g>
      <rect x={-100} y={-42.5} width={200} height={85} rx={28} fill="none" stroke="#6b7a8c" strokeWidth={0.9} />
    </svg>
  );
}
