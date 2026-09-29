import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, ErrorBox, Spinner, TeamChip } from '../components/ui';
import { useTRPC } from '../trpc';
import { useLeague } from './LeagueLayout';

export function TeamsPage() {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const nav = useNavigate();
  const teams = useQuery(trpc.leagues.teams.queryOptions({ leagueId: L.id }));
  const claim = useMutation(
    trpc.leagues.claimTeam.mutationOptions({
      onSuccess: async (_r, vars) => {
        await qc.invalidateQueries();
        nav(`/league/${L.id}/team/${vars.teamId}`);
      },
    }),
  );
  if (!teams.data) return <Spinner />;
  const groups = new Map<string, typeof teams.data>();
  for (const t of teams.data) {
    const k = `${t.conference} · ${t.division}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Teams</h1>
        <p className="text-sm text-ice-400">
          {L.myTeamId
            ? 'You manage a team. Release it from the League page if you want a different one.'
            : 'Pick any unclaimed team to manage. Team rating is the average overall of the current lineup.'}
        </p>
      </div>
      <ErrorBox error={claim.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {[...groups].map(([name, list]) => (
          <Card key={name} title={name}>
            <ul className="-my-1 divide-y divide-rink-700/60">
              {list
                .sort((a, b) => b.rating - a.rating)
                .map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2">
                    <TeamChip team={t} size="lg" />
                    <Link to={`/league/${L.id}/team/${t.id}`} className="flex-1 truncate text-sm hover:underline">
                      {t.city} <span className="text-ice-400">{t.name}</span>
                    </Link>
                    <span className="tabular w-10 text-right text-sm text-ice-300" title="Team rating">
                      {t.rating.toFixed(1)}
                    </span>
                    <span className="w-28 text-right">
                      {t.manager ? (
                        <Badge tone={t.id === L.myTeamId ? 'good' : 'info'}>{t.id === L.myTeamId ? 'You' : t.manager}</Badge>
                      ) : !L.myTeamId ? (
                        <Button className="px-2 py-1 text-xs" onClick={() => claim.mutate({ leagueId: L.id, teamId: t.id })} disabled={claim.isPending}>
                          Manage
                        </Button>
                      ) : (
                        <span className="text-xs text-ice-500">AI</span>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
