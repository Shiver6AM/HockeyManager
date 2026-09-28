/**
 * Drag-and-drop lines editor.
 *
 *  - Drag a scratched player onto a lineup slot to dress him (the player there is scratched).
 *  - Drag between lineup slots to swap two players.
 *  - Drag a dressed skater onto a power-play / penalty-kill spot to put him on that unit.
 *  - No mouse? Tap one player, then tap where he should go.
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useState, type ReactNode } from 'react';
import { Badge, cx } from './ui';
import type { Outputs } from '../trpc';

type TeamData = Outputs['data']['team'];
export type P = TeamData['players'][number];
export type Lines = TeamData['lines'];

type Kind = 'f' | 'd' | 'g' | 'pp' | 'pk';
interface Ref {
  k: Kind;
  i: number;
  j: number;
}
type Source = { type: 'slot'; ref: Ref } | { type: 'bench'; id: string };

const FWD_LABELS = ['LW', 'C', 'RW'];
const refKey = (r: Ref) => `${r.k}:${r.i}:${r.j}`;
const parseRef = (s: string): Ref => {
  const [k, i, j] = s.split(':');
  return { k: k as Kind, i: Number(i), j: Number(j) };
};
const isLineup = (k: Kind) => k === 'f' || k === 'd' || k === 'g';

function unitOf(d: Lines, r: Ref): string[] {
  switch (r.k) {
    case 'f':
      return d.forwards[r.i];
    case 'd':
      return d.defense[r.i];
    case 'g':
      return d.goalies;
    case 'pp':
      return d.pp[r.i];
    case 'pk':
      return d.pk[r.i];
  }
}
const get = (d: Lines, r: Ref) => unitOf(d, r)[r.j];

function playerOf(d: Lines, s: Source): string {
  return s.type === 'bench' ? s.id : get(d, s.ref);
}

export function useLinesMoves(byId: Map<string, P>) {
  const isG = (id: string) => byId.get(id)?.pos === 'G';

  /** Can the player from `from` go to `to`? */
  const canDrop = (d: Lines, from: Source, to: Ref): boolean => {
    const id = playerOf(d, from);
    if (!id) return false;
    if (from.type === 'slot' && refKey(from.ref) === refKey(to)) return false;
    if (isLineup(to.k)) {
      if (from.type === 'slot' && !isLineup(from.ref.k)) return false; // units only take dressed players
      if ((to.k === 'g') !== isG(id)) return false;
      if (from.type === 'slot' && (to.k === 'g') !== (from.ref.k === 'g')) return false;
      return true;
    }
    // Special-teams spot: any dressed skater.
    if (from.type === 'bench' || isG(id)) return false;
    return from.ref.k !== 'g';
  };

  const move = (d: Lines, from: Source, to: Ref): Lines => {
    if (!canDrop(d, from, to)) return d;
    const next = structuredClone(d);
    const id = playerOf(next, from);
    const target = unitOf(next, to);
    const old = target[to.j];
    if (isLineup(to.k)) {
      if (from.type === 'bench') {
        target[to.j] = id;
        // His special-teams spots go to his replacement.
        for (const unit of [...next.pp, ...next.pk]) {
          const k = unit.indexOf(old);
          if (k >= 0 && !unit.includes(id)) unit[k] = id;
        }
      } else {
        unitOf(next, from.ref)[from.ref.j] = old;
        target[to.j] = id;
      }
      return next;
    }
    // Special teams.
    const at = target.indexOf(id);
    if (at >= 0) {
      target[at] = old; // already on this unit: swap spots
      target[to.j] = id;
    } else if (from.type === 'slot' && !isLineup(from.ref.k)) {
      const src = unitOf(next, from.ref);
      target[to.j] = id;
      if (!src.includes(old)) src[from.ref.j] = old; // swap across units when that doesn't duplicate anyone
    } else {
      target[to.j] = id;
    }
    return next;
  };
  return { canDrop, move };
}

// ---------------------------------------------------------------------------

