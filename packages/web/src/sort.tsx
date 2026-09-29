/**
 * Sortable tables: click any column header to sort by it, click again to flip.
 * The choice is remembered for the session under `storageKey`.
 */
import { useMemo, useState, type ReactNode, type ThHTMLAttributes } from 'react';
import { cx } from './components/ui';

export type SortValue = number | string | null | undefined;
export type SortDir = 'asc' | 'desc';

function load(key?: string): { key: string; dir: SortDir } | null {
  if (!key) return null;
  try {
    const v = sessionStorage.getItem(`hgm:sort:${key}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function useSort<T>(rows: T[], columns: Record<string, (r: T) => SortValue>, initial: { key: string; dir?: SortDir }, storageKey?: string) {
  const [state, setState] = useState<{ key: string; dir: SortDir }>(() => {
    const saved = load(storageKey);
    return saved && columns[saved.key] ? saved : { key: initial.key, dir: initial.dir ?? 'desc' };
  });
  const sorted = useMemo(() => {
    const get = columns[state.key];
    if (!get) return rows;
    const m = state.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      // Blanks always sort last.
      if (x === null || x === undefined || x === '') return y === null || y === undefined || y === '' ? 0 : 1;
      if (y === null || y === undefined || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
      return String(x).localeCompare(String(y)) * m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state.key, state.dir]);
  const toggle = (key: string) => {
    setState((s) => {
      // Text columns start A→Z; numbers start high→low.
      const first = rows.length && typeof columns[key]?.(rows[0]) === 'string' ? 'asc' : 'desc';
      const next = s.key === key ? { key, dir: (s.dir === 'asc' ? 'desc' : 'asc') as SortDir } : { key, dir: first as SortDir };
      try {
        if (storageKey) sessionStorage.setItem(`hgm:sort:${storageKey}`, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  /** A clickable header cell. */
  const Th = ({ k, children, className, ...rest }: { k: string; children: ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) => (
    <th {...rest} className={cx(className, 'cursor-pointer select-none hover:text-white')} onClick={() => toggle(k)} aria-sort={state.key === k ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        <span className={cx('text-[9px]', state.key === k ? 'text-blue-300' : 'text-transparent')}>{state.dir === 'asc' ? '▲' : '▼'}</span>
      </span>
    </th>
  );
  return { sorted, Th, sortKey: state.key, sortDir: state.dir };
}
