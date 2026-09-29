import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { FrontOffice } from '../components/FrontOffice';
import { LinesBoard } from '../components/LinesBoard';
import { SkillsCoaches } from '../components/SkillsCoaches';
import { TacticsPanel } from '../components/TacticsPanel';
import { PlayerFilterBar, usePlayerFilters } from '../components/PlayerFilters';
import { FarmTable, GoalieTable, SkaterTable } from '../components/RosterTables';
import { ContractsTab } from '../components/ContractsTab';
import { Button, Card, cx, Empty, ErrorBox, PotentialBadge, Rating, Spinner, TeamChip } from '../components/ui';
import { useSort } from '../sort';
import { money, svPct } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type TeamData = Outputs['data']['team'];
type Lines = TeamData['lines'];

export function TeamPage() {
  const L = useLeague();
  const { teamId = '' } = useParams();
  const trpc = useTRPC();
  const [statsSeason, setStatsSeason] = useState<number | 'all'>(L.season);
  const q = useQuery({
    ...trpc.data.team.queryOptions({ leagueId: L.id, teamId, statsSeason: statsSeason === L.season ? undefined : statsSeason }),
    placeholderData: (prev) => prev,
  });
  const [tab, setTab] = useState<'roster' | 'contracts' | 'lines' | 'systems' | 'coaching' | 'prospects' | 'schedule' | 'front office'>('roster');
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  const t = q.data;
  const manager = L.members.find((m) => m.teamId === teamId);
  const capPct = Math.min(100, (t.payroll / t.salaryCap) * 100);

  return (
    <div className="space-y-5">
      <div
        className="flex flex-wrap items-center gap-5 rounded-xl border border-rink-700 p-5"
        style={{ background: `linear-gradient(120deg, ${t.team.colors[0]}40, #0b1220 65%)` }}
      >
        <TeamChip team={t.team} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-wide text-white uppercase sm:text-3xl">
            {t.team.city} {t.team.name}
          </h1>
          <p className="tabular text-sm text-ice-300">
            {t.record.w}-{t.record.l}-{t.record.otl} · {t.record.pts} pts · #{t.record.rank} in league · {t.team.conference} / {t.team.division}
          </p>
          <p className="mt-1 text-sm text-ice-400">
            {manager ? (
              <>
                Managed by <span className="font-semibold text-ice-100">{manager.displayName}</span>
              </>
            ) : (
              'AI-managed'
            )}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <div className="mb-1 flex justify-between text-xs text-ice-400">
            <span>Payroll {money(t.payroll)}</span>
            <span>Cap {money(t.salaryCap)}</span>
          </div>
          <div className="h-2 rounded-full bg-rink-700">
            <div className={cx('h-2 rounded-full', capPct > 97 ? 'bg-goal' : 'bg-blueline')} style={{ width: `${capPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-ice-400">Cap space {money(t.salaryCap - t.payroll)}</p>
          {t.deadCapThisSeason > 0 && (
            <p className="mt-1 text-xs text-red-300" title={t.deadCap.map((d) => `${d.playerName}: ${money(d.amount)} through ${d.untilSeason}`).join(', ')}>
              Includes {money(t.deadCapThisSeason)} dead cap ({t.deadCap.length} buyout{t.deadCap.length === 1 ? '' : 's'})
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-rink-900 p-1 text-sm sm:w-fit">
        {(['roster', 'contracts', 'lines', 'systems', 'coaching', 'prospects', 'schedule', 'front office'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('rounded-md px-4 py-1.5 font-semibold whitespace-nowrap capitalize', tab === k ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}
          >
            {k === 'lines' && t.isMine ? 'Lines editor' : k === 'prospects' ? `Prospects (${t.prospects.length})` : k}
          </button>
        ))}
      </div>

      {tab === 'roster' && <Roster t={t} season={statsSeason} setSeason={setStatsSeason} />}
      {tab === 'contracts' && <ContractsTab leagueId={L.id} teamId={t.team.id} />}
      {tab === 'prospects' && <Prospects t={t} />}
      {tab === 'systems' && <TacticsPanel t={t} leagueId={L.id} />}
      {tab === 'coaching' && <SkillsCoaches leagueId={L.id} teamId={t.team.id} />}
      {tab === 'front office' && <FrontOffice leagueId={L.id} teamId={t.team.id} />}
      {tab === 'lines' && (t.isMine ? <LinesEditor t={t} /> : <LinesView t={t} />)}
      {tab === 'schedule' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Recent results">
            {t.recent.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {[...t.recent].reverse().map((g) => (
                  <GameCard key={g.id} leagueId={L.id} game={g} highlight={t.team.id} />
                ))}
              </div>
            ) : (
              <Empty>No games played yet.</Empty>
            )}
          </Card>
          <Card title="Upcoming">
            {t.upcoming.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {t.upcoming.map((g) => (
                  <GameCard key={g.id} leagueId={L.id} game={g} highlight={t.team.id} />
                ))}
              </div>
            ) : (
              <Empty>No games scheduled.</Empty>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function Roster({ t, season, setSeason }: { t: TeamData; season: number | 'all'; setSeason: (s: number | 'all') => void }) {
  const L = useLeague();
  const { filters, setFilters, types, filtered } = usePlayerFilters(t.players);
  const nhl = filtered.filter((p) => !p.farm);
  const farm = filtered.filter((p) => p.farm);
  const fwd = nhl.filter((p) => p.pos !== 'D' && p.pos !== 'G');
  const def = nhl.filter((p) => p.pos === 'D');
  const gol = nhl.filter((p) => p.pos === 'G');
  const label = season === 'all' ? 'career totals' : season === L.season ? 'this season' : `${season}-${String(season + 1).slice(2)}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <PlayerFilterBar value={filters} onChange={setFilters} types={types} className="min-w-0 flex-1" />
        <label className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
          Stats
          <select className="slot mt-0.5 block normal-case" value={String(season)} onChange={(e) => setSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            {t.statsSeasons.map((y) => (
              <option key={y} value={y}>
                {y === L.season ? 'This season' : `${y}-${String(y + 1).slice(2)}`}
              </option>
            ))}
            <option value="all">All time (career)</option>
          </select>
        </label>
      </div>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ice-300">
        <span>
          Active roster <span className={cx('font-semibold', t.active > t.activeMax ? 'text-red-300' : 'text-white')}>{t.active}</span>/{t.activeMax}
          <span className="text-ice-500"> (injured players don't count)</span>
        </span>
        <span>
          Contracts <span className={cx('font-semibold', t.contracts > t.contractMax ? 'text-red-300' : 'text-white')}>{t.contracts}</span>/{t.contractMax}
        </span>
        <span>
          Farm team: <span className="text-white">{t.affiliate}</span>
        </span>
      </p>
      {filtered.length === 0 && <Empty>No players match these filters.</Empty>}
      {fwd.length > 0 && <SkaterTable title={`Forwards (${fwd.length})`} players={fwd} t={t} statsLabel={label} />}
      {def.length > 0 && <SkaterTable title={`Defense (${def.length})`} players={def} t={t} statsLabel={label} />}
      {gol.length > 0 && <GoalieTable players={gol} t={t} statsLabel={label} />}
      {farm.length > 0 && <FarmTable players={farm} t={t} />}
    </div>
  );
}

function PlayerLink({ p }: { p: { id: string; name: string } }) {
  const L = useLeague();
  return (
    <Link to={`/league/${L.id}/player/${p.id}`} className="text-ice-50 hover:underline">
      {p.name}
    </Link>
  );
}

type Prospect = TeamData['prospects'][number];
const prospectPts = (p: Prospect) => (p.minor ? (p.minor.g ?? 0) + (p.minor.a ?? 0) : 0);

function Prospects({ t }: { t: TeamData }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const promote = useMutation(trpc.offseason.promote.mutationOptions(done));
  const release = useMutation(trpc.offseason.release.mutationOptions(done));
  const { sorted, Th } = useSort(
    t.prospects,
    {
      name: (p) => p.lastName,
      pos: (p) => p.pos,
      age: (p) => p.age,
      ovr: (p) => p.overall,
      pot: (p) => p.potentialValue,
      league: (p) => p.league,
      club: (p) => p.club,
      region: (p) => p.region,
      gp: (p) => p.minor?.gp ?? 0,
      g: (p) => (p.pos === 'G' ? (p.minor?.w ?? 0) : (p.minor?.g ?? 0)),
      a: (p) => (p.pos === 'G' ? (p.minor?.sa ? 1 - (p.minor.ga ?? 0) / p.minor.sa : null) : (p.minor?.a ?? 0)),
      p: (p) => (p.pos === 'G' ? (p.minor?.gp ? -((p.minor.ga ?? 0) / p.minor.gp) : null) : prospectPts(p)),
      drafted: (p) => (p.draft ? p.draft.overall + (3000 - p.draft.season) * 1000 : null),
    },
    { key: 'pot' },
    'prospects',
  );
  return (
    <Card title="Prospects">
      <p className="-mt-1 mb-3 text-sm text-ice-400">
        Your unsigned draft picks keep playing where they were drafted from (junior, college or Europe) until you sign them. They don't count against the
        cap, the 23-man roster or the 50-contract limit. Promoting one signs a 3-year entry-level deal ($950K); he joins your NHL roster or your farm team.
        Unsigned prospects are released at 23.
      </p>
      {t.prospects.length === 0 ? (
        <Empty>No prospects in the system.</Empty>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <Th k="name">Prospect</Th>
                <Th k="pos">Pos</Th>
                <Th k="age" className="num">Age</Th>
                <Th k="ovr" className="num">OVR</Th>
                <Th k="pot">Potential</Th>
                <Th k="league">League</Th>
                <Th k="club">Team</Th>
                <Th k="region">Region</Th>
                <Th k="gp" className="num" title="Games played this season">GP</Th>
                <Th k="g" className="num" title="Goals (skaters) · wins (goalies)">G/W</Th>
                <Th k="a" className="num" title="Assists (skaters) · save % (goalies)">A/SV%</Th>
                <Th k="p" className="num" title="Points (skaters) · GAA (goalies)">P/GAA</Th>
                <Th k="drafted">Drafted</Th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    <PlayerLink p={p} />
                  </td>
                  <td className="text-ice-400">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td className="whitespace-nowrap">
                    <PotentialBadge potential={p} showLabel />
                  </td>
                  <td className="text-xs font-semibold whitespace-nowrap text-ice-200">{p.league}</td>
                  <td className="text-xs whitespace-nowrap text-ice-300">{p.club}</td>
                  <td className="text-xs whitespace-nowrap text-ice-500">{p.region}</td>
                  <td className="num">{p.minor?.gp ?? 0}</td>
                  {p.pos === 'G' ? (
                    <>
                      <td className="num">{p.minor?.w ?? 0}</td>
                      <td className="num">{p.minor?.sa ? svPct(p.minor.sa, p.minor.ga ?? 0) : '—'}</td>
                      <td className="num">{p.minor?.gp ? ((p.minor.ga ?? 0) / p.minor.gp).toFixed(2) : '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{p.minor?.g ?? 0}</td>
                      <td className="num">{p.minor?.a ?? 0}</td>
                      <td className="num font-semibold text-white">{prospectPts(p)}</td>
                    </>
                  )}
                  <td className="text-xs whitespace-nowrap text-ice-400">{p.draft ? `${p.draft.season} R${p.draft.round} #${p.draft.overall}` : 'Undrafted'}</td>
                  <td className="text-right">
                    {t.isMine && (
                      <span className="flex justify-end gap-1">
                        <Button className="px-2 py-0.5 text-xs" disabled={promote.isPending} onClick={() => promote.mutate({ leagueId: L.id, playerId: p.id })}>
                          Sign
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-0.5 text-xs"
                          disabled={release.isPending}
                          onClick={() => confirm(`Release ${p.name}?`) && release.mutate({ leagueId: L.id, playerId: p.id })}
                        >
                          Release
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6">
        <ErrorBox error={promote.error ?? release.error} />
      </div>
    </Card>
  );
}

function LinesView({ t }: { t: TeamData }) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Forward lines">
        {t.lines.forwards.map((line, i) => (
          <p key={i} className="py-1 text-sm">
            <span className="mr-3 text-ice-500">L{i + 1}</span>
            {line.map(name).join(' — ')}
          </p>
        ))}
      </Card>
      <Card title="Defense & goalies">
        {t.lines.defense.map((pair, i) => (
          <p key={i} className="py-1 text-sm">
            <span className="mr-3 text-ice-500">D{i + 1}</span>
            {pair.map(name).join(' — ')}
          </p>
        ))}
        <p className="py-1 text-sm">
          <span className="mr-3 text-ice-500">G</span>
          {name(t.lines.goalies[0])} <span className="text-ice-500">(backup {name(t.lines.goalies[1])})</span>
        </p>
      </Card>
    </div>
  );
}

function LinesEditor({ t }: { t: TeamData }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Lines>(t.lines);
  useEffect(() => setDraft(t.lines), [t.lines]);
  const save = useMutation(trpc.data.setLines.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const auto = useMutation(trpc.data.setAutoLines.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const suggest = useQuery({ ...trpc.data.suggestLines.queryOptions({ leagueId: L.id }), enabled: false });

  const byId = useMemo(() => new Map(t.players.map((p) => [p.id, p])), [t.players]);
  const dressed = [...draft.forwards.flat(), ...draft.defense.flat(), ...draft.goalies];
  const counts = new Map<string, number>();
  dressed.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const dupes = new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  const dressedSkaters = new Set([...draft.forwards.flat(), ...draft.defense.flat()]);
  const stUnitProblems = [...draft.pp, ...draft.pk].some((u) => u.some((id) => !dressedSkaters.has(id)) || new Set(u).size !== u.length);
  const injuredDressed = dressed.filter((id) => byId.get(id)?.injury);
  const dirty = JSON.stringify(draft) !== JSON.stringify(t.lines);

  return (
    <div className="space-y-5">
      <Card>
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-rink-600 bg-rink-850 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={t.autoLines}
            disabled={auto.isPending}
            onChange={(e) => auto.mutate({ leagueId: L.id, enabled: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-white">Assistant coach manages my lines</span>
            <span className="block text-sm text-ice-400">
              {t.autoLines
                ? 'Your lines are rebuilt before every game: injured players out, returning players back in. Saving your own lines below turns this off.'
                : "You're setting lines yourself. Injured players are still swapped out automatically, but returning players stay scratched until you put them back in."}
            </span>
          </span>
        </label>
        {t.scratchWarnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
            <p className="font-semibold">Better players are sitting out:</p>
            <ul className="mt-1 list-disc pl-5">
              {t.scratchWarnings.map((w) => (
                <li key={w.scratched.id}>
                  <Link to={`/league/${L.id}/player/${w.scratched.id}`} className="underline-offset-2 hover:underline">
                    {w.scratched.name}
                  </Link>{' '}
                  ({w.scratched.overall}) is scratched while{' '}
                  <Link to={`/league/${L.id}/player/${w.dressedInstead.id}`} className="underline-offset-2 hover:underline">
                    {w.dressedInstead.name}
                  </Link>{' '}
                  ({w.dressedInstead.overall}) dresses
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate({ leagueId: L.id, lines: draft })} disabled={!dirty || save.isPending || dupes.size > 0}>
            {save.isPending ? 'Saving…' : 'Save lines'}
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await suggest.refetch();
              if (r.data) setDraft(r.data);
            }}
          >
            Auto-fill best lineup
          </Button>
          <Button variant="ghost" onClick={() => setDraft(t.lines)} disabled={!dirty}>
            Reset
          </Button>
          <span className="text-sm text-ice-400">
            {save.isSuccess && !dirty ? '✓ Saved. These lines are used from the next game on.' : dirty ? 'Unsaved changes' : 'Lines are up to date'}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {dupes.size > 0 && <ErrorBox error={`Listed twice: ${[...dupes].map((id) => byId.get(id)?.name).join(', ')}`} />}
          {injuredDressed.length > 0 && (
            <p className="text-sm text-warn">
              Injured and in the lineup: {injuredDressed.map((id) => byId.get(id)?.name).join(', ')}. They'll be swapped for your best healthy scratch at game time.
            </p>
          )}
          {stUnitProblems && <p className="text-sm text-warn">A power-play or penalty-kill unit lists someone who isn't dressed (or lists a player twice).</p>}
          <ErrorBox error={save.error ?? auto.error} />
        </div>
      </Card>

      <LinesBoard draft={draft} onChange={setDraft} players={t.players.filter((p) => !p.farm)} catalog={t.systems} formation={t.tactics.pp} leagueId={L.id} chemistryGames={t.chemistryGames} />
    </div>
  );
}
