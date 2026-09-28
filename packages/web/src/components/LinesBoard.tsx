/**
 * Drag-and-drop lines editor.
 *
 *  - Drag a scratched player onto a lineup slot to dress him (the player there is scratched).
 *  - Drag between lineup slots to swap two players.
 *  - Drag a dressed skater onto any special-unit spot (power play, penalty kill,
 *    4-on-4, 3-on-3, extra attacker, shootout) to put him there.
 *  - No mouse? Tap one player, then tap where he should go.
 *
 * Special-unit spots are shaded from white (poor fit) to green (ideal) by the
 * player's skill at that spot's role (e.g. PK defense, net front, one-timer).
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
import { Link } from 'react-router-dom';
import { Badge, cx } from './ui';
import type { Outputs } from '../trpc';

type TeamData = Outputs['data']['team'];
export type P = TeamData['players'][number];
export type Lines = TeamData['lines'];
type Catalog = TeamData['systems'];
type RoleId = keyof P['roles'];
type SlotDef = { label: string; role: string };

/** Lineup kinds, then special units (arrays of units, or a single unit). */
type Kind = 'f' | 'd' | 'g' | 'pp' | 'pk' | 'ev4' | 'ev3' | 'pp4' | 'pk3' | 'ea' | 'so';
interface Ref {
  k: Kind;
  i: number;
  j: number;
}
type Source = { type: 'slot'; ref: Ref } | { type: 'bench'; id: string };

const FWD_LABELS = ['LW', 'C', 'RW'];
const refKey = (r: Ref) => `${r.k}:${r.i}:${r.j}`;
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
    case 'ev4':
      return d.fourOnFour![r.i];
    case 'ev3':
      return d.threeOnThree![r.i];
    case 'pp4':
      return d.pp4!;
    case 'pk3':
      return d.pk3!;
    case 'ea':
      return d.extraAttacker!;
    case 'so':
      return d.shootout!;
  }
}
const get = (d: Lines, r: Ref) => unitOf(d, r)[r.j];
function playerOf(d: Lines, s: Source): string {
  return s.type === 'bench' ? s.id : get(d, s.ref);
}

/** Every special unit in the lines (for handing spots to a replacement). */
function specialUnits(d: Lines): string[][] {
  return [...d.pp, ...d.pk, ...(d.fourOnFour ?? []), ...(d.threeOnThree ?? []), d.pp4, d.pk3, d.extraAttacker, d.shootout].filter((u): u is string[] => !!u);
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
    // Special-unit spot: any dressed skater.
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
        // His special-unit spots go to his replacement.
        for (const unit of specialUnits(next)) {
          const k = unit.indexOf(old);
          if (k >= 0 && !unit.includes(id)) unit[k] = id;
        }
      } else {
        unitOf(next, from.ref)[from.ref.j] = old;
        target[to.j] = id;
      }
      return next;
    }
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

/** White (poor fit) → green (ideal), from a role skill on the ratings scale. */
function fitColor(v: number): { bg: string; fg: string } {
  const t = Math.max(0, Math.min(1, (v - 55) / 35));
  return {
    bg: `hsl(142 ${Math.round(12 + 58 * t)}% ${Math.round(95 - 50 * t)}%)`,
    fg: t > 0.78 ? '#ffffff' : '#0b1220',
  };
}

function statLine(p: P) {
  if (p.pos === 'G') return p.goalieStats ? `${p.goalieStats.w}W` : '';
  return p.stats ? `${p.stats.g}G ${p.stats.a}A` : '0G 0A';
}

