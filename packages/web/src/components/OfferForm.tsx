import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { Badge, Button, cx, ErrorBox } from './ui';

interface Offer {
  salary: number;
  years: number;
}

/** What the server tells a manager about a player before an offer (see server/src/deal.ts). */
export interface Deal {
  ask: Offer;
  interest: { score: number; label: string; factors: Array<{ label: string; good: boolean; strong: boolean }> };
  term: string;
  priorities: string[];
  estimate: Array<{ years: number; salary: number }>;
}

const MIN = 775_000; // league minimum
const STEP = 25_000;
const snap = (x: number) => Math.round(x / STEP) * STEP;

export function Priorities({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <Badge key={x} tone="neutral">
          {x}
        </Badge>
      ))}
    </span>
  );
}

const interestTone = (score: number) => (score >= 60 ? 'text-win' : score >= 40 ? 'text-ice-100' : score >= 25 ? 'text-warn' : 'text-red-300');
const interestBar = (score: number) => (score >= 60 ? 'bg-win' : score >= 40 ? 'bg-blueline' : score >= 25 ? 'bg-warn' : 'bg-goal');

/** Compact interest pill for lists. */
export function InterestPill({ interest }: { interest: Deal['interest'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={interest.factors.map((f) => `${f.good ? '+' : '−'} ${f.label}`).join('\n')}>
      <span className="h-1.5 w-12 rounded-full bg-rink-700">
        <span className={cx('block h-1.5 rounded-full', interestBar(interest.score))} style={{ width: `${Math.max(4, interest.score)}%` }} />
      </span>
      <span className={cx('font-semibold', interestTone(interest.score))}>{interest.label}</span>
    </span>
  );
}

function InterestPanel({ deal }: { deal: Deal }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-ice-400">
        <span>Interest in your team</span>
        <span className={cx('font-semibold', interestTone(deal.interest.score))}>
          {deal.interest.label} · {deal.interest.score}
        </span>
      </div>
      <div className="h-2 rounded-full bg-rink-700">
        <div className={cx('h-2 rounded-full', interestBar(deal.interest.score))} style={{ width: `${Math.max(3, deal.interest.score)}%` }} />
      </div>
      <ul className="space-y-0.5 text-xs">
        {deal.interest.factors.map((f) => (
          <li key={f.label} className={f.good ? 'text-win' : 'text-red-300'}>
            {f.good ? (f.strong ? '▲▲' : '▲') : f.strong ? '▼▼' : '▼'} <span className="text-ice-300">{f.label}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1 pt-1">
        <Priorities items={[...deal.priorities, deal.term]} />
      </div>
    </div>
  );
}

/** The agent's read on an offer, from his (slightly fuzzy) price estimate. */
function read(ratio: number): { text: string; tone: string; pct: number } {
  const pct = Math.max(0, Math.min(100, ((ratio - 0.7) / 0.4) * 100));
  if (ratio >= 1.0) return { text: 'Should get it done', tone: 'bg-win', pct };
  if (ratio >= 0.92) return { text: 'Close: expect a counter', tone: 'bg-blueline', pct };
  if (ratio >= 0.82) return { text: 'Far apart', tone: 'bg-warn', pct };
  return { text: 'He’ll call that insulting', tone: 'bg-goal', pct };
}

/** A slider with a text box next to it; both edit the same value. */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  parse,
  onChange,
  width = 'w-24',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  parse: (s: string) => number;
  onChange: (v: number) => void;
  width?: string;
}) {
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value, format]);
  const commit = () => {
    const v = parse(text);
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
    else setText(format(value));
  };
  return (
    <label className="block text-xs text-ice-400">
      {label}
      <span className="mt-1 flex items-center gap-3">
        <input
          type="range"
          className="range min-w-0 flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className={cx('shrink-0', width)}>
          <input
            className="slot text-right font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            inputMode="decimal"
            aria-label={`${label} (type a value)`}
          />
        </span>
      </span>
    </label>
  );
}

const fmtM = (v: number) => (v / 1e6).toFixed(2);
const parseM = (s: string) => snap(Number(s.replace(/[^0-9.]/g, '')) * 1e6);
const fmtY = (v: number) => String(v);
const parseY = (s: string) => Math.round(Number(s));

/**
 * Make a contract offer. `mode` picks the endpoint: "negotiate" talks to your
 * own player (re-sign/extension); "bid" places a sealed free-agency bid; "sign"
 * negotiates with a leftover free agent, who signs on the spot if he accepts.
 */
