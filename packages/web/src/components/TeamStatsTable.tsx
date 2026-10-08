/** Every team's season in one sortable table: scoring, shots, power play, penalty kill, penalties, faceoffs. */
import { useQuery } from '@tanstack/react-query';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { Card, cx, Empty, Spinner, TeamLink } from './ui';

type Row = Outputs['data']['teamStats']['teams'][number];

const per = (n: number, gp: number) => (gp ? n / gp : null);
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}`);
const dec = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));

export function TeamStatsTable({ leagueId, myTeamId }: { leagueId: string; myTeamId: string | null }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.data.teamStats.queryOptions({ leagueId }));
  const rows = q.data?.teams ?? [];
  const { sorted, Th } = useSort(
    rows,
    {
      team: (r) => `${r.team.city} ${r.team.name}`,
      gp: (r) => r.gp,
      pts: (r) => r.pts,
      gf: (r) => per(r.gf, r.gp),
      ga: (r) => (r.gp ? -r.ga / r.gp : null),
      pp: (r) => r.ppPct,
      ppg: (r) => r.ppg,
      pk: (r) => r.pkPct,
      ppga: (r) => (r.tsh ? -r.ppga : null),
      sf: (r) => per(r.sf, r.games),
      sa: (r) => (r.games ? -r.sa / r.games : null),
      pim: (r) => per(r.pim, r.games),
      fo: (r) => (r.fo ? r.fow / r.fo : null),
    },
    { key: 'pp' },
    'team-stats',
  );
  if (!q.data) return <Spinner />;
  const d = q.data;
  const partial = d.coverage.games < d.coverage.played;
  return (
    <Card
      title={`Team stats · ${d.season}-${String(d.season + 1).slice(2)}${d.over ? ' regular season' : ''}`}
      action={<span className="text-xs text-ice-400">Click a column to sort</span>}
    >
      {!d.coverage.played ? (
        <Empty>No games played yet this season.</Empty>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <Th k="team">Team</Th>
                  <Th k="gp" className="num">GP</Th>
                  <Th k="pts" className="num">PTS</Th>
                  <Th k="gf" className="num" title="Goals for per game">GF/GP</Th>
                  <Th k="ga" className="num" title="Goals against per game">GA/GP</Th>
                  <Th k="pp" className="num" title="Power-play percentage: power-play goals ÷ power-play opportunities">PP%</Th>
                  <Th k="ppg" className="num" title="Power-play goals / opportunities">PP</Th>
                  <Th k="pk" className="num" title="Penalty-kill percentage: share of times shorthanded without allowing a goal">PK%</Th>
                  <Th k="ppga" className="num" title="Power-play goals allowed / times shorthanded">PK</Th>
                  <Th k="sf" className="num" title="Shots on goal per game">SF/GP</Th>
                  <Th k="sa" className="num" title="Shots against per game">SA/GP</Th>
                  <Th k="pim" className="num" title="Penalty minutes per game">PIM/GP</Th>
                  <Th k="fo" className="num" title="Faceoffs won">FO%</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r: Row, i) => (
                  <tr key={r.teamId} className={cx(myTeamId === r.teamId && 'bg-blueline/10')}>
                    <td className="tabular text-ice-500">{i + 1}</td>
                    <td className="whitespace-nowrap">
                      <TeamLink leagueId={leagueId} team={r.team} full />
                    </td>
                    <td className="num">{r.gp}</td>
                    <td className="num font-semibold text-white">{r.pts}</td>
                    <td className="num">{dec(per(r.gf, r.gp))}</td>
                    <td className="num">{dec(per(r.ga, r.gp))}</td>
                    <td className={cx('num font-semibold', rankTone(r.ppRank, rows.length))}>{pct(r.ppPct)}</td>
                    <td className="num text-ice-400">
                      {r.ppg}/{r.ppo}
                    </td>
                    <td className={cx('num font-semibold', rankTone(r.pkRank, rows.length))}>{pct(r.pkPct)}</td>
                    <td className="num text-ice-400">
                      {r.ppga}/{r.tsh}
                    </td>
                    <td className="num">{dec(per(r.sf, r.games), 1)}</td>
                    <td className="num">{dec(per(r.sa, r.games), 1)}</td>
                    <td className="num">{dec(per(r.pim, r.games), 1)}</td>
                    <td className="num">{pct(r.fo ? r.fow / r.fo : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-ice-500">
            Green: top 8 in the league; red: bottom 8.
            {partial && ` Shots, special teams, penalties and faceoffs cover ${d.coverage.games} of ${d.coverage.played} games played.`}
          </p>
        </>
      )}
    </Card>
  );
}

/** Top quarter green, bottom quarter red. */
export function rankTone(rank: number | null, teams: number) {
  if (!rank) return '';
  if (rank <= Math.round(teams / 4)) return 'text-win';
  if (rank > teams - Math.round(teams / 4)) return 'text-red-300';
  return 'text-ice-100';
}