function Card({
  p,
  compact,
  warn,
  invalid,
  selected,
  dragging,
  fit,
}: {
  p?: P;
  compact?: boolean;
  warn?: string;
  invalid?: boolean;
  selected?: boolean;
  dragging?: boolean;
  /** Special-unit spot: the player's skill for it (colors the card). */
  fit?: { value: number; label: string };
}) {
  if (!p) return <div className="rounded-md border border-dashed border-rink-600 px-2 py-1.5 text-xs text-ice-500">Empty</div>;
  const color = fit ? fitColor(fit.value) : null;
  return (
    <div
      className={cx(
        'rounded-md border px-2 py-1.5 text-left select-none',
        !color && 'bg-rink-800',
        compact ? 'text-xs' : 'text-sm',
        invalid ? 'border-goal' : p.injury ? 'border-warn' : color ? 'border-transparent' : 'border-rink-600',
        selected && 'ring-2 ring-blueline',
        dragging && 'shadow-lg shadow-black/60',
      )}
      style={color ? { background: color.bg, color: color.fg } : undefined}
      title={`${p.name} · ${p.pos} ${p.overall} · age ${p.age} · potential ${p.potential.grade} (${p.potential.projection})${fit ? ` · ${fit.label} ${fit.value}` : ''}${p.injury ? ` · injured (${p.injury.type})` : ''}${warn ? ` · ${warn}` : ''}`}
    >
      <span className={cx('flex items-center justify-between gap-1 font-semibold', !color && 'text-ice-50')}>
        <span className="truncate">{compact ? p.lastName : `${p.firstName[0]}. ${p.lastName}`}</span>
        {fit && <span className="tabular shrink-0 rounded bg-black/15 px-1 text-[10px]">{fit.value}</span>}
      </span>
      <span className={cx('flex flex-wrap items-center gap-x-1.5 text-[11px]', !color && 'text-ice-400')}>
        <span className={cx(warn && !color && 'text-warn')}>{p.pos}</span>
        <span className={cx('tabular font-semibold', !color && 'text-ice-100')}>{p.overall}</span>
        <span className="tabular" title="Age">
          {p.age}y
        </span>
        <span className="tabular" title={`Potential: ${p.potential.projection}`}>
          ↑{p.potential.grade}
        </span>
        {!compact && <span className="tabular">{statLine(p)}</span>}
        {p.injury && <span className={color ? 'font-bold' : 'text-red-300'}>INJ</span>}
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
  fit,
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
  fit?: { value: number; label: string };
}) {
  const key = refKey(refv);
  const drag = useDraggable({ id: `slot:${key}`, data: { src: { type: 'slot', ref: refv } satisfies Source }, disabled: !p });
  const drop = useDroppable({ id: `to:${key}`, data: { ref: refv }, disabled: !droppable });
  return (
    <div className="min-w-0">
      {tag && (
        <p className="mb-0.5 truncate text-[10px] font-semibold tracking-wider text-ice-500 uppercase" title={tag}>
          {tag}
        </p>
      )}
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
        <Card p={p} compact={compact} warn={warn} invalid={invalid} selected={selected} fit={fit} />
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
      className={cx('w-40 cursor-grab active:cursor-grabbing', drag.isDragging && 'opacity-30')}
    >
      <Card p={p} selected={selected} />
    </div>
  );
}