export function OfferForm({
  leagueId,
  playerId,
  deal,
  mode,
  attemptsLeft,
  initial,
  capRoom,
  blocked,
  compensation,
  onClose,
}: {
  leagueId: string;
  playerId: string;
  deal: Deal;
  mode: 'negotiate' | 'bid' | 'sign' | 'sheet';
  attemptsLeft?: number;
  initial?: Offer | null;
  capRoom?: number | null;
  /** Why an offer can't be made right now (e.g. roster full); the form stays browsable. */
  blocked?: string;
  /** Offer sheets: what the offering team would owe at a given salary. */
  compensation?: (salary: number) => string;
  onClose?: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const start = initial ?? deal.ask;
  const [salary, setSalary] = useState(start.salary);
  const [years, setYears] = useState(start.years);
  const opts = { onSuccess: () => qc.invalidateQueries() };
  const negotiate = useMutation(trpc.offseason.negotiate.mutationOptions(opts));
  const sign = useMutation(trpc.offseason.negotiateFreeAgent.mutationOptions(opts));
  const bid = useMutation(trpc.offseason.placeBid.mutationOptions(opts));
  const sheet = useMutation(trpc.offseason.tenderOfferSheet.mutationOptions(opts));
  const talk = mode === 'sign' ? sign : negotiate;
  const result = talk.data;
  const busy = negotiate.isPending || bid.isPending || sign.isPending || sheet.isPending;
  const sealed = mode === 'bid' || mode === 'sheet';

  const maxSalary = Math.max(snap(deal.ask.salary * 1.6), 2_000_000, ...deal.estimate.map((e) => e.salary));
  const cap = Math.min(16_500_000, maxSalary);
  const needed = deal.estimate[years - 1]?.salary ?? deal.ask.salary;
  const r = read(salary / needed);
  const overCap = capRoom != null && salary > capRoom;

  const submit = (o: Offer) => {
    if (mode === 'negotiate') negotiate.mutate({ leagueId, playerId, ...o });
    else if (mode === 'sign') sign.mutate({ leagueId, playerId, ...o });
    else if (mode === 'sheet') sheet.mutate({ leagueId, playerId, ...o });
    else bid.mutate({ leagueId, playerId, ...o });
  };

  return (
    <div className="mt-2 grid gap-4 rounded-lg border border-rink-600 bg-rink-850 p-3 md:grid-cols-[1fr_16rem]">
      <div className="min-w-0 space-y-3">
        <SliderField label="Salary ($M per year)" value={salary} min={MIN} max={cap} step={STEP} format={fmtM} parse={parseM} onChange={setSalary} />
        <SliderField label="Years" value={years} min={1} max={8} step={1} format={fmtY} parse={parseY} onChange={setYears} width="w-14" />

        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-ice-400">Agent’s read</span>
            <span className="font-semibold text-ice-100">{r.text}</span>
          </div>
          <div className="h-2 rounded-full bg-rink-700">
            <div className={cx('h-2 rounded-full transition-all', r.tone)} style={{ width: `${Math.max(3, r.pct)}%` }} />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs text-ice-400">Agent’s estimate by term (tap to use)</p>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
            {deal.estimate.map((e) => (
              <button
                key={e.years}
                type="button"
                onClick={() => {
                  setYears(e.years);
                  setSalary(e.salary);
                }}
                className={cx(
                  'rounded border px-1 py-1 text-center text-[11px] leading-tight transition',
                  e.years === years ? 'border-blueline bg-blueline/15 text-white' : 'border-rink-700 text-ice-300 hover:border-rink-500',
                  e.years === deal.ask.years && 'ring-1 ring-ice-500/40',
                )}
              >
                <span className="block font-semibold">{e.years}y</span>
                <span className="tabular block">{fmtM(e.salary)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ice-500">
            He asked for {money(deal.ask.salary)} × {deal.ask.years}y. Estimates are the agent’s, not a promise{sealed ? ', and other teams may bid too' : ''}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || overCap || !!blocked || (!sealed && attemptsLeft === 0)} onClick={() => submit({ salary, years })}>
            {mode === 'bid' ? 'Place sealed bid' : mode === 'sheet' ? 'Tender offer sheet' : mode === 'sign' ? 'Offer contract' : 'Make offer'}: {money(salary)} × {years}y
          </Button>
          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
          {attemptsLeft !== undefined && !sealed && (
            <span className="text-xs text-ice-500">
              {attemptsLeft} offer{attemptsLeft === 1 ? '' : 's'} left
            </span>
          )}
          {overCap && <span className="text-xs text-red-300">Over your cap space ({money(capRoom!)})</span>}
          {blocked && <span className="text-xs text-warn">{blocked}</span>}
        </div>

        {result && (
          <div
            className={cx(
              'rounded-md px-3 py-2 text-sm',
              result.result === 'accept'
                ? 'bg-win/15 text-win'
                : result.result === 'counter'
                  ? 'bg-blueline/15 text-blue-200'
                  : result.result === 'pending'
                    ? 'bg-rink-800 text-ice-200'
                    : 'bg-goal/10 text-red-200',
            )}
          >
            {result.message}
            {result.result === 'counter' && (
              <Button className="ml-3 px-2 py-0.5 text-xs" disabled={busy} onClick={() => submit(result.counter)}>
                Accept {money(result.counter.salary)} × {result.counter.years}y
              </Button>
            )}
          </div>
        )}
        {compensation && (
          <p className="rounded-md bg-rink-800 px-3 py-2 text-xs text-ice-300">
            If his team doesn't match, you owe: <span className="font-semibold text-white">{compensation(salary)}</span> (your own picks).
          </p>
        )}
        {bid.isSuccess && <p className="text-sm text-win">Bid placed. It's sealed until the round resolves when the league advances.</p>}
        {sheet.isSuccess && (
          <p className="text-sm text-win">Offer sheet tendered. If he signs it when the league advances, his team gets until the following advance to match.</p>
        )}
        <ErrorBox error={negotiate.error ?? bid.error ?? sign.error ?? sheet.error} />
      </div>
      <div className="border-t border-rink-700 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4">
        <InterestPanel deal={deal} />
      </div>
    </div>
  );
}

const ROUNDS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
/** "1st + 3rd round picks" etc. from the server's compensation table. */
export function compensationText(table: Array<{ from: number; to: number | null; rounds: number[] }>, salary: number): string {
  const row = table.find((r) => r.to === null || salary < r.to) ?? table[table.length - 1];
  if (!row.rounds.length) return 'no compensation';
  const counts = new Map<number, number>();
  for (const r of row.rounds) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([r, n]) => (n > 1 ? `${n}× ${ROUNDS[r]}` : ROUNDS[r])).join(' + ') + ` round pick${row.rounds.length > 1 ? 's' : ''}`;
}