function Card({ p, compact, warn, invalid, selected, dragging }: { p?: P; compact?: boolean; warn?: string; invalid?: boolean; selected?: boolean; dragging?: boolean }) {
  if (!p) return <div className="rounded-md border border-dashed border-rink-600 px-2 py-1.5 text-xs text-ice-500">Empty</div>;
  return (
    <div
      className={cx(
        'rounded-md border bg-rink-800 px-2 py-1.5 text-left select-none',
        compact ? 'text-xs' : 'text-sm',
        invalid ? 'border-goal' : p.injury ? 'border-warn' : 'border-rink-600',
        selected && 'ring-2 ring-blueline',
        dragging && 'shadow-lg shadow-black/60',
      )}
      title={`${p.name} · ${p.pos} ${p.overall}${p.injury ? ` · injured (${p.injury.type})` : ''}${warn ? ` · ${warn}` : ''}`}
    >
      <span className="block truncate font-semibold text-ice-50">{compact ? p.lastName : `${p.firstName[0]}. ${p.lastName}`}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-ice-400">
        <span className={cx(warn && 'text-warn')}>{p.pos}</span>
        <span className="tabular text-ice-200">{p.overall}</span>
        {p.injury && <span className="text-red-300">INJ</span>}
      </span>
    </div>
  );
}

function SlotCell({
  refv,
  p,
  tag,
  compact,
  warn,
  invalid,
  droppable,
  selected,
  onTap,
}: {
  refv: Ref;
  p?: P;
  tag?: string;
  compact?: boolean;
  warn?: string;
  invalid?: boolean;
  droppable: boolean;
  selected: boolean;
  onTap: () => void;
}) {
  const key = refKey(refv);
  const drag = useDraggable({ id: `slot:${key}`, data: { src: { type: 'slot', ref: refv } satisfies Source }, disabled: !p });
  const drop = useDroppable({ id: `to:${key}`, data: { ref: refv }, disabled: !droppable });
  return (
    <div className="min-w-0">
      {tag && <p className="mb-0.5 text-[10px] font-semibold tracking-wider text-ice-500 uppercase">{tag}</p>}
      <div
        ref={(el) => {
          drag.setNodeRef(el);
          drop.setNodeRef(el);
        }}
        {...drag.listeners}
        {...drag.attributes}
        onClick={onTap}
        className={cx(
          'cursor-grab rounded-md transition active:cursor-grabbing',
          drag.isDragging && 'opacity-30',
          drop.isOver && droppable && 'ring-2 ring-win',
          !drop.isOver && droppable && 'ring-1 ring-win/40',
        )}
      >
        <Card p={p} compact={compact} warn={warn} invalid={invalid} selected={selected} />
      </div>
    </div>
  );
}

function BenchCard({ p, selected, onTap }: { p: P; selected: boolean; onTap: () => void }) {
  const drag = useDraggable({ id: `bench:${p.id}`, data: { src: { type: 'bench', id: p.id } satisfies Source } });
  return (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      onClick={onTap}
      className={cx('w-36 cursor-grab active:cursor-grabbing', drag.isDragging && 'opacity-30')}
    >
      <Card p={p} selected={selected} />
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-rink-700 bg-rink-900 p-4">
      <h3 className="mb-3 font-display text-sm font-semibold tracking-wider text-ice-300 uppercase">{title}</h3>
      {children}
      {note && <p className="mt-2 text-xs text-ice-500">{note}</p>}
    </section>
  );
}

/** Position fit for a lineup slot (a hint, not a rule). */
function fitWarning(k: Kind, p: P | undefined): string | undefined {
  if (!p) return undefined;
  if (k === 'd' && p.pos !== 'D') return 'forward playing defense';
  if (k === 'f' && p.pos === 'D') return 'defenseman playing forward';
  return undefined;
}

