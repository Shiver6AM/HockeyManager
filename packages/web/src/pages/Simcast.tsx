/**
 * Simcast: watch a game play by play on a rink, with everyone else in the
 * league who joins. Shots and goals appear where they were taken; the home
 * team's logo is at center ice.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Empty, ErrorBox, Spinner, TeamChip } from '../components/ui';
import { TeamLogo } from '../components/TeamLogo';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type View = NonNullable<Outputs['simcast']['state']>;
type Play = View['plays'][number];
type TeamV = View['home'];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function SimcastPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const state = useQuery({ ...trpc.simcast.state.queryOptions({ leagueId: L.id }), refetchInterval: 1000 });
  const games = useQuery({ ...trpc.simcast.games.queryOptions({ leagueId: L.id }), enabled: !state.data });
  const start = useMutation(trpc.simcast.start.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  if (state.isLoading) return <Spinner />;
  const v = state.data;
  if (v) return <Broadcast v={v} />;

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

function Broadcast({ v }: { v: View }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const control = useMutation(trpc.simcast.control.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const act = (action: 'speed' | 'pause' | 'resume' | 'skip-period' | 'skip-end' | 'end', speed?: number) => control.mutate({ leagueId: L.id, action, speed });
  const canRun = v.canControl;
  const [period, setPeriod] = useState<number | 'all'>('all');
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
  const shotsOnRink = plays.filter((p) => p.x != null && (period === 'all' || p.period === period));
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
              {(['all', ...periods] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cx('rounded px-2 py-0.5', period === p ? 'bg-blueline text-white' : 'bg-rink-800 hover:bg-rink-700')}
                >
                  {p === 'all' ? 'All' : p <= 3 ? `P${p}` : 'OT'}
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
            {[...plays].reverse().map((p, i) => {
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
    </div>
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
