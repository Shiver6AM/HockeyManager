import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Spinner, TeamChip, TeamLink } from '../components/ui';
import { dayLabel, gaa, signed, svPct, toi } from '../format';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type Box = Outputs['data']['boxScore'];

const periodName = (p: number) => (p <= 3 ? `${['1st', '2nd', '3rd'][p - 1]} period` : p === 4 ? 'Overtime' : `${p - 3}OT`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function BoxScorePage() {
  const L = useLeague();
  const { gameId = '0' } = useParams();
  const trpc = useTRPC();
  const q = useQuery(trpc.data.boxScore.queryOptions({ leagueId: L.id, gameId: Number(gameId) }));
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const b = q.data;
  const g = b.game;
  const tag = g.shootout ? 'Final/SO' : g.overtime ? 'Final/OT' : 'Final';
  const periods = [...new Set(b.goals.map((x) => x.period))].sort();
  const allPeriods = [1, 2, 3, ...periods.filter((p) => p > 3)];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <ScoreSide team={g.away} score={g.awayScore} label="Away" />
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-ice-400 uppercase">{tag}</p>
            <p className="text-sm text-ice-300">{dayLabel(L.season, g.day, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            {g.seriesId && <Badge tone="bad">Playoffs · Game {g.gameNumber}</Badge>}
          </div>
          <ScoreSide team={g.home} score={g.homeScore} label="Home" right />
        </div>
        {b.home && b.away && (
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
            {[
              ['Shots', b.away.shots, b.home.shots],
              ['Power play', `${b.away.ppGoals}/${b.away.ppOpps}`, `${b.home.ppGoals}/${b.home.ppOpps}`],
              ['Faceoffs', b.away.fow, b.home.fow],
              ['Hits', b.away.hits, b.home.hits],
              ['Blocks', b.away.blocks, b.home.blocks],
              ['PIM', b.away.pim, b.home.pim],
            ].map(([label, a, h]) => (
              <div key={label as string} className="rounded-lg bg-rink-850 p-2">
                <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">{label}</p>
                <p className="tabular text-white">
                  {a} <span className="text-ice-500">–</span> {h}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Scoring" className="lg:col-span-2">
          {b.goals.length === 0 && <Empty>No goals.</Empty>}
          {allPeriods.map((p) => {
            const list = b.goals.filter((x) => x.period === p);
            if (!list.length && p > 3) return null;
            return (
              <div key={p} className="mb-3 last:mb-0">
                <p className="mb-1 text-xs font-semibold tracking-wider text-ice-400 uppercase">{periodName(p)}</p>
                {list.length === 0 ? (
                  <p className="text-sm text-ice-500">No scoring</p>
                ) : (
                  <ul className="space-y-1">
                    {list.map((x, i) => {
                      const team = x.teamId === g.home.id ? g.home : g.away;
                      return (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="tabular w-10 pt-0.5 text-ice-500">{clock(x.time)}</span>
                          <TeamChip team={team} size="sm" />
                          <span>
                            <span className="font-semibold text-white">{x.scorerName}</span>
                            <span className="text-ice-400"> {x.assistNames.length ? `(${x.assistNames.join(', ')})` : '(unassisted)'}</span>
                            {x.strength !== 'EV' && (
                              <Badge tone={x.strength === 'PP' ? 'info' : x.strength === 'SH' ? 'good' : 'neutral'}>{x.strength}</Badge>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {g.shootout && <p className="mt-2 text-sm text-ice-300">Decided in a shootout.</p>}
        </Card>
        <div className="space-y-5">
          <Card title="Three stars">
            <ol className="space-y-1.5 text-sm">
              {b.stars.map((s, i) => (
                <li key={s.id}>
                  <span className="mr-2 text-warn">{'★'.repeat(i + 1)}</span>
                  <Link to={`/league/${L.id}/player/${s.id}`} className="text-white hover:underline">
                    {s.name}
                  </Link>{' '}
                  <span className="text-ice-400">{s.teamId}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Penalties">
            {b.penalties.length ? (
              <ul className="space-y-1 text-sm">
                {b.penalties.map((p, i) => (
                  <li key={i} className="text-ice-300">
                    <span className="tabular text-ice-500">
                      P{p.period > 3 ? 'OT' : p.period} {clock(p.time)}
                    </span>{' '}
                    {p.teamId} · <span className="text-ice-100">{p.playerName}</span> · {p.infraction} ({p.minutes})
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None.</Empty>
            )}
          </Card>
          {b.injuries.length > 0 && (
            <Card title="Injuries">
              <ul className="space-y-1 text-sm">
                {b.injuries.map((x, i) => (
                  <li key={i} className="text-ice-300">
                    {x.teamId} · <span className="text-ice-100">{x.playerName}</span> · {x.type} ({x.severity})
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {(['away', 'home'] as const).map((side) => (
          <PlayerTables key={side} box={b} side={side} />
        ))}
      </div>
    </div>
  );
}

function ScoreSide({ team, score, label, right }: { team: Box['game']['home']; score: number | null; label: string; right?: boolean }) {
  const L = useLeague();
  return (
    <div className={`flex items-center gap-4 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <TeamChip team={team} size="lg" />
      <div>
        <p className="text-xs text-ice-500 uppercase">{label}</p>
        <TeamLink leagueId={L.id} team={team} full />
      </div>
      <span className="tabular font-display text-5xl font-semibold text-white">{score ?? '–'}</span>
    </div>
  );
}

function PlayerTables({ box, side }: { box: Box; side: 'home' | 'away' }) {
  const L = useLeague();
  const t = box[side];
  const team = box.game[side];
  const { sorted: skaters, Th } = useSort(
    t?.skaters ?? [],
    {
      name: (s) => s.name.split(' ').slice(-1)[0],
      // Forwards first, then defense, each by ice time.
      pos: (s) => (s.pos === 'D' ? 100000 : 0) - s.toi,
      g: (s) => s.g,
      a: (s) => s.a,
      pts: (s) => s.g + s.a,
      pm: (s) => s.pm,
      sog: (s) => s.sog,
      hits: (s) => s.hits,
      blk: (s) => s.blk,
      pim: (s) => s.pim,
      fo: (s) => (s.fow + s.fol ? s.fow / (s.fow + s.fol) : null),
      toi: (s) => s.toi,
    },
    { key: 'pos', dir: 'asc' },
  );
  const goalieSort = useSort(
    t?.goalies ?? [],
    {
      name: (g) => g.name.split(' ').slice(-1)[0],
      sa: (g) => g.sa,
      ga: (g) => g.ga,
      sv: (g) => (g.sa ? 1 - g.ga / g.sa : null),
      gaa: (g) => (g.toi ? -g.ga / g.toi : null),
      toi: (g) => g.toi,
      dec: (g) => g.decision ?? '',
    },
    { key: 'toi' },
  );
  const GTh = goalieSort.Th;
  if (!t) return null;
  return (
    <Card title={`${team.city} ${team.name}`}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Skater</Th>
              <Th k="pos" title="Forwards then defense, by ice time">Pos</Th>
              <Th k="g" className="num">G</Th>
              <Th k="a" className="num">A</Th>
              <Th k="pts" className="num">P</Th>
              <Th k="pm" className="num">+/-</Th>
              <Th k="sog" className="num">SOG</Th>
              <Th k="hits" className="num">HIT</Th>
              <Th k="blk" className="num">BLK</Th>
              <Th k="pim" className="num">PIM</Th>
              <Th k="fo" className="num">FO</Th>
              <Th k="toi" className="num">TOI</Th>
            </tr>
          </thead>
          <tbody>
            {skaters.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/league/${L.id}/player/${s.id}`} className="text-ice-50 hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="text-ice-400">{s.pos}</td>
                <td className="num">{s.g}</td>
                <td className="num">{s.a}</td>
                <td className="num font-semibold text-white">{s.g + s.a}</td>
                <td className="num">{signed(s.pm)}</td>
                <td className="num">{s.sog}</td>
                <td className="num">{s.hits}</td>
                <td className="num">{s.blk}</td>
                <td className="num">{s.pim}</td>
                <td className="num">{s.fow + s.fol ? `${s.fow}-${s.fol}` : ''}</td>
                <td className="num">{toi(s.toi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="table mt-2">
          <thead>
            <tr>
              <GTh k="name">Goalie</GTh>
              <GTh k="sa" className="num">SA</GTh>
              <GTh k="ga" className="num">GA</GTh>
              <GTh k="sv" className="num">SV%</GTh>
              <GTh k="gaa" className="num">GAA</GTh>
              <GTh k="toi" className="num">TOI</GTh>
              <GTh k="dec">Dec</GTh>
            </tr>
          </thead>
          <tbody>
            {goalieSort.sorted.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link to={`/league/${L.id}/player/${g.id}`} className="text-ice-50 hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className="num">{g.sa}</td>
                <td className="num">{g.ga}</td>
                <td className="num">{svPct(g.sa, g.ga)}</td>
                <td className="num">{gaa(g.ga, g.toi)}</td>
                <td className="num">{toi(g.toi)}</td>
                <td>{g.decision ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
