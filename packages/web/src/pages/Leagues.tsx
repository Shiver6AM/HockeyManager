import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, Spinner, TeamChip } from '../components/ui';
import { dayLabel, PHASE_LABEL } from '../format';
import { useTRPC } from '../trpc';
import { Field } from './Login';

export function LeaguesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useQuery(trpc.auth.me.queryOptions());
  const leagues = useQuery(trpc.leagues.mine.queryOptions());
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const create = useMutation(trpc.leagues.create.mutationOptions({ onSuccess: (r) => nav(`/league/${r.id}/teams`) }));
  const join = useMutation(trpc.leagues.join.mutationOptions({ onSuccess: (r) => nav(`/league/${r.id}/teams`) }));
  const logout = useMutation(trpc.auth.logout.mutationOptions({ onSuccess: () => qc.clear() }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase">Your leagues</h1>
          <p className="text-sm text-ice-400">Signed in as {me.data?.displayName}</p>
        </div>
        <Button variant="ghost" onClick={() => logout.mutate()}>
          Log out
        </Button>
      </header>

      {leagues.isLoading ? (
        <Spinner />
      ) : leagues.data?.length ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {leagues.data.map((l) => (
            <Link
              key={l.id}
              to={`/league/${l.id}`}
              className="group rounded-xl border border-rink-700 bg-rink-900 p-4 transition hover:border-rink-500 hover:bg-rink-850"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white group-hover:underline">{l.name}</h2>
                  <p className="mt-0.5 text-xs text-ice-400">
                    {l.season}-{String(l.season + 1).slice(2)} · {PHASE_LABEL[l.phase]} · {dayLabel(l.season, l.day)}
                  </p>
                </div>
                {l.myTeam ? <TeamChip team={l.myTeam} /> : <Badge tone="warn">No team</Badge>}
              </div>
              <div className="mt-3 flex gap-2 text-xs text-ice-400">
                <span>{l.members} managers</span>
                {l.isCommissioner && <Badge tone="info">Commissioner</Badge>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="mb-8">
          <Empty>You're not in any leagues yet. Create one or join with an invite code.</Empty>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Create a league">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name });
            }}
          >
            <Field label="League name" value={name} onChange={setName} placeholder="e.g. Friday Night Hockey" />
            <p className="text-xs text-ice-400">
              Generates 32 teams and a full 82-game schedule. You'll be the commissioner; pick your advance mode in settings.
            </p>
            <ErrorBox error={create.error} />
            <Button type="submit" disabled={create.isPending || name.trim().length < 3}>
              {create.isPending ? 'Generating league…' : 'Create league'}
            </Button>
          </form>
        </Card>
        <Card title="Join a league">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              join.mutate({ inviteCode: code });
            }}
          >
            <Field label="Invite code" value={code} onChange={setCode} placeholder="8-character code from your commissioner" />
            <ErrorBox error={join.error} />
            <Button type="submit" variant="secondary" disabled={join.isPending || code.trim().length < 4}>
              Join league
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
