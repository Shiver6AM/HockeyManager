/**
 * Placements: tell the assistant coach where you want players (top-four D, the
 * second line, center only, a healthy scratch) and let him handle the rest.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTRPC, type Outputs } from '../trpc';
import { CollapsibleCard, cx, ErrorBox, Rating } from './ui';

type TeamData = Outputs['data']['team'];
type Pin = { slot?: string; pos?: 'C' | 'LW' | 'RW' };

const SEL = 'rounded border border-rink-600 bg-rink-900 px-1 py-0.5 text-[11px] text-ice-100 focus:border-blueline focus:outline-none';

const F_SLOTS: Array<[string, string]> = [
  ['', 'Anywhere'],
  ['L1', '1st line'],
  ['L2', '2nd line'],
  ['L3', '3rd line'],
  ['L4', '4th line'],
  ['top6', 'Top six'],
  ['top9', 'Top nine'],
  ['bottom6', 'Bottom six'],
  ['scratch', 'Healthy scratch'],
];
const D_SLOTS: Array<[string, string]> = [
  ['', 'Anywhere'],
  ['P1', 'Top pair'],
  ['P2', '2nd pair'],
  ['P3', '3rd pair'],
  ['top4', 'Top four'],
  ['scratch', 'Healthy scratch'],
];
const G_SLOTS: Array<[string, string]> = [
  ['', 'Coach decides'],
  ['G1', 'Starter'],
  ['G2', 'Backup'],
];

export function LinePins({ t, leagueId }: { t: TeamData; leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.data.setLinePins.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const pins = t.linePins as Record<string, Pin>;
  // Where each player is right now.
  const spot = useMemo(() => {
    const m = new Map<string, string>();
    t.lines.forwards.forEach((line, i) => line.forEach((id, j) => m.set(id, `L${i + 1} ${['LW', 'C', 'RW'][j]}`)));
    t.lines.defense.forEach((pair, i) => pair.forEach((id) => m.set(id, `Pair ${i + 1}`)));
    t.lines.goalies.forEach((id, i) => m.set(id, i === 0 ? 'Starter' : 'Backup'));
    return m;
  }, [t.lines]);
  const players = t.players.filter((p) => !p.farm && !p.injury);
  const groups: Array<[string, typeof players]> = [
    ['Forwards', players.filter((p) => p.pos !== 'D' && p.pos !== 'G')],
    ['Defense', players.filter((p) => p.pos === 'D')],
    ['Goalies', players.filter((p) => p.pos === 'G')],
  ];
  const set = (id: string, pin: Pin) => {
    const next = { ...pins, [id]: { ...pins[id], ...pin } };
    for (const k of ['slot', 'pos'] as const) if (!next[id][k]) delete next[id][k];
    if (!next[id].slot && !next[id].pos) delete next[id];
    save.mutate({ leagueId, pins: next as Record<string, { slot?: never; pos?: 'C' | 'LW' | 'RW' }> });
  };
  const count = Object.keys(pins).length;

  return (
    <CollapsibleCard
      id="line-placement"
      title="Player placement"
      summary={count ? `${count} player${count > 1 ? 's' : ''} placed` : 'Tell the assistant coach where to play people'}
      action={
        count > 0 && (
          <button className="text-xs text-ice-400 hover:text-white" onClick={() => save.mutate({ leagueId, pins: {} })}>
            Clear all ({count})
          </button>
        )
      }
    >
      <p className="mb-3 text-sm text-ice-400">
        {t.autoLines
          ? 'Tell your assistant coach where you want someone and he builds the rest of the lines around it, game after game (injuries included).'
          : 'These placements are used when the assistant coach manages your lines (turn it on above).'}{' '}
        A player's other positions are shown after his main one; playing someone where he doesn't play costs him a little.
      </p>
      <ErrorBox error={save.error} />
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map(([title, list]) => (
          <div key={title} className="min-w-0">
            <p className="mb-1 text-xs font-semibold tracking-wider text-ice-400 uppercase">{title}</p>
            <table className="table text-xs">
              <tbody>
                {list.map((p) => {
                  const pin = pins[p.id] ?? {};
                  const slots = p.pos === 'G' ? G_SLOTS : p.pos === 'D' ? D_SLOTS : F_SLOTS;
                  const fwd = p.pos !== 'D' && p.pos !== 'G';
                  return (
                    <tr key={p.id} className={cx(pin.slot || pin.pos ? 'bg-blueline/10' : '')}>
                      <td className="w-8">
                        <Rating value={p.overall} />
                      </td>
                      <td className="max-w-40 truncate">
                        <Link to={`/league/${leagueId}/player/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>{' '}
                        <span className="text-ice-500">{[p.pos, ...(p.altPos ?? [])].join('/')}</span>
                      </td>
                      <td className="text-[11px] whitespace-nowrap text-ice-400">{spot.get(p.id) ?? 'Scratched'}</td>
                      <td className="text-right whitespace-nowrap">
                        <select
                          className={SEL}
                          value={pin.slot ?? ''}
                          disabled={!t.isMine || save.isPending}
                          onChange={(e) => set(p.id, { slot: e.target.value || undefined })}
                          aria-label={`Where ${p.name} plays`}
                        >
                          {slots.map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {fwd && (
                          <select
                            className={cx(SEL, "ml-1")}
                            value={pin.pos ?? ''}
                            disabled={!t.isMine || save.isPending}
                            onChange={(e) => set(p.id, { pos: (e.target.value || undefined) as Pin['pos'] })}
                            aria-label={`${p.name}'s position`}
                          >
                            <option value="">Any pos</option>
                            {(['C', 'LW', 'RW'] as const).map((x) => (
                              <option key={x} value={x}>
                                {x}
                                {x !== p.pos && !(p.altPos ?? []).includes(x) ? ' (off)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}
