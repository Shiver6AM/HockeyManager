import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { money } from '../format';
import { useTRPC } from '../trpc';
import { Badge, Button, cx, ErrorBox } from './ui';

interface Offer {
  salary: number;
  years: number;
}

/** Salary in millions, as the user types it ("4.25"). */
function parseMillions(s: string): number {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Math.round((n * 1_000_000) / 25_000) * 25_000;
}

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

/**
 * Make a contract offer. `mode` picks the endpoint: "negotiate" talks to your
 * own player (re-sign/extension); "bid" places a sealed free-agency bid.
 */
export function OfferForm({
  leagueId,
  playerId,
  ask,
  mode,
  attemptsLeft,
  initial,
  onClose,
}: {
  leagueId: string;
  playerId: string;
  ask: Offer;
  mode: 'negotiate' | 'bid';
  attemptsLeft?: number;
  initial?: Offer | null;
  onClose?: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [salary, setSalary] = useState(((initial ?? ask).salary / 1e6).toFixed(2));
  const [years, setYears] = useState((initial ?? ask).years);
  const negotiate = useMutation(trpc.offseason.negotiate.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const bid = useMutation(trpc.offseason.placeBid.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const result = negotiate.data;
  const busy = negotiate.isPending || bid.isPending;

  const submit = (o: Offer) => {
    if (mode === 'negotiate') negotiate.mutate({ leagueId, playerId, ...o });
    else bid.mutate({ leagueId, playerId, ...o });
  };

  return (
    <div className="mt-2 rounded-lg border border-rink-600 bg-rink-850 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ice-400">
          Salary ($M / yr)
          <input
            className="slot mt-0.5 w-28 font-mono"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="text-xs text-ice-400">
          Years
          <select className="slot mt-0.5 w-20" value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <Button disabled={busy} onClick={() => submit({ salary: parseMillions(salary), years })}>
          {mode === 'negotiate' ? 'Make offer' : 'Place sealed bid'}
        </Button>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
        <span className="text-xs text-ice-500">
          He's asking {money(ask.salary)} × {ask.years}y{attemptsLeft !== undefined && mode === 'negotiate' ? ` · ${attemptsLeft} offer${attemptsLeft === 1 ? '' : 's'} left` : ''}
        </span>
      </div>
      {result && (
        <div
          className={cx(
            'mt-2 rounded-md px-3 py-2 text-sm',
            result.result === 'accept' ? 'bg-win/15 text-win' : result.result === 'counter' ? 'bg-blueline/15 text-blue-200' : 'bg-goal/10 text-red-200',
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
      {bid.isSuccess && <p className="mt-2 text-sm text-win">Bid placed. It's sealed until the round resolves when the league advances.</p>}
      <div className="mt-2">
        <ErrorBox error={negotiate.error ?? bid.error} />
      </div>
    </div>
  );
}