function Section({ title, children, note, action }: { title: string; children: ReactNode; note?: string; action?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-rink-700 bg-rink-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold tracking-wider text-ice-300 uppercase">{title}</h3>
        {action}
      </div>
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

export function LinesBoard({
  draft,
  onChange,
  players,
  catalog,
  formation,
  leagueId,
}: {
  draft: Lines;
  onChange: (d: Lines) => void;
  players: P[];
  catalog: Catalog;
  formation: string;
  leagueId: string;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const { canDrop, move } = useLinesMoves(byId);
  const [active, setActive] = useState<Source | null>(null);
  const [picked, setPicked] = useState<Source | null>(null);
  const [view, setView] = useState<'main' | 'special'>('main');
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const roleLabel = Object.fromEntries(catalog.roles.map((r) => [r.id, r.label])) as Record<string, string>;
  const ppSlots = catalog.pp.find((f) => f.id === formation)?.slots ?? catalog.pp[0].slots;
  const soSlots: SlotDef[] = ['1st shooter', '2nd shooter', '3rd shooter', '4th shooter', '5th shooter'].map((label) => ({ label, role: 'shootout' }));
  const slotsFor = (k: Kind): SlotDef[] | null =>
    k === 'pp'
      ? ppSlots
      : k === 'pk'
        ? catalog.slots.pk
        : k === 'ev4'
          ? catalog.slots.fourOnFour
          : k === 'ev3'
            ? catalog.slots.threeOnThree
            : k === 'pp4'
              ? catalog.slots.pp4
              : k === 'pk3'
                ? catalog.slots.pk3
                : k === 'ea'
                  ? catalog.slots.extraAttacker
                  : k === 'so'
                    ? soSlots
                    : null;

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
    const special = !isLineup(r.k);
    const slot = special ? slotsFor(r.k)?.[r.j] : undefined;
    const invalid = special ? !dressedSkaters.has(id) || unitOf(draft, r).indexOf(id) !== r.j : (counts.get(id) ?? 0) > 1;
    const fit =
      slot && p && p.pos !== 'G'
        ? {
            value: p.roles[slot.role as RoleId],
            label: roleLabel[slot.role] ?? slot.role,
          }
        : undefined;
    return (
      <SlotCell
        key={refKey(r)}
        refv={r}
        p={p}
        tag={opts.tag ?? slot?.label}
        compact={opts.compact}
        warn={fitWarning(r.k, p)}
        invalid={invalid}
        droppable={!!source && canDrop(draft, source, r)}
        selected={!!picked && picked.type === 'slot' && refKey(picked.ref) === refKey(r)}
        onTap={() => tapSlot(r)}
        fit={fit}
      />
    );
  };
  const unitRow = (k: Kind, unit: string[], i: number, label: string, cols: string) => (
    <div key={`${k}${i}`} className={cx('mb-2 grid items-end gap-1.5 last:mb-0', cols)}>
      <span className="pb-2 font-display text-xs text-ice-400">{label}</span>
      {unit.map((_, j) => cell({ k, i, j }, { compact: true }))}
    </div>
  );
  const unitAvg = (k: Kind, unit: string[]) => {
    const slots = slotsFor(k) ?? [];
    const xs = unit.map((id, j) => (byId.get(id) && slots[j] ? byId.get(id)!.roles[slots[j].role as RoleId] : 0)).filter(Boolean);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  };
  const fitBadge = (v: number) => (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: fitColor(v).bg, color: fitColor(v).fg }}
      title="Average fit of this unit"
    >
      Fit {v}
    </span>
  );

  const overlayId = active ? playerOf(draft, active) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-rink-900 p-1 text-sm">
          {(['main', 'special'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cx('rounded-md px-3 py-1 font-semibold', view === v ? 'bg-rink-600 text-white' : 'text-ice-400 hover:text-ice-100')}
            >
              {v === 'main' ? 'Lines & special teams' : 'Other situations'}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 text-sm text-ice-400">
          Drag to swap, drag a scratch onto a slot to dress him, or drag a dressed skater onto a special-unit spot. On a phone, tap one player then where he
          goes. Special-unit cards run from white (poor fit) to green (ideal).
          {picked && (
            <button className="ml-2 text-blue-300 hover:underline" onClick={() => setPicked(null)}>
              Cancel selection
            </button>
          )}
        </p>
      </div>

      <div className="mb-5">
        <Section title={`Scratches (${bench.length})`} note="Drag a scratch onto a lineup slot to dress him.">
          {bench.length ? (
            <div className="flex flex-wrap gap-2">
              {bench.map((p) => (
                <div key={p.id} className="relative">
                  <BenchCard
                    p={p}
                    selected={picked?.type === 'bench' && picked.id === p.id}
                    onTap={() => setPicked(picked?.type === 'bench' && picked.id === p.id ? null : { type: 'bench', id: p.id })}
                  />
                  <Link
                    to={`/league/${leagueId}/player/${p.id}`}
                    className="absolute top-1 right-1 text-[10px] text-ice-500 hover:text-white"
                    title="Player page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ice-500">Everyone is dressed.</p>
          )}
        </Section>
      </div>

      {view === 'main' ? (
        <>
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
            <Section
              title={`Power play · ${catalog.pp.find((f) => f.id === formation)?.label ?? ''}`}
              note="PP1 takes the first ~70 seconds of each power play. Spots follow your formation (set it under Systems)."
              action={fitBadge(unitAvg('pp', draft.pp[0]))}
            >
              {draft.pp.map((unit, i) => unitRow('pp', unit, i, `PP${i + 1}`, 'grid-cols-[2.5rem_repeat(5,minmax(0,1fr))]'))}
            </Section>
            <Section
              title="Penalty kill"
              note="Two forwards then two defensemen. PK1 takes the first ~60 seconds."
              action={fitBadge(unitAvg('pk', draft.pk[0]))}
            >
              {draft.pk.map((unit, i) => unitRow('pk', unit, i, `PK${i + 1}`, 'grid-cols-[2.5rem_repeat(4,minmax(0,1fr))]'))}
            </Section>
          </div>
        </>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="4-on-4" note="Coincidental minors. Units alternate." action={draft.fourOnFour && fitBadge(unitAvg('ev4', draft.fourOnFour[0]))}>
            {draft.fourOnFour?.map((unit, i) => unitRow('ev4', unit, i, `U${i + 1}`, 'grid-cols-[2.5rem_repeat(4,minmax(0,1fr))]'))}
          </Section>
          <Section
            title="3-on-3 overtime"
            note="Regular-season overtime. Units rotate: speed and hands win here."
            action={draft.threeOnThree && fitBadge(unitAvg('ev3', draft.threeOnThree[0]))}
          >
            {draft.threeOnThree?.map((unit, i) => unitRow('ev3', unit, i, `U${i + 1}`, 'grid-cols-[2.5rem_repeat(3,minmax(0,1fr))]'))}
          </Section>
          <Section
            title="4-on-3 power play"
            note="When you have four skaters against three (5-on-3 late, or a penalty in overtime)."
            action={draft.pp4 && fitBadge(unitAvg('pp4', draft.pp4))}
          >
            {draft.pp4 && unitRow('pp4', draft.pp4, 0, 'PP', 'grid-cols-[2.5rem_repeat(4,minmax(0,1fr))]')}
          </Section>
          <Section title="3-man penalty kill" note="Two men down (5-on-3 or 4-on-3)." action={draft.pk3 && fitBadge(unitAvg('pk3', draft.pk3))}>
            {draft.pk3 && unitRow('pk3', draft.pk3, 0, 'PK', 'grid-cols-[2.5rem_repeat(3,minmax(0,1fr))]')}
          </Section>
          <Section
            title="Extra attacker (goalie pulled)"
            note="Six skaters when you pull the goalie late, in priority order."
            action={draft.extraAttacker && fitBadge(unitAvg('ea', draft.extraAttacker))}
          >
            {draft.extraAttacker &&
              unitRow('ea', draft.extraAttacker, 0, '6v5', 'grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] sm:grid-cols-[2.5rem_repeat(6,minmax(0,1fr))]')}
          </Section>
          <Section
            title="Shootout order"
            note="Shooters in order; after five, everyone else by shootout skill."
            action={draft.shootout && fitBadge(unitAvg('so', draft.shootout))}
          >
            {draft.shootout &&
              unitRow('so', draft.shootout, 0, 'SO', 'grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] sm:grid-cols-[2.5rem_repeat(5,minmax(0,1fr))]')}
          </Section>
        </div>
      )}

      <DragOverlay dropAnimation={null}>{overlayId ? <div className="w-40"><Card p={byId.get(overlayId)} dragging /></div> : null}</DragOverlay>
      {bench.some((p) => p.injury) && (
        <p className="mt-2 text-xs text-ice-500">
          <Badge tone="warn">INJ</Badge> Injured players can be placed, but they'll be swapped for your best healthy scratch at game time.
        </p>
      )}
    </DndContext>
  );
}
