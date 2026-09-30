/** A team's season in charts: points pace, rolling goals for/against, game-by-game goal differential. */
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../trpc';
import { ColumnChart, LineChart, SERIES } from './Charts';
import { Card, Empty, Spinner } from './ui';

export function TeamTrends({ leagueId, teamId, abbr }: { leagueId: string; teamId: string; abbr: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.data.teamTrends.queryOptions({ leagueId, teamId }));
  if (!q.data) return <Spinner />;
  const d = q.data;
  if (!d.games.length) return <Card><Empty>No games played yet this season.</Empty></Card>;
  const x = d.games.map((g) => g.n);
  const last = d.games[d.games.length - 1];
  // Compare at the latest game number the playoff line is known for.
  const li = d.playoffLine.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
  const vsLine = li >= 0 ? d.games[li].cum - d.playoffLine[li]! : 0;
  const pace = Math.round((last.cum / last.n) * d.totalGames);
  const diff = d.games.reduce((s, g) => s + g.gf - g.ga, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Points" value={String(last.cum)} note={`after ${last.n} games`} />
        <Stat label="Pace" value={String(pace)} note={`points over ${d.totalGames} games`} />
        <Stat
          label="Vs playoff line"
          value={li >= 0 ? `${vsLine >= 0 ? '+' : '−'}${Math.abs(vsLine)}` : '—'}
          note={li >= 0 ? `points vs the conference's 8th spot after ${li + 1} games` : 'not enough games yet'}
          tone={li < 0 ? undefined : vsLine >= 0 ? 'good' : 'bad'}
        />
        <Stat label="Goal differential" value={`${diff >= 0 ? '+' : '−'}${Math.abs(diff)}`} note={`${d.games.reduce((s, g) => s + g.gf, 0)} for, ${d.games.reduce((s, g) => s + g.ga, 0)} against`} tone={diff >= 0 ? 'good' : 'bad'} />
      </div>
      <Card title="Points pace">
        <p className="-mt-1 mb-2 text-xs text-ice-400">Points after each game, against the conference's 8th-place team and the league average at the same point.</p>
        <LineChart
          x={x}
          xLabel="Game"
          series={[
            { name: abbr, values: d.games.map((g) => g.cum), color: SERIES[0] },
            { name: 'Playoff line', values: d.playoffLine, color: SERIES[1] },
            { name: 'League average', values: d.leagueAvg, color: SERIES[2], reference: true },
          ]}
          height={260}
          fmt={(v) => String(Math.round(v))}
        />
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Goals for and against per game (10-game rolling)">
          <LineChart
            x={x}
            xLabel="Game"
            series={[
              { name: 'Goals for', values: d.gfRolling, color: SERIES[0] },
              { name: 'Goals against', values: d.gaRolling, color: SERIES[1] },
            ]}
            fmt={(v) => v.toFixed(1)}
            zeroBased
          />
        </Card>
        <Card title="Goal differential by game">
          <ColumnChart
            data={d.games.map((g) => ({ label: String(g.n), value: g.gf - g.ga, sub: `${g.home ? 'vs' : '@'} ${g.opp} ${g.gf}-${g.ga}${g.ot ? ' (OT/SO)' : ''}` }))}
            fmt={(v) => (v > 0 ? `+${v}` : String(v))}
            valueName="Goal differential"
          />
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-rink-700 bg-rink-900 p-3">
      <p className="text-xs text-ice-400">{label}</p>
      <p className="font-display text-3xl text-white">{value}</p>
      <p className={tone === 'good' ? 'text-xs text-win' : tone === 'bad' ? 'text-xs text-red-300' : 'text-xs text-ice-500'}>
        {tone === 'good' ? '▲ ' : tone === 'bad' ? '▼ ' : ''}
        {note}
      </p>
    </div>
  );
}
