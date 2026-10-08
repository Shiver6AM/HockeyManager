/**
 * Trade search: find a target anywhere in the league. Filters run on the
 * server (only matching players come back), and so does sorting, so the top
 * rows are the best matches across the whole league, not just one page.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../format';
import { useTRPC, type Inputs, type Outputs } from '../trpc';
import { Badge, Button, Card, cx, Empty, PotentialBadge, RatingChange, Spinner, TeamLink } from './ui';

type Row = Outputs['trades']['search']['players'][number];
type Query = Inputs['trades']['search'];
type Range = { min: string; max: string };

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;
const STRATEGIES = [
  ['contend', 'Contending'],
  ['balanced', 'Balanced'],
  ['rebuild', 'Rebuilding'],
  ['human', 'Managers'],
] as const;
const WHERE = [
  ['nhl', 'NHL roster'],
  ['farm', 'AHL farm'],
  ['prospect', 'Unsigned prospects'],
] as const;
const RATING_LABEL: Record<string, string> = {
  skating: 'Skating',
  shooting: 'Shooting',
  passing: 'Passing',
  handling: 'Puck handling',
  offIQ: 'Offensive IQ',
  defIQ: 'Defensive IQ',
  checking: 'Checking',
  faceoffs: 'Faceoffs',
  discipline: 'Discipline',
  endurance: 'Endurance',
  reflexes: 'Reflexes',
  positioning: 'Positioning',
  rebounds: 'Rebound control',
  mental: 'Mental',
};
/** Stat ranges offered, with labels and (for display) decimals. */
const SKATER_STATS: Array<[string, string, string?]> = [
  ['gp', 'Games played'],
  ['g', 'Goals'],
  ['a', 'Assists'],
  ['p', 'Points'],
  ['ppg', 'Points / game'],
  ['gpg', 'Goals / game'],
  ['pm', 'Plus-minus'],
  ['pim', 'Penalty minutes'],
  ['sog', 'Shots'],
  ['shPct', 'Shooting %'],
  ['ppp', 'Power-play points'],
  ['shp', 'Shorthanded goals'],
  ['gwg', 'Game-winning goals'],
  ['hits', 'Hits'],
  ['blk', 'Blocked shots'],
  ['toi', 'TOI / game (min)'],
  ['foPct', 'Faceoff %'],
];
const GOALIE_STATS: Array<[string, string]> = [
  ['gp', 'Games played'],
  ['gs', 'Starts'],
  ['w', 'Wins'],
  ['svPct', 'Save % (e.g. .910)'],
  ['gaa', 'Goals-against avg'],
  ['so', 'Shutouts'],
];

interface Form {
  pos: string[];
  altPos: boolean;
  types: string[];
  shoots: '' | 'L' | 'R';
  name: string;
  age: Range;
  overall: Range;
  potential: Range; // grade strings
  value: Range;
  aav: Range;
  term: Range;
  ovrChange: Range;
  height: Range;
  weight: Range;
  coachability: Range;
  ratings: Record<string, Range>;
  stats: Record<string, Range>;
  goalieStats: Record<string, Range>;
  statSeason: 'recent' | 'current' | 'last';
  expiresAs: 'any' | 'UFA' | 'RFA' | 'ELC' | 'unsigned';
  health: 'any' | 'healthy' | 'injured';
  strategy: string[];
  teams: string[];
  traits: string[];
  where: string[];
  onBlock: boolean;
  fitsNeeds: boolean;
  affordable: boolean;
  sort: string;
  dir: 'asc' | 'desc';
}
const R: Range = { min: '', max: '' };
const EMPTY: Form = {
  pos: [],
  altPos: false,
  types: [],
  shoots: '',
  name: '',
  age: R,
  overall: R,
  potential: R,
  value: R,
  aav: R,
  term: R,
  ovrChange: R,
  height: R,
  weight: R,
  coachability: R,
  ratings: {},
  stats: {},
  goalieStats: {},
  statSeason: 'recent',
  expiresAs: 'any',
  health: 'any',
  strategy: [],
  teams: [],
  traits: [],
  where: ['nhl', 'farm'],
  onBlock: false,
  fitsNeeds: false,
  affordable: false,
  sort: 'value',
  dir: 'desc',
};

