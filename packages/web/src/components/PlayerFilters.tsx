import { useMemo, useState, type ReactNode } from 'react';
import { cx } from './ui';

/** The fields filters and sorting need; every player list in the app has them. */
export interface FilterablePlayer {
  name: string;
  pos: string;
  archetype: string;
  age: number;
  overall: number;
  contract: { salary: number; yearsLeft: number; expiresAs: string; kind: string } | null;
  injury?: unknown;
}

export interface Filters {
  pos: string;
  type: string;
  ageMin: string;
  ageMax: string;
  years: string;
  status: string;
  minOvr: string;
  health: string;
  /** Caller-defined toggles (e.g. "on their block"). */
  extras: Record<string, boolean>;
}

export const EMPTY_FILTERS: Filters = { pos: 'All', type: '', ageMin: '', ageMax: '', years: 'any', status: 'any', minOvr: '', health: 'any', extras: {} };

const POS: Record<string, (pos: string) => boolean> = {
  All: () => true,
  F: (p) => p === 'C' || p === 'LW' || p === 'RW',
  C: (p) => p === 'C',
  W: (p) => p === 'LW' || p === 'RW',
  LW: (p) => p === 'LW',
  RW: (p) => p === 'RW',
  D: (p) => p === 'D',
  G: (p) => p === 'G',
};

export function matchesFilters<T extends FilterablePlayer>(p: T, f: Filters, extraTests: Record<string, (p: T) => boolean> = {}): boolean {
  if (!POS[f.pos](p.pos)) return false;
  if (f.type && p.archetype !== f.type) return false;
  if (f.ageMin && p.age < Number(f.ageMin)) return false;
  if (f.ageMax && p.age > Number(f.ageMax)) return false;
  if (f.minOvr && p.overall < Number(f.minOvr)) return false;
  const c = p.contract;
  if (f.years !== 'any') {
    if (f.years === 'none' ? !!c : !c) return false;
    if (c && f.years !== 'none' && (f.years === '4' ? c.yearsLeft < 4 : c.yearsLeft !== Number(f.years))) return false;
  }
  if (f.status !== 'any') {
    if (!c) return false;
    if (f.status === 'ELC' ? c.kind !== 'ELC' : c.expiresAs !== f.status) return false;
  }
  if (f.health === 'healthy' && p.injury) return false;
  if (f.health === 'injured' && !p.injury) return false;
  for (const [k, on] of Object.entries(f.extras)) if (on && extraTests[k] && !extraTests[k](p)) return false;
  return true;
}

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.pos !== 'All') n++;
  if (f.type) n++;
  if (f.ageMin || f.ageMax) n++;
  if (f.years !== 'any') n++;
  if (f.status !== 'any') n++;
  if (f.minOvr) n++;
  if (f.health !== 'any') n++;
  n += Object.values(f.extras).filter(Boolean).length;
  return n;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold tracking-wider text-ice-500 uppercase">
      {label}
      <span className="mt-0.5 block normal-case">{children}</span>
    </label>
  );
}

