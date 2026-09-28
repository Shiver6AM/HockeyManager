import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC, type Outputs } from '../trpc';
import { Badge, Card, cx, ErrorBox } from './ui';

type TeamData = Outputs['data']['team'];
type Group = 'forecheck' | 'offense' | 'pp' | 'pk';

const GROUPS: Array<{ key: Group; title: string; intro: string }> = [
  {
    key: 'forecheck',
    title: 'Forecheck',
    intro: 'How your forwards pressure in the offensive zone and neutral zone.',
  },
  {
    key: 'offense',
    title: 'Offensive-zone style',
    intro: 'How you generate chances at even strength.',
  },
  {
    key: 'pp',
    title: 'Power-play formation',
    intro: 'Sets the spots on your power-play units (lines editor).',
  },
  {
    key: 'pk',
    title: 'Penalty kill',
    intro: 'How your penalty killers defend.',
  },
];

function fitTone(v: number) {
  const t = Math.max(0, Math.min(1, (v - 60) / 25));
  return {
    background: `hsl(142 ${Math.round(12 + 58 * t)}% ${Math.round(95 - 50 * t)}%)`,
    color: t > 0.78 ? '#fff' : '#0b1220',
  };
}

/**
 * The coach's systems. Each choice shows how well the roster's best players fit
 * it; the sim rewards good fits and a system's own strengths, so there's no
 * single best answer.
 */
export function TacticsPanel({ t, leagueId }: { t: TeamData; leagueId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const set = useMutation(
    trpc.data.setTactics.mutationOptions({
      onSuccess: () => qc.invalidateQueries(),
    }),
  );
  const current = t.tactics;
  const choose = (g: Group, id: string) =>
    set.mutate({
      leagueId,
      tactics: { ...current, [g]: id } as typeof current,
    });

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-ice-300">
          Systems change how your team plays in the simulation. Each option's <span className="font-semibold text-white">fit</span> is how well your best
          players suit it, using their role skills (net front, point, forecheck, penalty killing…), which come from their ratings and playing style: a power
          forward is built for the net front and the forecheck, an offensive defenseman for the point. What matters is how much better your players suit one
          option than the others: the <span className="font-semibold text-white">rtg</span> chip is roughly what that's worth, in rating points for everyone on
          the ice. Playing against your roster's grain can cost several wins a season.
          {t.isMine ? ' Changes apply from the next game.' : ''}
        </p>
        {t.isMine && t.autoLines && (
          <p className="mt-2 text-xs text-ice-400">Your assistant coach is setting lines, so special units are rebuilt to suit each change.</p>
        )}
        <ErrorBox error={set.error} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {GROUPS.map((g) => {
          const options = t.systems[g.key] as Array<{
            id: string;
            label: string;
            help: string;
            slots?: Array<{ label: string; role: string }>;
          }>;
          const fits = t.systemFits[g.key] as Record<string, number>;
          const impact = (t.systemImpact[g.key] ?? {}) as Record<string, number>;
          return (
            <Card key={g.key} title={g.title}>
              <p className="mb-3 text-xs text-ice-400">{g.intro}</p>
              <div className="space-y-2">
                {options.map((o) => {
                  const on = current[g.key] === o.id;
                  const rec = t.recommendedTactics[g.key] === o.id;
                  return (
                    <button
                      key={o.id}
                      disabled={!t.isMine || set.isPending}
                      onClick={() => choose(g.key, o.id)}
                      className={cx(
                        'block w-full rounded-lg border p-3 text-left transition',
                        on ? 'border-blueline bg-blueline/10' : 'border-rink-700 hover:border-rink-500',
                        !t.isMine && 'cursor-default',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className={cx('h-3 w-3 shrink-0 rounded-full border', on ? 'border-blueline bg-blueline' : 'border-rink-500')} />
                        <span className="flex-1 font-semibold text-white">{o.label}</span>
                        {rec && <Badge tone="info">Coach's pick</Badge>}
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          style={fitTone(fits[o.id])}
                          title="How well your best players fit this system"
                        >
                          Fit {Math.round(fits[o.id])}
                        </span>
                        {impact[o.id] !== undefined && (
                          <span
                            className={cx(
                              'tabular rounded px-1.5 py-0.5 text-[11px] font-semibold',
                              impact[o.id] >= 0.3 ? 'bg-win/20 text-win' : impact[o.id] <= -0.3 ? 'bg-goal/15 text-red-200' : 'bg-rink-800 text-ice-300',
                            )}
                            title="Roughly what this choice is worth to your players on the ice, in rating points (0 = a typical, well-chosen system). It comes from how much better they suit this option than the others."
                          >
                            {impact[o.id] >= 0 ? '+' : '−'}
                            {Math.abs(impact[o.id]).toFixed(1)} rtg
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block pl-5 text-xs text-ice-400">{o.help}</span>
                      {o.slots && (
                        <span className="mt-1.5 flex flex-wrap gap-1 pl-5">
                          {o.slots.map((sl, i) => (
                            <span key={i} className="rounded bg-rink-800 px-1.5 py-0.5 text-[10px] text-ice-300">
                              {sl.label}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
      <Card title="Role skills">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {t.systems.roles.map((r) => (
            <li key={r.id}>
              <span className="font-semibold text-ice-100">{r.label}</span> <span className="text-ice-400">· {r.help}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