const num = (s: string) => {
  const v = Number(s.trim());
  return s.trim() === '' || !Number.isFinite(v) ? undefined : v;
};
const toRange = (r: Range) => {
  const min = num(r.min);
  const max = num(r.max);
  return min === undefined && max === undefined ? undefined : { min, max };
};
const isSet = (r: Range | undefined) => !!r && (r.min.trim() !== '' || r.max.trim() !== '');

/** Height "6-1" or "73" → inches. */
const inches = (s: string) => {
  const m = s.trim().match(/^(\d)['\-\s]+(\d{1,2})"?$/);
  return m ? String(Number(m[1]) * 12 + Number(m[2])) : s;
};
const feet = (h: number) => `${Math.floor(h / 12)}'${h % 12}"`;

function toQuery(leagueId: string, f: Form, grades: readonly string[]): Query {
  const map = (rs: Record<string, Range>, scale: Record<string, number> = {}) => {
    const out: Record<string, { min?: number; max?: number }> = {};
    for (const [k, r] of Object.entries(rs)) {
      const v = toRange(r);
      if (!v) continue;
      const s = scale[k] ?? 1;
      out[k] = { min: v.min === undefined ? undefined : v.min * s, max: v.max === undefined ? undefined : v.max * s };
    }
    return out;
  };
  const g = (s: string) => (s ? grades.indexOf(s) : -1);
  const goalieOnly = f.pos.length > 0 && f.pos.every((p) => p === 'G');
  const stats = goalieOnly ? map(f.goalieStats) : f.pos.includes('G') ? { ...map(f.stats), ...map(f.goalieStats) } : map(f.stats);
  // Save % typed as ".910" or "91.0": the server uses a fraction.
  if (stats.svPct) for (const k of ['min', 'max'] as const) if (stats.svPct[k] !== undefined && stats.svPct[k]! > 1) stats.svPct[k] = stats.svPct[k]! / 100;
  return {
    leagueId,
    pos: f.pos as Query['pos'],
    altPos: f.altPos,
    types: f.types,
    shoots: f.shoots || null,
    name: f.name,
    age: toRange(f.age),
    overall: toRange(f.overall),
    potential: g(f.potential.min) < 0 && g(f.potential.max) < 0 ? undefined : { min: g(f.potential.min) >= 0 ? g(f.potential.min) : undefined, max: g(f.potential.max) >= 0 ? g(f.potential.max) : undefined },
    value: toRange(f.value),
    aav: toRange(f.aav),
    term: toRange(f.term),
    ovrChange: toRange(f.ovrChange),
    height: toRange({ min: inches(f.height.min), max: inches(f.height.max) }),
    weight: toRange(f.weight),
    coachability: toRange(f.coachability),
    ratings: map(f.ratings),
    stats,
    statSeason: f.statSeason,
    expiresAs: f.expiresAs,
    health: f.health,
    strategy: f.strategy as Query['strategy'],
    teams: f.teams,
    traits: f.traits,
    where: (f.where.length ? f.where : ['nhl', 'farm']) as Query['where'],
    onBlock: f.onBlock,
    fitsNeeds: f.fitsNeeds,
    affordable: f.affordable,
    sort: f.sort,
    dir: f.dir,
    limit: 100,
  };
}

function activeCount(f: Form) {
  let n = 0;
  if (f.pos.length) n++;
  if (f.types.length) n++;
  if (f.shoots) n++;
  if (f.name.trim()) n++;
  for (const k of ['age', 'overall', 'potential', 'value', 'aav', 'term', 'ovrChange', 'height', 'weight', 'coachability'] as const) if (isSet(f[k])) n++;
  n += Object.values(f.ratings).filter(isSet).length;
  n += Object.values(f.stats).filter(isSet).length;
  n += Object.values(f.goalieStats).filter(isSet).length;
  if (f.expiresAs !== 'any') n++;
  if (f.health !== 'any') n++;
  if (f.strategy.length) n++;
  if (f.teams.length) n++;
  if (f.traits.length) n++;
  if (f.where.join() !== 'nhl,farm') n++;
  if (f.onBlock) n++;
  if (f.fitsNeeds) n++;
  if (f.affordable) n++;
  return n;
}

function load(leagueId: string): Form {
  try {
    const raw = sessionStorage.getItem(`hgm:tradeSearch:${leagueId}`);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return EMPTY;
}
function save(leagueId: string, f: Form) {
  try {
    sessionStorage.setItem(`hgm:tradeSearch:${leagueId}`, JSON.stringify(f));
  } catch {
    /* storage unavailable */
  }
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- small form pieces ---------- */

function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cx('block text-[11px] font-semibold tracking-wider text-ice-500 uppercase', className)} title={hint}>
      {label}
      <span className="mt-0.5 block normal-case">{children}</span>
    </label>
  );
}

function RangeIn({ value, onChange, placeholder = ['min', 'max'], decimal }: { value: Range; onChange: (r: Range) => void; placeholder?: [string, string]; decimal?: boolean }) {
  const clean = (s: string) => (decimal ? s.replace(/[^\d.\-']/g, '') : s.replace(/[^\d\-']/g, ''));
  return (
    <span className="flex items-center gap-1">
      <input className="slot px-1 text-center" inputMode="decimal" placeholder={placeholder[0]} value={value.min} onChange={(e) => onChange({ ...value, min: clean(e.target.value) })} />
      <span className="text-ice-500">–</span>
      <input className="slot px-1 text-center" inputMode="decimal" placeholder={placeholder[1]} value={value.max} onChange={(e) => onChange({ ...value, max: clean(e.target.value) })} />
    </span>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={on}
      className={cx('rounded-md border px-2 py-1 text-xs font-semibold', on ? 'border-blueline bg-blueline/25 text-white' : 'border-rink-600 bg-rink-800 text-ice-400 hover:text-ice-100')}
    >
      {children}
    </button>
  );
}

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** A dropdown of checkboxes. */
function MultiPick({ label, options, value, onChange, empty }: { label: string; options: Array<{ id: string; label: string; group?: string }>; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  const shown = value.length ? (value.length <= 2 ? value.map((v) => options.find((o) => o.id === v)?.label ?? v).join(', ') : `${value.length} selected`) : empty;
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const ref = useRef<HTMLDetailsElement>(null);
  // Close on a click elsewhere or Escape.
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (d?.open && (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !d.contains(e.target as Node))) d.open = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details ref={ref} className="group relative">
      <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-1 truncate rounded-md border border-rink-600 bg-rink-800 px-2 py-1.5 text-sm font-normal tracking-normal text-ice-50 [&::-webkit-details-marker]:hidden" aria-label={label}>
        <span className={cx('truncate', !value.length && 'text-ice-400')}>{shown}</span>
        <span className="text-ice-500">▾</span>
      </summary>
      <div className="absolute z-30 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-rink-600 bg-rink-900 p-2 shadow-xl shadow-black/50">
        {value.length > 0 && (
          <button type="button" className="mb-1 text-xs text-blue-300 hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
        {groups.map((g) => (
          <div key={g}>
            {g && <p className="mt-1 text-[10px] font-semibold tracking-wider text-ice-500 uppercase">{g}</p>}
            {options
              .filter((o) => (o.group ?? '') === g)
              .map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-ice-200 hover:bg-rink-800">
                  <input type="checkbox" checked={value.includes(o.id)} onChange={() => onChange(toggle(value, o.id))} />
                  {o.label}
                </label>
              ))}
          </div>
        ))}
      </div>
    </details>
  );
}

/* ---------- the tab ---------- */

export function TradeSearch({ leagueId, onTradeFor }: { leagueId: string; onTradeFor: (teamId: string, playerId: string) => void }) {
  const trpc = useTRPC();
  const catalog = useQuery(trpc.trades.searchCatalog.queryOptions({ leagueId }));
  const [f, setF] = useState<Form>(() => load(leagueId));
  const [more, setMore] = useState(() => Object.values(f.ratings).some(isSet) || isSet(f.height) || isSet(f.weight) || isSet(f.coachability));
  const [statsOpen, setStatsOpen] = useState(() => Object.values(f.stats).some(isSet) || Object.values(f.goalieStats).some(isSet));
  const set = (patch: Partial<Form>) =>
    setF((x) => {
      const next = { ...x, ...patch };
      save(leagueId, next);
      return next;
    });
  const grades = catalog.data?.grades ?? [];
  const query = useMemo(() => toQuery(leagueId, f, grades), [leagueId, f, grades]);
  const q = useDebounced(query);
  const res = useQuery({ ...trpc.trades.search.queryOptions(q), enabled: !!catalog.data, placeholderData: keepPreviousData });
  const teamsById = useMemo(() => new Map((catalog.data?.teams ?? []).map((t) => [t.id, t])), [catalog.data]);

  if (!catalog.data) return <Spinner />;
  const c = catalog.data;
  const goalieOnly = f.pos.length > 0 && f.pos.every((p) => p === 'G');
  const skatersShown = !goalieOnly;
  const goaliesShown = !f.pos.length || f.pos.includes('G');
  const posGroups = new Set<string>(f.pos.map((p) => (p === 'G' ? 'G' : p === 'D' ? 'D' : 'F')));
  const typeOptions = c.types
    .filter((t) => !posGroups.size || t.groups.some((g: string) => posGroups.has(g)))
    .map((t) => ({ id: t.name, label: t.name, group: t.groups.includes('G') ? 'Goalies' : t.groups.includes('D') && !t.groups.includes('F') ? 'Defense' : 'Forwards' }));
  const n = activeCount(f);
  const sortBy = (k: string) => set(f.sort === k ? { dir: f.dir === 'desc' ? 'asc' : 'desc' } : { sort: k, dir: k === 'name' || k === 'team' || k === 'pos' || k === 'age' || k === 'aav' || k === 's.gaa' ? 'asc' : 'desc' });
  const Th = ({ k, children, className, title }: { k: string; children: ReactNode; className?: string; title?: string }) => (
    <th className={cx('cursor-pointer select-none hover:text-ice-100', className, f.sort === k && 'text-white')} onClick={() => sortBy(k)} title={title} aria-sort={f.sort === k ? (f.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {children}
      {f.sort === k && (f.dir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  );
  const ratingKeys = [...(skatersShown ? c.skaterRatings : []), ...(goaliesShown ? c.goalieRatings : [])];
  const data = res.data;

  return (
    <div className="space-y-4">
      <Card
        title="Find a trade target"
        action={
          <span className="flex items-center gap-3 text-xs">
            {n > 0 && <span className="text-ice-400">{n} filter{n === 1 ? '' : 's'} on</span>}
            <button className="text-blue-300 hover:underline disabled:opacity-40" disabled={!n} onClick={() => set({ ...EMPTY, sort: f.sort, dir: f.dir })}>
              Reset
            </button>
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <Field label="Position">
              <span className="flex flex-wrap items-center gap-1">
                {POSITIONS.map((p) => (
                  <Chip key={p} on={f.pos.includes(p)} onClick={() => set({ pos: toggle(f.pos, p) })}>
                    {p}
                  </Chip>
                ))}
                <label className="ml-1 flex items-center gap-1 text-xs text-ice-400" title="Also include players who can play the position, not only those listed at it">
                  <input type="checkbox" checked={f.altPos} onChange={(e) => set({ altPos: e.target.checked })} /> can play
                </label>
              </span>
            </Field>
            <Field label="Player type" className="w-52">
              <MultiPick label="Player type" options={typeOptions} value={f.types} onChange={(types) => set({ types })} empty="All types" />
            </Field>
            <Field label="Shoots" className="w-24">
              <select className="slot" value={f.shoots} onChange={(e) => set({ shoots: e.target.value as Form['shoots'] })}>
                <option value="">Either</option>
                <option value="L">Left</option>
                <option value="R">Right</option>
              </select>
            </Field>
            <Field label="Name" className="w-44">
              <input className="slot" placeholder="Search by name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Where" className="">
              <span className="flex flex-wrap gap-1">
                {WHERE.map(([k, label]) => (
                  <Chip key={k} on={f.where.includes(k)} onClick={() => set({ where: toggle(f.where, k) })}>
                    {label}
                  </Chip>
                ))}
              </span>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
            <Field label="Age">
              <RangeIn value={f.age} onChange={(age) => set({ age })} />
            </Field>
            <Field label="Overall">
              <RangeIn value={f.overall} onChange={(overall) => set({ overall })} />
            </Field>
            <Field label="Potential" hint="Your scouts' grade for his ceiling">
              <span className="flex items-center gap-1">
                <select className="slot px-1" value={f.potential.min} onChange={(e) => set({ potential: { ...f.potential, min: e.target.value } })} aria-label="Lowest potential">
                  <option value="">min</option>
                  {grades.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <span className="text-ice-500">–</span>
                <select className="slot px-1" value={f.potential.max} onChange={(e) => set({ potential: { ...f.potential, max: e.target.value } })} aria-label="Highest potential">
                  <option value="">max</option>
                  {grades.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </span>
            </Field>
            <Field label="Trade value" hint="League-wide trade value (about 600 is a franchise player)">
              <RangeIn value={f.value} onChange={(value) => set({ value })} />
            </Field>
            <Field label="AAV ($M)" hint="Cap hit, in millions">
              <RangeIn value={f.aav} onChange={(aav) => set({ aav })} decimal />
            </Field>
            <Field label="Term (yrs left)">
              <RangeIn value={f.term} onChange={(term) => set({ term })} />
            </Field>
            <Field label="OVR change" hint="Change in overall since the end of last season (e.g. min 2 = risers)">
              <RangeIn value={f.ovrChange} onChange={(ovrChange) => set({ ovrChange })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
            <Field label="Contract">
              <select className="slot" value={f.expiresAs} onChange={(e) => set({ expiresAs: e.target.value as Form['expiresAs'] })}>
                <option value="any">Any</option>
                <option value="UFA">Becomes UFA</option>
                <option value="RFA">Becomes RFA</option>
                <option value="ELC">On entry-level deal</option>
                <option value="unsigned">Unsigned</option>
              </select>
            </Field>
            <Field label="Health">
              <select className="slot" value={f.health} onChange={(e) => set({ health: e.target.value as Form['health'] })}>
                <option value="any">Any</option>
                <option value="healthy">Healthy</option>
                <option value="injured">Injured</option>
              </select>
            </Field>
            <Field label="Teams">
              <MultiPick
                label="Teams"
                options={c.teams.map((t) => ({ id: t.id, label: `${t.city} ${t.name}`, group: `${t.conference} · ${t.division}` })).sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))}
                value={f.teams}
                onChange={(teams) => set({ teams })}
                empty="All teams"
              />
            </Field>
            <Field label="Team direction" hint="AI front offices' plan for the season, or teams run by managers">
              <MultiPick label="Team direction" options={STRATEGIES.map(([id, label]) => ({ id, label }))} value={f.strategy} onChange={(strategy) => set({ strategy })} empty="Any" />
            </Field>
            <Field label="Traits" hint="Has any of these traits">
              <MultiPick
                label="Traits"
                options={c.traits.filter((t) => (t.who === 'goalie' ? goaliesShown : skatersShown)).map((t) => ({ id: t.id, label: t.label, group: t.who === 'goalie' ? 'Goalie' : 'Skater' }))}
                value={f.traits}
                onChange={(traits) => set({ traits })}
                empty="Any"
              />
            </Field>
            <div className="col-span-2 flex flex-wrap items-end gap-x-3 gap-y-1 pb-1 text-sm text-ice-300">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.onBlock} onChange={(e) => set({ onBlock: e.target.checked })} /> On their block
              </label>
              <label className="flex items-center gap-1.5" title="Fills one of the needs on your trade block">
                <input type="checkbox" checked={f.fitsNeeds} onChange={(e) => set({ fitsNeeds: e.target.checked })} /> Fits my needs
              </label>
              <label className="flex items-center gap-1.5" title={data?.capRoom !== null && data?.capRoom !== undefined ? `Cap hit at most your cap space (${money(data.capRoom)})` : undefined}>
                <input type="checkbox" checked={f.affordable} onChange={(e) => set({ affordable: e.target.checked })} /> Fits my cap space
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-rink-700 pt-3">
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setStatsOpen((v) => !v)} aria-expanded={statsOpen}>
              {statsOpen ? '▾' : '▸'} Game stats{Object.values(f.stats).filter(isSet).length + Object.values(f.goalieStats).filter(isSet).length ? ` (${Object.values(f.stats).filter(isSet).length + Object.values(f.goalieStats).filter(isSet).length})` : ''}
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? '▾' : '▸'} Ratings, size and coachability
              {Object.values(f.ratings).filter(isSet).length + [f.height, f.weight, f.coachability].filter(isSet).length
                ? ` (${Object.values(f.ratings).filter(isSet).length + [f.height, f.weight, f.coachability].filter(isSet).length})`
                : ''}
            </Button>
          </div>

          {statsOpen && (
            <div className="space-y-2 rounded-lg border border-rink-700 bg-rink-850 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-ice-300">
                Stats from
                <select className="slot !w-auto" value={f.statSeason} onChange={(e) => set({ statSeason: e.target.value as Form['statSeason'] })}>
                  <option value="recent">This season (last season until he's played)</option>
                  <option value="current">This season only</option>
                  <option value="last">Last season</option>
                </select>
                <span className="text-xs text-ice-500">Regular season. Players without stats in that season drop out once a stat range is set.</span>
              </div>
              {skatersShown && (
                <>
                  {goaliesShown && <p className="text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Skaters</p>}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
                    {SKATER_STATS.map(([k, label]) => (
                      <Field key={k} label={label}>
                        <RangeIn value={f.stats[k] ?? R} onChange={(r) => set({ stats: { ...f.stats, [k]: r } })} decimal />
                      </Field>
                    ))}
                  </div>
                </>
              )}
              {goaliesShown && (
                <>
                  {skatersShown && <p className="pt-1 text-[11px] font-semibold tracking-wider text-ice-500 uppercase">Goalies (applies when Position includes G)</p>}
                  <div className={cx('grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-6', skatersShown && !f.pos.includes('G') && 'opacity-50')}>
                    {GOALIE_STATS.map(([k, label]) => (
                      <Field key={k} label={label}>
                        <RangeIn value={f.goalieStats[k] ?? R} onChange={(r) => set({ goalieStats: { ...f.goalieStats, [k]: r } })} decimal />
                      </Field>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {more && (
            <div className="space-y-2 rounded-lg border border-rink-700 bg-rink-850 p-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
                {ratingKeys.map((k) => (
                  <Field key={k} label={RATING_LABEL[k] ?? k}>
                    <RangeIn value={f.ratings[k] ?? R} onChange={(r) => set({ ratings: { ...f.ratings, [k]: r } })} />
                  </Field>
                ))}
                <Field label="Height" hint={`Feet-inches (6-1) or inches (73)`}>
                  <RangeIn value={f.height} onChange={(height) => set({ height })} placeholder={['5-10', '6-4']} />
                </Field>
                <Field label="Weight (lb)">
                  <RangeIn value={f.weight} onChange={(weight) => set({ weight })} />
                </Field>
                <Field label="Coachability" hint="How much he gets out of coaching (0–100)">
                  <RangeIn value={f.coachability} onChange={(coachability) => set({ coachability })} />
                </Field>
              </div>
              {goaliesShown && skatersShown && <p className="text-xs text-ice-500">A rating range rules out players who don't have that rating (goalie ratings rule out skaters, and the reverse).</p>}
            </div>
          )}
        </div>
      </Card>

      <Card
        title={data ? `${data.total} player${data.total === 1 ? '' : 's'} found` : 'Results'}
        action={data && data.total > data.players.length ? <span className="text-xs text-ice-400">Showing the top {data.players.length} by the sorted column; narrow the filters to see the rest</span> : undefined}
      >
        {!data ? (
          <Spinner />
        ) : !data.players.length ? (
          <Empty>No players match. Try widening a range or clearing a filter.</Empty>
        ) : (
          <div className={cx('-mx-4 max-h-[44rem] overflow-auto transition-opacity', res.isPlaceholderData && 'opacity-60')}>
            <table className="table">
              <thead className="sticky top-0 z-10 bg-rink-900">
                <tr>
                  <Th k="team">Team</Th>
                  <Th k="name">Player</Th>
                  <Th k="pos">Pos</Th>
                  <Th k="age" className="num">Age</Th>
                  <Th k="overall" className="num">OVR</Th>
                  <Th k="potential">Pot</Th>
                  <Th k="value" className="num" title="League-wide trade value (about 600 is a franchise player)">Value</Th>
                  <Th k="aav" className="num">AAV</Th>
                  <Th k="term" className="num" title="Years left">Yrs</Th>
                  <th>Expiry</th>
                  {goalieOnly ? (
                    <>
                      <Th k="s.gp" className="num">GP</Th>
                      <Th k="s.w" className="num">W</Th>
                      <Th k="s.svPct" className="num">SV%</Th>
                      <Th k="s.gaa" className="num">GAA</Th>
                      <Th k="s.so" className="num">SO</Th>
                    </>
                  ) : (
                    <>
                      <Th k="s.gp" className="num">GP</Th>
                      <Th k="s.g" className="num">G</Th>
                      <Th k="s.a" className="num">A</Th>
                      <Th k="s.p" className="num">P</Th>
                      <Th k="s.ppg" className="num" title="Points per game">P/GP</Th>
                      <Th k="s.pm" className="num">+/-</Th>
                      <Th k="s.toi" className="num" title="Time on ice per game">TOI</Th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <ResultRow key={p.id} p={p} leagueId={leagueId} team={teamsById.get(p.teamId)!} goalieOnly={goalieOnly} onTradeFor={() => onTradeFor(p.teamId, p.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.players.some((p) => p.stats) && (
          <p className="mt-3 text-[11px] text-ice-500">
            Stats: {f.statSeason === 'last' ? 'last season' : f.statSeason === 'current' ? 'this season' : 'this season, or last season for players who haven’t played yet'}. Potential is your scouts' grade. Green rows fit a need on your trade block.
          </p>
        )}
      </Card>
    </div>
  );
}

function ResultRow({ p, leagueId, team, goalieOnly, onTradeFor }: { p: Row; leagueId: string; team: Outputs['trades']['searchCatalog']['teams'][number]; goalieOnly: boolean; onTradeFor: () => void }) {
  const s = p.stats as Record<string, number | null> | null;
  const v = (k: string, d = 0) => (s && s[k] !== null && s[k] !== undefined ? (d ? s[k]!.toFixed(d) : String(s[k])) : '—');
  const isG = p.pos === 'G';
  const statTitle = s ? `${s.season}-${String((s.season ?? 0) + 1).slice(2)} regular season` : 'No games in that season';
  return (
    <tr className={cx(p.fits.length > 0 && 'bg-win/5')}>
      <td>
        <TeamLink leagueId={leagueId} team={team} />
      </td>
      <td className="max-w-72 whitespace-nowrap">
        <Link to={`/league/${leagueId}/player/${p.id}`} className="hover:underline">
          {p.name}
        </Link>
        <span className="ml-1.5 inline-flex gap-1 align-middle">
          {p.where === 'farm' && <Badge>AHL</Badge>}
          {p.where === 'prospect' && <Badge>Prospect</Badge>}
          {p.onBlock && <Badge tone="warn">On block</Badge>}
          {p.injury && (
            <span title={`${p.injury.type} · ${p.injury.severity}, about ${p.injury.daysLeft} days`}>
              <Badge tone="bad">Inj</Badge>
            </span>
          )}
          {p.fits.length > 0 && <Badge tone="good">Fits</Badge>}
        </span>
        <div className="truncate text-[11px] text-ice-500" title={p.traits.map((t) => `${t.label} (${t.tierName})`).join(', ') || undefined}>
          {p.archetype} · shoots {p.shoots} · {feet(p.height)}, {p.weight} lb
          {p.traits.length > 0 && <> · {p.traits.map((t) => t.label).join(', ')}</>}
        </div>
      </td>
      <td className="text-ice-400">
        {p.pos}
        {p.altPos.length > 0 && <span className="text-[10px] text-ice-500">/{p.altPos.join('/')}</span>}
      </td>
      <td className="num">{p.age}</td>
      <td className="num">
        <RatingChange value={p.overall} change={p.ovrChange} />
      </td>
      <td>
        <PotentialBadge potential={p.potential} />
      </td>
      <td className="num tabular font-semibold">{p.value}</td>
      <td className="num tabular">{p.contract ? money(p.contract.salary) : '—'}</td>
      <td className="num tabular">{p.contract ? p.contract.yearsLeft : '—'}</td>
      <td className="text-xs text-ice-400">{p.contract ? (p.contract.kind === 'ELC' ? `ELC → ${p.contract.expiresAs}` : p.contract.expiresAs) : 'unsigned'}</td>
      {goalieOnly ? (
        <>
          <td className="num" title={statTitle}>{v('gp')}</td>
          <td className="num">{v('w')}</td>
          <td className="num">{s?.svPct !== null && s?.svPct !== undefined ? s.svPct.toFixed(3).replace(/^0/, '') : '—'}</td>
          <td className="num">{v('gaa', 2)}</td>
          <td className="num">{v('so')}</td>
        </>
      ) : isG ? (
        <>
          <td className="num" title={statTitle}>{v('gp')}</td>
          <td className="text-center text-xs text-ice-500" colSpan={6}>
            {s ? `${v('w')} W · ${s.svPct !== null ? s.svPct!.toFixed(3).replace(/^0/, '') : '—'} SV% · ${v('gaa', 2)} GAA` : '—'}
          </td>
        </>
      ) : (
        <>
          <td className="num" title={statTitle}>{v('gp')}</td>
          <td className="num">{v('g')}</td>
          <td className="num">{v('a')}</td>
          <td className="num font-semibold text-white">{v('p')}</td>
          <td className="num">{v('ppg', 2)}</td>
          <td className={cx('num', (s?.pm ?? 0) > 0 ? 'text-win' : (s?.pm ?? 0) < 0 ? 'text-red-300' : '')}>{s ? `${s.pm! > 0 ? '+' : ''}${s.pm}` : '—'}</td>
          <td className="num">{s?.toi !== null && s?.toi !== undefined ? `${Math.floor(s.toi)}:${String(Math.round((s.toi % 1) * 60)).padStart(2, '0')}` : '—'}</td>
        </>
      )}
      <td>
        <Button variant="ghost" className="px-2 py-0.5 text-xs whitespace-nowrap" onClick={onTradeFor}>
          Trade for →
        </Button>
      </td>
    </tr>
  );
}