/** A compact filter bar. `types` are the player types (archetypes) present in the list. */
export function PlayerFilterBar({
  value,
  onChange,
  types,
  extras = [],
  className,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  types: string[];
  extras?: Array<{ key: string; label: string }>;
  className?: string;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const n = activeFilterCount(value);
  return (
    <div className={cx('rounded-lg border border-rink-700 bg-rink-850 p-3', className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label="Position">
          <select className="slot" value={value.pos} onChange={(e) => set({ pos: e.target.value })}>
            {Object.keys(POS).map((p) => (
              <option key={p} value={p}>
                {p === 'F' ? 'Forwards' : p === 'W' ? 'Wingers' : p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select className="slot" value={value.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Age">
          <span className="flex items-center gap-1">
            <input className="slot text-center" inputMode="numeric" placeholder="min" value={value.ageMin} onChange={(e) => set({ ageMin: e.target.value.replace(/\D/g, '') })} />
            <span className="text-ice-500">–</span>
            <input className="slot text-center" inputMode="numeric" placeholder="max" value={value.ageMax} onChange={(e) => set({ ageMax: e.target.value.replace(/\D/g, '') })} />
          </span>
        </Field>
        <Field label="Years left">
          <select className="slot" value={value.years} onChange={(e) => set({ years: e.target.value })}>
            <option value="any">Any</option>
            <option value="1">1 (expiring)</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4+</option>
            <option value="none">Unsigned</option>
          </select>
        </Field>
        <Field label="Status after">
          <select className="slot" value={value.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="any">Any</option>
            <option value="UFA">UFA</option>
            <option value="RFA">RFA</option>
            <option value="ELC">On ELC</option>
          </select>
        </Field>
        <Field label="Min OVR">
          <input className="slot text-center" inputMode="numeric" placeholder="any" value={value.minOvr} onChange={(e) => set({ minOvr: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Health">
          <select className="slot" value={value.health} onChange={(e) => set({ health: e.target.value })}>
            <option value="any">Any</option>
            <option value="healthy">Healthy</option>
            <option value="injured">Injured</option>
          </select>
        </Field>
        <div className="flex items-end">
          <button className="w-full rounded-md px-2 py-1.5 text-sm font-semibold text-blue-300 hover:bg-rink-800 disabled:opacity-40" disabled={!n} onClick={() => onChange(EMPTY_FILTERS)}>
            Clear{n ? ` (${n})` : ''}
          </button>
        </div>
      </div>
      {extras.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {extras.map((x) => (
            <label key={x.key} className="flex items-center gap-1.5 text-sm text-ice-300">
              <input type="checkbox" checked={!!value.extras[x.key]} onChange={(e) => set({ extras: { ...value.extras, [x.key]: e.target.checked } })} />
              {x.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortKey = 'name' | 'pos' | 'type' | 'age' | 'overall' | 'aav' | 'years' | 'status';
const POS_ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };
const STATUS_ORDER: Record<string, number> = { UFA: 0, RFA: 1 };

const SORTERS: Record<SortKey, (p: FilterablePlayer) => number | string> = {
  name: (p) => p.name.split(' ').slice(-1)[0],
  pos: (p) => POS_ORDER[p.pos] ?? 9,
  type: (p) => p.archetype,
  age: (p) => p.age,
  overall: (p) => p.overall,
  aav: (p) => p.contract?.salary ?? -1,
  years: (p) => p.contract?.yearsLeft ?? 0,
  status: (p) => (p.contract ? (p.contract.kind === 'ELC' ? 2 : (STATUS_ORDER[p.contract.expiresAs] ?? 3)) : 4),
};
/** Numbers read best high-to-low first; text and positions low-to-high. */
const DEFAULT_DESC: Record<SortKey, boolean> = { name: false, pos: false, type: false, age: false, overall: true, aav: true, years: true, status: false };

export function useSort(initial: SortKey = 'overall') {
  const [key, setKey] = useState<SortKey>(initial);
  const [desc, setDesc] = useState(DEFAULT_DESC[initial]);
  const toggle = (k: SortKey) => {
    if (k === key) setDesc(!desc);
    else {
      setKey(k);
      setDesc(DEFAULT_DESC[k]);
    }
  };
  const sort = <T extends FilterablePlayer>(xs: T[]): T[] =>
    [...xs].sort((a, b) => {
      const x = SORTERS[key](a), y = SORTERS[key](b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (desc ? -c : c) || b.overall - a.overall;
    });
  return { key, desc, toggle, sort };
}

export function SortTh({ label, k, sort, className, title }: { label: string; k: SortKey; sort: ReturnType<typeof useSort>; className?: string; title?: string }) {
  const active = sort.key === k;
  return (
    <th className={className} title={title} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className={cx('inline-flex items-center gap-0.5 font-semibold uppercase hover:text-white', active && 'text-white')} onClick={() => sort.toggle(k)}>
        {label}
        <span className="text-[9px]">{active ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  );
}

/** Filters + the list of player types present, in one hook. */
export function usePlayerFilters<T extends FilterablePlayer>(players: T[], extraTests: Record<string, (p: T) => boolean> = {}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const types = useMemo(() => [...new Set(players.map((p) => p.archetype))].sort(), [players]);
  const filtered = players.filter((p) => matchesFilters(p, filters, extraTests));
  return { filters, setFilters, types, filtered };
}

/** Contract cells: AAV, years left and status after expiry, as separate columns. */
export function contractCells(c: FilterablePlayer['contract']) {
  return {
    years: c ? String(c.yearsLeft) : '—',
    status: c ? (c.kind === 'ELC' ? `ELC → ${c.expiresAs}` : c.expiresAs) : '—',
  };
}
