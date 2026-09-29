/**
 * A quick look at a player from the lines editor: his ratings, situational
 * (special-teams role) skills and this season's stats, without leaving the page.
 */
import { Link } from 'react-router-dom';
import { gaa, ht, signed, svPct, toi } from '../format';
import type { Outputs } from '../trpc';
import { Modal, PotentialBadge, Rating } from './ui';

type TeamData = Outputs['data']['team'];
type P = TeamData['players'][number];
type Catalog = TeamData['systems'];

const SKATER: [string, string][] = [
  ['skating', 'Skating'],
  ['shooting', 'Shooting'],
  ['passing', 'Passing'],
  ['handling', 'Puck handling'],
  ['offIQ', 'Offensive IQ'],
  ['defIQ', 'Defensive IQ'],
  ['checking', 'Checking'],
  ['faceoffs', 'Faceoffs'],
  ['discipline', 'Discipline'],
  ['endurance', 'Endurance'],
];
const GOALIE: [string, string][] = [
  ['reflexes', 'Reflexes'],
  ['positioning', 'Positioning'],
  ['rebounds', 'Rebound control'],
  ['mental', 'Mental'],
];

function Bar({ label, value, help, highlight }: { label: string; value: number; help?: string; highlight?: boolean }) {
  const tone = value >= 80 ? 'bg-win' : value >= 70 ? 'bg-blueline' : value >= 60 ? 'bg-ice-400' : 'bg-rink-500';
  return (
    <div className="flex items-center gap-2 text-xs" title={help}>
      <span className={highlight ? 'w-28 shrink-0 font-semibold text-white' : 'w-28 shrink-0 text-ice-300'}>{label}</span>
      <span className="h-1.5 flex-1 rounded-full bg-rink-700">
        <span className={`block h-1.5 rounded-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </span>
      <span className="tabular w-7 text-right text-ice-100">{Math.round(value)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-rink-850 px-2 py-1.5 text-center">
      <p className="tabular text-base font-semibold text-white">{value}</p>
      <p className="text-[10px] tracking-wider text-ice-500 uppercase">{label}</p>
    </div>
  );
}

export function PlayerPeek({ p, catalog, leagueId, onClose }: { p: P; catalog: Catalog; leagueId: string; onClose: () => void }) {
  const ratings = (p.pos === 'G' ? p.goalie : p.skater) as Record<string, number> | null;
  const roles = catalog.roles.map((r) => ({ ...r, value: (p.roles as Record<string, number>)[r.id] ?? 0 }));
  const best = new Set([...roles].sort((a, b) => b.value - a.value).slice(0, 3).map((r) => r.id));
  const s = p.stats;
  const gs = p.goalieStats;
  return (
    <Modal
      title={
        <span>
          {p.name} · {p.pos} · {p.archetype}
        </span>
      }
      onClose={onClose}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ice-300">
        <span>
          Overall <Rating value={p.overall} />
        </span>
        <span>Age {p.age}</span>
        <span>
          {ht(p.height)} · {p.weight} lb
        </span>
        <PotentialBadge potential={p.potential} showLabel />
        <span title="How much he gets out of coaching">Coachability: {p.coachabilityLabel}</span>
        {p.contract && <span>{`$${(p.contract.salary / 1e6).toFixed(2)}M × ${p.contract.yearsLeft} yr`}</span>}
        {p.injury && <span className="text-red-300">Injured: {p.injury.type} ({p.injury.daysLeft} days)</span>}
        <Link to={`/league/${leagueId}/player/${p.id}`} className="ml-auto text-blue-300 hover:underline">
          Full player page →
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Ratings</h3>
          <div className="space-y-1.5">
            {(p.pos === 'G' ? GOALIE : SKATER).map(([k, label]) => (ratings && ratings[k] !== undefined ? <Bar key={k} label={label} value={ratings[k]} /> : null))}
          </div>
        </div>
        {p.pos !== 'G' ? (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Situational skills</h3>
            <div className="space-y-1.5">
              {roles.map((r) => (
                <Bar key={r.id} label={r.label} value={r.value} help={r.help} highlight={best.has(r.id)} />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ice-500">His three best spots are in bold. Put him in those spots on special units for a rating bonus.</p>
          </div>
        ) : (
          <div />
        )}
      </div>

      <h3 className="mt-5 mb-2 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Stats</h3>
      {p.pos === 'G' ? (
        gs ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            <Stat label="GP" value={gs.gp} />
            <Stat label="W" value={gs.w} />
            <Stat label="L" value={gs.l} />
            <Stat label="OTL" value={gs.otl} />
            <Stat label="SV%" value={svPct(gs.sa, gs.ga)} />
            <Stat label="GAA" value={gaa(gs.ga, gs.toi)} />
            <Stat label="SO" value={gs.so} />
            <Stat label="SA" value={gs.sa} />
          </div>
        ) : (
          <p className="text-sm text-ice-500">No games yet.</p>
        )
      ) : s ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          <Stat label="GP" value={s.gp} />
          <Stat label="G" value={s.g} />
          <Stat label="A" value={s.a} />
          <Stat label="P" value={s.g + s.a} />
          <Stat label="+/-" value={signed(s.pm)} />
          <Stat label="PPP" value={s.ppg + s.ppa} />
          <Stat label="SOG" value={s.sog} />
          <Stat label="TOI/GP" value={toi(s.toi, s.gp)} />
          <Stat label="Hits" value={s.hits} />
          <Stat label="Blocks" value={s.blk} />
          <Stat label="PIM" value={s.pim} />
          <Stat label="FO%" value={s.fow + s.fol ? `${Math.round((s.fow / (s.fow + s.fol)) * 100)}` : '—'} />
        </div>
      ) : (
        <p className="text-sm text-ice-500">No games yet.</p>
      )}
    </Modal>
  );
}
