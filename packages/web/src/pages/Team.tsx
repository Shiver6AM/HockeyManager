import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { FrontOffice } from '../components/FrontOffice';
import { LinesBoard } from '../components/LinesBoard';
import { TacticsPanel } from '../components/TacticsPanel';
import { PlayerFilterBar, SortTh, usePlayerFilters, useSort } from '../components/PlayerFilters';
import { OfferForm } from '../components/OfferForm';
import { Badge, Button, Card, cx, Empty, ErrorBox, Modal, Rating, Spinner, TeamChip } from '../components/ui';
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
  const [tab, setTab] = useState<'roster' | 'lines' | 'systems' | 'prospects' | 'schedule' | 'front office'>('roster');
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
        {(['roster', 'lines', 'systems', 'prospects', 'schedule', 'front office'] as const).map((k) => (
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
      {tab === 'systems' && <TacticsPanel t={t} leagueId={L.id} />}
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

/** Contract as three columns: AAV, years left, and status when it ends. */
function ContractCells({ p }: { p: P }) {
  const c = p.contract;
  return (
    <>
      <td className="num tabular">
        {c ? money(c.salary) : <span className="text-ice-500">—</span>}
        {p.extension && (
          <span className="block text-[10px] text-win" title="Agreed new deal">
            → {money(p.extension.salary)} × {p.extension.years}
          </span>
        )}
      </td>
      <td className="num tabular">{c ? c.yearsLeft : '—'}</td>
      <td>
        {c ? (
          <span className={cx('text-xs', c.yearsLeft === 1 && !p.extension ? 'font-semibold text-warn' : 'text-ice-400')}>
            {c.kind === 'ELC' && <span className="mr-1 text-blue-300">ELC</span>}
            {c.expiresAs}
            {p.qualifyingOffer && (
              <span className="block text-[10px] font-normal text-ice-500" title="Qualifying offer needed to keep his rights">
                QO {money(p.qualifyingOffer.salary)}
              </span>
            )}
          </span>
        ) : (
          '—'
        )}
      </td>
    </>
  );
}

function ContractHeads({ sort }: { sort: ReturnType<typeof useSort> }) {
  return (
    <>
      <SortTh label="AAV" k="aav" sort={sort} className="num" title="Average annual value" />
      <SortTh label="Yrs" k="years" sort={sort} className="num" title="Years left, including this one" />
      <SortTh label="Expiry" k="status" sort={sort} title="Status when the contract ends" />
    </>
  );
}

function Roster({ t }: { t: TeamData }) {
  const { filters, setFilters, types, filtered } = usePlayerFilters(t.players);
  const sort = useSort('overall');
  const fwd = sort.sort(filtered.filter((p) => p.pos !== 'D' && p.pos !== 'G'));
  const def = sort.sort(filtered.filter((p) => p.pos === 'D'));
  const gol = sort.sort(filtered.filter((p) => p.pos === 'G'));
  return (
    <div className="space-y-5">
      <PlayerFilterBar value={filters} onChange={setFilters} types={types} />
      {filtered.length === 0 && <Empty>No players match these filters.</Empty>}
      {t.isMine && t.players.length > 23 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {t.players.length} players on the roster. The limit is 23 once the season starts; at the end of training camp your lowest-rated extras are
          sent down or released.
        </p>
      )}
      {fwd.length > 0 && <SkaterTable title={`Forwards (${fwd.length})`} players={fwd} t={t} sort={sort} />}
      {def.length > 0 && <SkaterTable title={`Defense (${def.length})`} players={def} t={t} sort={sort} />}
      {gol.length > 0 && (
        <Card title={`Goalies (${gol.length})`}>
          <div className="-m-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Player" k="name" sort={sort} />
                  <SortTh label="Age" k="age" sort={sort} className="num" />
                  <SortTh label="OVR" k="overall" sort={sort} className="num" />
                  <th className={cx('num', STAT_H)}>GP</th>
                  <th className={cx('num', STAT_H)}>W</th>
                  <th className={cx('num', STAT_H)}>L</th>
                  <th className={cx('num', STAT_H)}>OTL</th>
                  <th className={cx('num', STAT_H)}>SV%</th>
                  <th className={cx('num', STAT_H)}>GAA</th>
                  <th className={cx('num', STAT_H)}>SO</th>
                  <th className="num text-ice-500">REF</th>
                  <th className="num text-ice-500">POS</th>
                  <th className="num text-ice-500">REB</th>
                  <th className="num text-ice-500">MEN</th>
                  <ContractHeads sort={sort} />
                  <th>Injury</th>
                  {t.isMine && <th />}
                </tr>
              </thead>
              <tbody>
                {gol.map((p) => {
                  const s = p.goalieStats;
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="block text-base font-semibold">
                          <PlayerLink p={p} />
                        </span>
                        <span className="text-xs text-ice-500">
                          {p.archetype} · <span title={p.potential.projection}>pot. {p.potential.grade}</span>
                        </span>
                      </td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <Rating value={p.overall} />
                      </td>
                      <td className={cx('num', STAT)}>{s?.gp ?? 0}</td>
                      <td className={cx('num font-semibold text-white', STAT)}>{s?.w ?? 0}</td>
                      <td className={cx('num', STAT)}>{s?.l ?? 0}</td>
                      <td className={cx('num', STAT)}>{s?.otl ?? 0}</td>
                      <td className={cx('num font-semibold text-white', STAT)}>{s ? svPct(s.sa, s.ga) : '—'}</td>
                      <td className={cx('num', STAT)}>{s ? gaa(s.ga, s.toi) : '—'}</td>
                      <td className={cx('num', STAT)}>{s?.so ?? 0}</td>
                      <td className="num text-xs text-ice-400">{p.goalie?.reflexes}</td>
                      <td className="num text-xs text-ice-400">{p.goalie?.positioning}</td>
                      <td className="num text-xs text-ice-400">{p.goalie?.rebounds}</td>
                      <td className="num text-xs text-ice-400">{p.goalie?.mental}</td>
                      <ContractCells p={p} />
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
      )}
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
  const [extending, setExtending] = useState(false);
  if (!t.isMine) return null;
  const canSendDown = p.contract?.kind === 'ELC' || p.age <= 22;
  const buyoutNote = p.buyout
    ? `He'll be bought out: ${money(p.buyout.perSeason)} of dead cap per season for ${p.buyout.seasons} seasons.`
    : 'His contract comes off your cap and he becomes a free agent.';
  return (
    <span className="flex flex-wrap gap-1">
      {p.canExtend && p.deal && (
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
      {extending && p.deal && (
        <Modal title={`Extend ${p.name}`} onClose={() => setExtending(false)}>
          <OfferForm leagueId={L.id} playerId={p.id} deal={p.deal} mode="negotiate" attemptsLeft={p.attemptsLeft} />
        </Modal>
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

const STAT = 'bg-blueline/10 text-base tabular';
const STAT_H = 'bg-blueline/10 text-ice-200';

function SkaterTable({ title, players, t, sort }: { title: string; players: P[]; t: TeamData; sort: ReturnType<typeof useSort> }) {
  return (
    <Card title={title}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <SortTh label="Player" k="name" sort={sort} className="min-w-52" />
              <SortTh label="Pos" k="pos" sort={sort} />
              <SortTh label="Age" k="age" sort={sort} className="num" />
              <SortTh label="OVR" k="overall" sort={sort} className="num" />
              <th className={cx('num', STAT_H)}>GP</th>
              <th className={cx('num', STAT_H)}>G</th>
              <th className={cx('num', STAT_H)}>A</th>
              <th className={cx('num', STAT_H)}>P</th>
              <th className={cx('num', STAT_H)}>+/-</th>
              <th className={cx('num', STAT_H)}>TOI</th>
              <th className="num text-ice-500" title="Skating">
                SKT
              </th>
              <th className="num text-ice-500" title="Shooting">
                SHT
              </th>
              <th className="num text-ice-500" title="Passing">
                PAS
              </th>
              <th className="num text-ice-500" title="Puck handling">
                HND
              </th>
              <th className="num text-ice-500" title="Offensive IQ">
                OIQ
              </th>
              <th className="num text-ice-500" title="Defensive IQ">
                DIQ
              </th>
              <th className="num text-ice-500" title="Checking">
                CHK
              </th>
              <th className="num text-ice-500" title="Faceoffs">
                FO
              </th>
              <ContractHeads sort={sort} />
              <th>Injury</th>
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
                    <span className="block text-base font-semibold">
                      <PlayerLink p={p} />
                    </span>
                    <span className="text-xs text-ice-500">
                      {p.archetype} · <span title={p.potential.projection}>pot. {p.potential.grade}</span>
                    </span>
                  </td>
                  <td className="text-ice-400">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td className={cx('num', STAT)}>{s?.gp ?? 0}</td>
                  <td className={cx('num font-semibold text-white', STAT)}>{s?.g ?? 0}</td>
                  <td className={cx('num font-semibold text-white', STAT)}>{s?.a ?? 0}</td>
                  <td className={cx('num font-bold text-white', STAT)}>{s ? s.g + s.a : 0}</td>
                  <td className={cx('num', STAT, s && s.pm > 0 ? 'text-win' : s && s.pm < 0 ? 'text-red-300' : '')}>{s ? signed(s.pm) : 0}</td>
                  <td className={cx('num', STAT)}>{s?.gp ? toi(s.toi, s.gp) : '—'}</td>
                  {[r.skating, r.shooting, r.passing, r.handling, r.offIQ, r.defIQ, r.checking, r.faceoffs].map((v, i) => (
                    <td key={i} className="num text-xs text-ice-400">
                      {v}
                    </td>
                  ))}
                  <ContractCells p={p} />
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

      <LinesBoard draft={draft} onChange={setDraft} players={t.players} catalog={t.systems} formation={t.tactics.pp} leagueId={L.id} />
    </div>
  );
}