export function LinesBoard({ draft, onChange, players }: { draft: Lines; onChange: (d: Lines) => void; players: P[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const { canDrop, move } = useLinesMoves(byId);
  const [active, setActive] = useState<Source | null>(null); // being dragged
  const [picked, setPicked] = useState<Source | null>(null); // tap-to-move selection
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const dressed = [...draft.forwards.flat(), ...draft.defense.flat(), ...draft.goalies];
  const counts = new Map<string, number>();
  dressed.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const dressedSkaters = new Set([...draft.forwards.flat(), ...draft.defense.flat()]);
  const bench = players.filter((p) => !counts.has(p.id)).sort((a, b) => Number(!!a.injury) - Number(!!b.injury) || b.overall - a.overall);
  const source = active ?? picked;

  const onStart = (e: DragStartEvent) => {
    setPicked(null);
    setActive((e.active.data.current as { src: Source }).src);
  };
  const onEnd = (e: DragEndEvent) => {
    const src = (e.active.data.current as { src: Source }).src;
    const to = (e.over?.data.current as { ref?: Ref } | undefined)?.ref;
    setActive(null);
    if (to) onChange(move(draft, src, to));
  };
  const tapSlot = (r: Ref) => {
    if (picked && canDrop(draft, picked, r)) {
      onChange(move(draft, picked, r));
      setPicked(null);
    } else if (get(draft, r)) {
      setPicked(picked?.type === 'slot' && refKey(picked.ref) === refKey(r) ? null : { type: 'slot', ref: r });
    }
  };

  const cell = (r: Ref, opts: { tag?: string; compact?: boolean } = {}) => {
    const id = get(draft, r);
    const p = byId.get(id);
    const st = !isLineup(r.k);
    const invalid = st ? !dressedSkaters.has(id) || unitOf(draft, r).indexOf(id) !== r.j : (counts.get(id) ?? 0) > 1;
    return (
      <SlotCell
        key={refKey(r)}
        refv={r}
        p={p}
        tag={opts.tag}
        compact={opts.compact}
        warn={fitWarning(r.k, p)}
        invalid={invalid}
        droppable={!!source && canDrop(draft, source, r)}
        selected={!!picked && picked.type === 'slot' && refKey(picked.ref) === refKey(r)}
        onTap={() => tapSlot(r)}
      />
    );
  };

  const overlayId = active ? playerOf(draft, active) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <p className="mb-3 text-sm text-ice-400">
        Drag players between slots to swap them, drag a scratch onto a slot to dress him, or drag a dressed skater onto a power-play or
        penalty-kill spot. On a phone, tap one player and then tap where he should go.
        {picked && (
          <button className="ml-2 text-blue-300 hover:underline" onClick={() => setPicked(null)}>
            Cancel selection
          </button>
        )}
      </p>
      <div className="mb-5">
        <Section title={`Scratches (${bench.length})`} note="Drag a scratch onto a lineup slot to dress him.">
          {bench.length ? (
            <div className="flex flex-wrap gap-2">
              {bench.map((p) => (
                <BenchCard
                  key={p.id}
                  p={p}
                  selected={picked?.type === 'bench' && picked.id === p.id}
                  onTap={() => setPicked(picked?.type === 'bench' && picked.id === p.id ? null : { type: 'bench', id: p.id })}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ice-500">Everyone is dressed.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Forward lines">
            <div className="space-y-2">
              {draft.forwards.map((line, i) => (
                <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] items-end gap-2">
                  <span className="pb-2 font-display text-ice-400">L{i + 1}</span>
                  {line.map((_, j) => cell({ k: 'f', i, j }, { tag: i === 0 ? FWD_LABELS[j] : undefined }))}
                </div>
              ))}
            </div>
          </Section>
        </div>
        <Section title="Defense & goalies" note="The backup starts about 1 in 8 games, and most second nights of back-to-backs.">
          <div className="space-y-2">
            {draft.defense.map((pair, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2">
                <span className="pb-2 font-display text-ice-400">D{i + 1}</span>
                {pair.map((_, j) => cell({ k: 'd', i, j }, { tag: i === 0 ? (j ? 'RD' : 'LD') : undefined }))}
              </div>
            ))}
            <div className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2 border-t border-rink-700 pt-3">
              <span className="pb-2 font-display text-ice-400">G</span>
              {draft.goalies.map((_, j) => cell({ k: 'g', i: 0, j }, { tag: j ? 'Backup' : 'Starter' }))}
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Power play" note="PP1 takes the first ~70 seconds of each power play.">
          {draft.pp.map((unit, i) => (
            <div key={i} className="mb-2 grid grid-cols-[2.5rem_repeat(5,minmax(0,1fr))] items-end gap-1.5 last:mb-0">
              <span className="pb-2 font-display text-ice-400">PP{i + 1}</span>
              {unit.map((_, j) => cell({ k: 'pp', i, j }, { compact: true }))}
            </div>
          ))}
        </Section>
        <Section title="Penalty kill" note="Two forwards then two defensemen. PK1 takes the first ~60 seconds.">
          {draft.pk.map((unit, i) => (
            <div key={i} className="mb-2 grid grid-cols-[2.5rem_repeat(4,minmax(0,1fr))] items-end gap-1.5 last:mb-0">
              <span className="pb-2 font-display text-ice-400">PK{i + 1}</span>
              {unit.map((_, j) => cell({ k: 'pk', i, j }, { compact: true }))}
            </div>
          ))}
        </Section>
      </div>

      <DragOverlay dropAnimation={null}>{overlayId ? <div className="w-40"><Card p={byId.get(overlayId)} dragging /></div> : null}</DragOverlay>
      {bench.some((p) => p.injury) && (
        <p className="mt-2 text-xs text-ice-500">
          <Badge tone="warn">INJ</Badge> Injured players can be placed, but they'll be swapped for your best healthy scratch at game time.
        </p>
      )}
    </DndContext>
  );
}
