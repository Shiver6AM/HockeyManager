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
  const clear = (id: string) => {
    const next = { ...pins };
    delete next[id];
    save.mutate({ leagueId, pins: next as Record<string, { slot?: never; pos?: 'C' | 'LW' | 'RW' }> });
  };
  const count = Object.keys(pins).length;
  // Placements on players not listed below (hurt or in the AHL): they still count when he's back.
  const away = t.players.filter((p) => pins[p.id] && (p.farm || p.injury));
  const label = (pin: Pin) => [[...F_SLOTS, ...D_SLOTS, ...G_SLOTS].find(([v]) => v === pin.slot)?.[1], pin.pos && `at ${pin.pos}`].filter(Boolean).join(', ');

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
        A player's other positions are shown after his main one, and the coach uses them: a center can take a wing spot rather than push a better winger down. Playing someone where he doesn't play costs him a little. Short of players, the coach moves someone over from forward or defense, or calls someone up.
      </p>
      <ErrorBox error={save.error} />
      {save.data && (save.data.calledUp.length > 0 || save.data.note) && (
        <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
          {save.data.calledUp.length > 0 && `Short of bodies, so the coach called up ${save.data.calledUp.join(', ')}. `}
          {save.data.note}
        </p>
      )}
      {count > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ice-400">
          <span>
            {count} placement{count > 1 ? 's' : ''} set.
          </span>
          <button className="rounded border border-rink-600 px-2 py-0.5 text-ice-200 hover:border-red-300 hover:text-red-300 disabled:opacity-40" disabled={!t.isMine || save.isPending} onClick={() => save.mutate({ leagueId, pins: {} })}>
            Clear all placements
          </button>
          {away.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded bg-rink-800 px-1.5 py-0.5">
              {p.name} ({p.injury ? 'injured' : 'AHL'}): {label(pins[p.id])}
              <button className="text-ice-500 hover:text-red-300" disabled={!t.isMine || save.isPending} onClick={() => clear(p.id)} aria-label={`Clear ${p.name}'s placement`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map(([title, list]) => (
          <div key={title} className="min-w-0">
            <p className="mb-1 text-xs font-semibold tracking-wider text-ice-400 uppercase">{title}</p>
            <table className="table text-xs">
              <tbody>
                {list.map((p) => {
                  const pin = pins[p.id] ?? {};
                  const all = [p.pos, ...(p.altPos ?? [])];
                  const playsF = all.some((x) => x === 'C' || x === 'LW' || x === 'RW');
                  const playsD = all.includes('D');
                  // A player who also plays the other group can be placed there too.
                  const slots =
                    p.pos === 'G'
                      ? G_SLOTS
                      : playsF && playsD
                        ? [...(p.pos === 'D' ? D_SLOTS : F_SLOTS).slice(0, -1), ...(p.pos === 'D' ? F_SLOTS : D_SLOTS).slice(1, -1).map(([v, l]): [string, string] => [v, `${l} (${p.pos === 'D' ? 'up front' : 'on D'})`]), ['scratch', 'Healthy scratch'] as [string, string]]
                        : p.pos === 'D'
                          ? D_SLOTS
                          : F_SLOTS;
                  const fwd = p.pos !== 'G' && (playsF || /^L|top6|top9|bottom6/.test(pin.slot ?? ''));
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
                        <button
                          className={cx('ml-1 w-4 text-ice-500 hover:text-red-300', !(pin.slot || pin.pos) && 'invisible')}
                          disabled={!t.isMine || save.isPending}
                          onClick={() => clear(p.id)}
                          title={`Clear ${p.name}'s placement`}
                          aria-label={`Clear ${p.name}'s placement`}
                        >
                          ×
                        </button>
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
