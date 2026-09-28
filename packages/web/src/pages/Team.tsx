import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { FrontOffice } from '../components/FrontOffice';
import { OfferForm } from '../components/OfferForm';
import { Badge, Button, Card, cx, Empty, ErrorBox, Rating, Spinner, TeamChip } from '../components/ui';
import { gaa, money, signed, svPct, toi } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { useLeague } from './LeagueLayout';

type TeamData = Outputs['data']['team'];
type P = TeamData['players'][number];
type Lines = TeamData['lines'];

export function TeamPage() {
  const L = useLeague();
  const { teamId = '' } = useParams();
  const trpc = useTRPC();
  const q = useQuery(trpc.data.team.queryOptions({ leagueId: L.id, teamId }));
  const [tab, setTab] = useState<'roster' | 'lines' | 'prospects' | 'schedule' | 'front office'>('roster');
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
        {(['roster', 'lines', 'prospects', 'schedule', 'front office'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('rounded-md px-4 py-1.5 font-semibold whitespace-nowrap capitalize', tab === k ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}
          >
            {k === 'lines' && t.isMine ? 'Lines editor' : k === 'prospects' ? `Prospects (${t.prospects.length})` : k}
          </button>
        ))}
      </div>

      {tab === 'roster' && <Roster t={t} />}
      {tab === 'prospects' && <Prospects t={t} />}
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

function Status({ p }: { p: P }) {
  if (!p.injury) return null;
  return (
    <Badge tone={p.injury.severity === 'day-to-day' ? 'warn' : 'bad'}>
      {p.injury.severity === 'day-to-day' ? 'DTD' : 'IR'} · {p.injury.type} · {p.injury.daysLeft}d
    </Badge>
  );
}

function Contract({ p }: { p: P }) {
  if (!p.contract) return <span className="text-ice-500">—</span>;
  return (
    <span className="tabular">
      {money(p.contract.salary)} <span className="text-ice-500">× {p.contract.yearsLeft}y</span>
      {p.contract.kind === 'ELC' && <span className="ml-1 text-[10px] text-blue-300">ELC</span>}
      {p.contract.yearsLeft === 1 && !p.extension && <span className="ml-1 text-[10px] text-warn">{p.contract.expiresAs}</span>}
      {p.extension && (
        <span className="ml-1 text-[10px] text-win" title="Agreed new deal">
          → {money(p.extension.salary)}×{p.extension.years}
        </span>
      )}
    </span>
  );
}

function Roster({ t }: { t: TeamData }) {
  const byOvr = (a: P, b: P) => b.overall - a.overall;
  const fwd = t.players.filter((p) => p.pos !== 'D' && p.pos !== 'G').sort(byOvr);
  const def = t.players.filter((p) => p.pos === 'D').sort(byOvr);
  const gol = t.players.filter((p) => p.pos === 'G').sort(byOvr);
  return (
    <div className="space-y-5">
      {t.isMine && t.players.length > 23 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {t.players.length} players on the roster. The limit is 23 once the season starts; at the end of training camp your lowest-rated extras are
          sent down or released.
        </p>
      )}
      <SkaterTable title={`Forwards (${fwd.length})`} players={fwd} t={t} />
      <SkaterTable title={`Defense (${def.length})`} players={def} t={t} />
      <Card title={`Goalies (${gol.length})`}>
        <div className="-m-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Age</th>
                <th className="num">OVR</th>
                <th className="num">REF</th>
                <th className="num">POS</th>
                <th className="num">REB</th>
                <th className="num">MEN</th>
                <th className="num">GP</th>
                <th className="num">W</th>
                <th className="num">L</th>
                <th className="num">OTL</th>
                <th className="num">SV%</th>
                <th className="num">GAA</th>
                <th className="num">SO</th>
                <th>Contract</th>
                <th>Status</th>
                {t.isMine && <th />}
              </tr>
            </thead>
            <tbody>
              {gol.map((p) => {
                const s = p.goalieStats;
                return (
                  <tr key={p.id}>
                    <td>
                      <PlayerLink p={p} /> <span className="text-xs text-ice-500">{p.archetype}</span>
                    </td>
                    <td className="num">{p.age}</td>
                    <td className="num">
                      <Rating value={p.overall} />
                    </td>
                    <td className="num">{p.goalie?.reflexes}</td>
                    <td className="num">{p.goalie?.positioning}</td>
                    <td className="num">{p.goalie?.rebounds}</td>
                    <td className="num">{p.goalie?.mental}</td>
                    <td className="num">{s?.gp ?? 0}</td>
                    <td className="num">{s?.w ?? 0}</td>
                    <td className="num">{s?.l ?? 0}</td>
                    <td className="num">{s?.otl ?? 0}</td>
                    <td className="num">{s ? svPct(s.sa, s.ga) : '—'}</td>
                    <td className="num">{s ? gaa(s.ga, s.toi) : '—'}</td>
                    <td className="num">{s?.so ?? 0}</td>
                    <td>
                      <Contract p={p} />
                    </td>
                    <td>
                      <Status p={p} />
                    </td>
                    {t.isMine && (
                      <td>
                        <RosterActions t={t} p={p} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RosterActions({ t, p }: { t: TeamData; p: P }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const release = useMutation(trpc.offseason.release.mutationOptions(done));
  const down = useMutation(trpc.offseason.sendDown.mutationOptions(done));
  if (!t.isMine) return null;
  const canSendDown = p.contract?.kind === 'ELC' || p.age <= 22;
  const [extending, setExtending] = useState(false);
  const buyoutNote = p.buyout
    ? `He'll be bought out: ${money(p.buyout.perSeason)} of dead cap per season for ${p.buyout.seasons} seasons.`
    : 'His contract comes off your cap and he becomes a free agent.';
  return (
    <span className="flex flex-wrap gap-1">
      {p.canExtend && p.ask && (
        <Button variant="ghost" className="px-1.5 py-0 text-[11px] text-blue-300" onClick={() => setExtending(!extending)}>
          Extend
        </Button>
      )}
      {canSendDown && (
        <Button variant="ghost" className="px-1.5 py-0 text-[11px]" disabled={down.isPending} onClick={() => down.mutate({ leagueId: L.id, playerId: p.id })}>
          Send down
        </Button>
      )}
      <Button
        variant="ghost"
        className="px-1.5 py-0 text-[11px] hover:text-red-300"
        disabled={release.isPending}
        onClick={() => {
          if (confirm(`Release ${p.name}? ${buyoutNote}`)) release.mutate({ leagueId: L.id, playerId: p.id });
        }}
      >
        Release
      </Button>
      {(release.error || down.error) && <span className="text-[11px] text-red-300">{String((release.error ?? down.error)?.message)}</span>}
      {extending && p.ask && (
        <span className="block w-full">
          <OfferForm leagueId={L.id} playerId={p.id} ask={p.ask} mode="negotiate" onClose={() => setExtending(false)} />
        </span>
      )}
    </span>
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

function Prospects({ t }: { t: TeamData }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const promote = useMutation(trpc.offseason.promote.mutationOptions(done));
  const release = useMutation(trpc.offseason.release.mutationOptions(done));
  return (
    <Card title="Prospects">
      <p className="-mt-1 mb-3 text-sm text-ice-400">
        Prospects develop in junior or the minors and don't count against the cap or the 23-man roster. Promoting one signs a 3-year entry-level deal
        ($950K). Unsigned prospects are released at 23.
      </p>
      {t.prospects.length === 0 ? (
        <Empty>No prospects in the system.</Empty>
      ) : (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th className="num">OVR</th>
                <th className="num">Grade</th>
                <th>Projection</th>
                <th>Drafted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.prospects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlayerLink p={p} />
                  </td>
                  <td className="text-ice-400">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td className="num font-display text-blue-300">{p.grade}</td>
                  <td className="text-ice-300">{p.projection}</td>
                  <td className="text-xs text-ice-400">{p.draft ? `${p.draft.season} R${p.draft.round} #${p.draft.overall}` : 'Undrafted'}</td>
                  <td className="text-right">
                    {t.isMine && (
                      <span className="flex justify-end gap-1">
                        <Button className="px-2 py-0.5 text-xs" disabled={promote.isPending} onClick={() => promote.mutate({ leagueId: L.id, playerId: p.id })}>
                          Promote
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

function SkaterTable({ title, players, t }: { title: string; players: P[]; t: TeamData }) {
  return (
    <Card title={title}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th className="num">Age</th>
              <th className="num">OVR</th>
              <th className="num" title="Skating">SKT</th>
              <th className="num" title="Shooting">SHT</th>
              <th className="num" title="Passing">PAS</th>
              <th className="num" title="Puck handling">HND</th>
              <th className="num" title="Offensive IQ">OIQ</th>
              <th className="num" title="Defensive IQ">DIQ</th>
              <th className="num" title="Checking">CHK</th>
              <th className="num" title="Faceoffs">FO</th>
              <th className="num">GP</th>
              <th className="num">G</th>
              <th className="num">A</th>
              <th className="num">P</th>
              <th className="num">+/-</th>
              <th className="num">TOI</th>
              <th>Contract</th>
              <th>Status</th>
              {t.isMine && <th />}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const s = p.stats;
              const r = p.skater!;
              return (
                <tr key={p.id} className={cx(p.injury && 'opacity-60')}>
                  <td>
                    <PlayerLink p={p} /> <span className="text-xs text-ice-500">{p.archetype}</span>
                  </td>
                  <td className="text-ice-400">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  {[r.skating, r.shooting, r.passing, r.handling, r.offIQ, r.defIQ, r.checking, r.faceoffs].map((v, i) => (
                    <td key={i} className="num text-ice-300">
                      {v}
                    </td>
                  ))}
                  <td className="num">{s?.gp ?? 0}</td>
                  <td className="num">{s?.g ?? 0}</td>
                  <td className="num">{s?.a ?? 0}</td>
                  <td className="num font-semibold text-white">{s ? s.g + s.a : 0}</td>
                  <td className="num">{s ? signed(s.pm) : 0}</td>
                  <td className="num">{s?.gp ? toi(s.toi, s.gp) : '—'}</td>
                  <td>
                    <Contract p={p} />
                  </td>
                  <td>
                    <Status p={p} />
                  </td>
                  {t.isMine && (
                    <td>
                      <RosterActions t={t} p={p} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

const FWD_LABELS = ['LW', 'C', 'RW'];

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
  const skaters = t.players.filter((p) => p.pos !== 'G').sort((a, b) => b.overall - a.overall);
  const goalies = t.players.filter((p) => p.pos === 'G').sort((a, b) => b.overall - a.overall);
  const dressed = [...draft.forwards.flat(), ...draft.defense.flat(), ...draft.goalies];
  const counts = new Map<string, number>();
  dressed.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const dupes = new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  const dressedSkaters = new Set([...draft.forwards.flat(), ...draft.defense.flat()]);
  const stUnitProblems = [...draft.pp, ...draft.pk].some((u) => u.some((id) => !dressedSkaters.has(id)) || new Set(u).size !== u.length);
  const injuredDressed = dressed.filter((id) => byId.get(id)?.injury);
  const dirty = JSON.stringify(draft) !== JSON.stringify(t.lines);
  const scratches = t.players.filter((p) => !counts.has(p.id));

  const set = (path: (d: Lines) => string[], idx: number, id: string) => {
    const next = structuredClone(draft);
    const old = path(next)[idx];
    path(next)[idx] = id;
    // If a skater just left the lineup, hand his special-teams spots to his replacement.
    const stillDressed = new Set([...next.forwards.flat(), ...next.defense.flat()]);
    if (!stillDressed.has(old)) {
      for (const unit of [...next.pp, ...next.pk]) {
        const k = unit.indexOf(old);
        if (k >= 0 && !unit.includes(id)) unit[k] = id;
      }
    }
    setDraft(next);
  };
  const slot = (key: string | number, value: string, options: P[], onChange: (id: string) => void, opts: { tag?: string; compact?: boolean; flag?: boolean } = {}) => (
    <Slot
      key={key}
      value={value}
      options={options}
      byId={byId}
      onChange={onChange}
      tag={opts.tag}
      compact={opts.compact}
      invalid={dupes.has(value) || !!opts.flag}
    />
  );
  const dressedList = skaters.filter((p) => dressedSkaters.has(p.id));

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
                  {w.scratched.name} ({w.scratched.overall}) is scratched while {w.dressedInstead.name} ({w.dressedInstead.overall}) dresses
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

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Forward lines" className="xl:col-span-2">
          <div className="space-y-3">
            {draft.forwards.map((line, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] items-end gap-2">
                <span className="pb-2 font-display text-ice-400">L{i + 1}</span>
                {line.map((id, j) => slot(j, id, skaters, (v) => set((d) => d.forwards[i], j, v), { tag: i === 0 ? FWD_LABELS[j] : undefined }))}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Defense & goalies">
          <div className="space-y-3">
            {draft.defense.map((pair, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2">
                <span className="pb-2 font-display text-ice-400">D{i + 1}</span>
                {pair.map((id, j) => slot(j, id, skaters, (v) => set((d) => d.defense[i], j, v), { tag: i === 0 ? (j ? 'RD' : 'LD') : undefined }))}
              </div>
            ))}
            <div className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2 border-t border-rink-700 pt-3">
              <span className="pb-2 font-display text-ice-400">G</span>
              {draft.goalies.map((id, j) => slot(j, id, goalies, (v) => set((d) => d.goalies, j, v), { tag: j ? 'Backup' : 'Starter' }))}
            </div>
            <p className="text-xs text-ice-500">The backup starts about 1 in 8 games, and most second nights of back-to-backs.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Power play">
          {draft.pp.map((unit, i) => (
            <div key={i} className="mb-3 grid grid-cols-[2.5rem_repeat(5,1fr)] items-end gap-1.5 last:mb-0">
              <span className="pb-2 font-display text-ice-400">PP{i + 1}</span>
              {unit.map((id, j) =>
                slot(j, id, dressedList, (v) => set((d) => d.pp[i], j, v), { compact: true, flag: !dressedSkaters.has(id) || unit.indexOf(id) !== j }),
              )}
            </div>
          ))}
          <p className="text-xs text-ice-500">PP1 takes the first ~70 seconds of each power play.</p>
        </Card>
        <Card title="Penalty kill">
          {draft.pk.map((unit, i) => (
            <div key={i} className="mb-3 grid grid-cols-[2.5rem_repeat(4,1fr)] items-end gap-1.5 last:mb-0">
              <span className="pb-2 font-display text-ice-400">PK{i + 1}</span>
              {unit.map((id, j) =>
                slot(j, id, dressedList, (v) => set((d) => d.pk[i], j, v), { compact: true, flag: !dressedSkaters.has(id) || unit.indexOf(id) !== j }),
              )}
            </div>
          ))}
          <p className="text-xs text-ice-500">Two forwards then two defensemen. PK1 takes the first ~60 seconds.</p>
        </Card>
      </div>

      <Card title={`Scratches (${scratches.length})`}>
        {scratches.length ? (
          <div className="flex flex-wrap gap-2">
            {scratches.map((p) => (
              <span key={p.id} className="rounded-md border border-rink-600 px-2 py-1 text-sm">
                {p.name} <span className="text-ice-400">{p.pos} {p.overall}</span> {p.injury && <Badge tone="bad">{p.injury.type}</Badge>}
              </span>
            ))}
          </div>
        ) : (
          <Empty>Everyone is dressed.</Empty>
        )}
      </Card>
    </div>
  );
}

function Slot({
  value,
  options,
  byId,
  onChange,
  tag,
  compact,
  invalid,
}: {
  value: string;
  options: P[];
  byId: Map<string, P>;
  onChange: (id: string) => void;
  tag?: string;
  compact?: boolean;
  invalid?: boolean;
}) {
  const current = byId.get(value);
  // Always show the current occupant, even if they're not in the option list
  // (e.g. a PP unit still naming a player who was just scratched).
  const list = current && !options.some((p) => p.id === value) ? [current, ...options] : options;
  const label = (p: P) =>
    compact ? `${p.lastName} · ${p.pos}` : `${p.lastName}, ${p.firstName[0]}. · ${p.pos} ${p.overall}${p.injury ? ' · INJ' : ''}`;
  return (
    <div className="min-w-0">
      {tag && <p className="mb-0.5 text-[10px] font-semibold tracking-wider text-ice-500 uppercase">{tag}</p>}
      <select
        className={cx('slot', compact && 'px-1.5 text-xs', invalid && 'border-goal!', current?.injury && 'border-warn!')}
        value={value}
        title={current ? `${current.name} (${current.pos} ${current.overall})` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {list.map((p) => (
          <option key={p.id} value={p.id} disabled={!!p.injury && p.id !== value}>
            {label(p)}
            {!options.includes(p) ? ' (not dressed)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
