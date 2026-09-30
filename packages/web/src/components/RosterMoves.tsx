/**
 * Roster moves: pick players to call up from the farm and send down from the
 * NHL roster, see the result before committing (roster size by position, cap
 * space, who needs waivers), then make all the moves at once.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { money, posLabel } from '../format';
import { useTRPC, type Outputs } from '../trpc';
import { TraitChips } from './Traits';
import { Button, cx, ErrorBox, Modal, Rating } from './ui';

type TeamData = Outputs['data']['team'];
type P = TeamData['players'][number];

const BURY_EXEMPT = 1_150_000;
const grp = (p: P) => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : 'F');
const MIN = { F: 12, D: 6, G: 2 };
const hitIf = (p: P, farm: boolean) => {
  const s = p.contract?.salary ?? 0;
  return farm ? Math.max(0, s - BURY_EXEMPT) : s;
};

export function RosterMoves({ t, leagueId, onClose }: { t: TeamData; leagueId: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [up, setUp] = useState<string[]>([]);
  const [down, setDown] = useState<string[]>([]);
  const apply = useMutation(
    trpc.offseason.rosterMoves.mutationOptions({
      onSuccess: async () => {
        await qc.invalidateQueries();
      },
    }),
  );
  const nhl = t.players.filter((p) => !p.farm && !p.onWaivers).sort((a, b) => grp(a).localeCompare(grp(b)) || b.overall - a.overall);
  const farm = t.players.filter((p) => p.farm).sort((a, b) => grp(a).localeCompare(grp(b)) || b.overall - a.overall);
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const preview = useMemo(() => {
    const after = t.players.filter((p) => !p.onWaivers && ((!p.farm && !down.includes(p.id)) || (p.farm && up.includes(p.id))));
    const healthy = after.filter((p) => !p.injury);
    const counts = { F: 0, D: 0, G: 0 };
    for (const p of healthy) counts[grp(p)]++;
    const before = t.players.reduce((s, p) => s + hitIf(p, !!p.farm), 0);
    const afterHit = t.players.reduce((s, p) => {
      const farmAfter = p.farm ? !up.includes(p.id) : down.includes(p.id);
      return s + hitIf(p, farmAfter);
    }, 0);
    const delta = afterHit - before;
    const waived = down.map((id) => t.players.find((p) => p.id === id)!).filter((p) => p.waiverExempt === null);
    const problems: string[] = [];
    if (healthy.length > t.activeMax) problems.push(`${healthy.length} healthy players up top: the limit is ${t.activeMax}.`);
    for (const g of ['F', 'D', 'G'] as const) if (counts[g] < MIN[g]) problems.push(`Only ${counts[g]} healthy ${g === 'F' ? 'forwards' : g === 'D' ? 'defensemen' : 'goalies'} (need ${MIN[g]}).`);
    if (after.length < 20) problems.push('You need at least 20 players on the NHL roster.');
    const space = t.salaryCap - t.payroll - delta;
    if (space < 0) problems.push(`That would put you ${money(-space)} over the cap.`);
    return { healthy: healthy.length, counts, delta, space, waived, problems };
  }, [t, up, down]);

  const row = (p: P, side: 'nhl' | 'farm') => {
    const picked = side === 'nhl' ? down.includes(p.id) : up.includes(p.id);
    return (
      <tr
        key={p.id}
        className={cx('cursor-pointer', picked && (side === 'nhl' ? 'bg-goal/10' : 'bg-win/10'))}
        onClick={() => (side === 'nhl' ? toggle(down, setDown, p.id) : toggle(up, setUp, p.id))}
      >
        <td>
          <input type="checkbox" readOnly checked={picked} aria-label={`${side === 'nhl' ? 'Send down' : 'Call up'} ${p.name}`} />
        </td>
        <td className="whitespace-nowrap text-ice-50">
          {p.name}
          <TraitChips traits={p.traits} max={2} />
          {p.injury && <span className="ml-1.5 text-[10px] text-red-300">INJ</span>}
          {p.injuryCallUp && <span className="ml-1.5 text-[10px] text-ice-500">covering</span>}
        </td>
        <td className="text-ice-400">{posLabel(p)}</td>
        <td className="num">{p.age}</td>
        <td className="num">
          <Rating value={p.overall} />
        </td>
        <td className="num text-xs">{p.contract ? money(p.contract.salary) : '—'}</td>
        {side === 'nhl' && (
          <td className="text-[11px] whitespace-nowrap">
            {p.waiverExempt ? <span className="text-ice-500" title={p.waiverExempt}>exempt</span> : <span className="text-warn">waivers</span>}
          </td>
        )}
      </tr>
    );
  };

  const table = (list: P[], side: 'nhl' | 'farm') => (
    <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-rink-700">
      <table className="table text-sm">
        <thead className="sticky top-0 z-10 bg-rink-900">
          <tr>
            <th />
            <th>Player</th>
            <th>Pos</th>
            <th className="num">Age</th>
            <th className="num">OVR</th>
            <th className="num">Salary</th>
            {side === 'nhl' && <th title="Would he need to clear waivers to go down?">Waivers</th>}
          </tr>
        </thead>
        <tbody>{list.map((p) => row(p, side))}</tbody>
      </table>
    </div>
  );

  const moving = [...down.map((id) => ({ id, dir: 'down' as const })), ...up.map((id) => ({ id, dir: 'up' as const }))];
  const done = apply.data;
  return (
    <Modal title="Roster moves" onClose={onClose} wide>
      {done ? (
        <div className="space-y-3 text-sm">
          <p className="text-win">
            Done: {done.up.length} called up, {done.farm.length} sent down
            {done.waivers.length ? `, ${done.waivers.length} placed on waivers (they go down if nobody claims them when the next day is played)` : ''}.
          </p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-ice-300">
            Tick players to send down (left) or call up (right). The preview shows your roster and cap after the moves. Veterans who aren't waiver-exempt
            go on waivers first, where another team can claim them.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">NHL roster · send down</p>
              {table(nhl, 'nhl')}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">{t.affiliate} · call up</p>
              {table(farm, 'farm')}
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-rink-700 bg-rink-850 p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Preview</p>
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-ice-400">Healthy NHL roster</p>
                <p className={cx('font-display text-2xl', preview.healthy > t.activeMax ? 'text-red-300' : 'text-white')}>
                  {preview.healthy}
                  <span className="text-sm text-ice-500">/{t.activeMax}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-ice-400">Forwards · Defense · Goalies</p>
                <p className="font-display text-2xl text-white">
                  {(['F', 'D', 'G'] as const).map((g, i) => (
                    <span key={g} className={cx(preview.counts[g] < MIN[g] && 'text-red-300')}>
                      {i ? ' · ' : ''}
                      {preview.counts[g]}
                    </span>
                  ))}
                </p>
              </div>
              <div>
                <p className="text-xs text-ice-400">Cap hit change</p>
                <p className={cx('font-display text-2xl', preview.delta > 0 ? 'text-warn' : preview.delta < 0 ? 'text-win' : 'text-white')}>
                  {preview.delta >= 0 ? '+' : '−'}
                  {money(Math.abs(preview.delta))}
                </p>
              </div>
              <div>
                <p className="text-xs text-ice-400">Cap space after</p>
                <p className={cx('font-display text-2xl', preview.space < 0 ? 'text-red-300' : 'text-win')}>{money(preview.space)}</p>
              </div>
            </div>
            {moving.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {moving.map(({ id, dir }) => {
                  const p = t.players.find((x) => x.id === id)!;
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-2">
                      <span className={cx('w-20 text-xs font-semibold', dir === 'up' ? 'text-win' : 'text-red-300')}>{dir === 'up' ? '▲ Call up' : '▼ Send down'}</span>
                      <span className="text-ice-50">{p.name}</span>
                      <span className="text-xs text-ice-500">
                        {p.pos} · {p.overall} OVR
                      </span>
                      {dir === 'down' && p.waiverExempt === null && (
                        <span className="text-xs text-warn">needs waivers: another team can claim him</span>
                      )}
                      {dir === 'down' && p.waiverExempt && <span className="text-xs text-ice-500">no waivers ({p.waiverExempt})</span>}
                      {p.twoWay && <span className="text-xs text-ice-500">2-way</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {preview.problems.map((x) => (
              <p key={x} className="mt-2 text-sm text-red-300">
                {x}
              </p>
            ))}
          </div>
          <ErrorBox error={apply.error} />
          <div className="mt-3 flex gap-2">
            <Button disabled={!moving.length || preview.problems.length > 0 || apply.isPending} onClick={() => apply.mutate({ leagueId, up, down })}>
              {apply.isPending ? 'Making moves…' : `Make ${moving.length} move${moving.length === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
