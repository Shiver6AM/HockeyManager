/**
 * The draft room: the lottery (simmed, or drawn live for everyone) and the
 * draft clock with the commissioner's controls.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { usePollInterval } from '../live';
import { useTRPC } from '../trpc';
import { Badge, Button, Card, CollapsibleCard, cx, ErrorBox, TeamChip } from './ui';
import type { Outputs } from '../trpc';

type Overview = NonNullable<Outputs['offseason']['overview']>;
type DraftInfo = Overview['draft'];

/** A ticking clock (ms), corrected to the server's time. */
export function useServerNow(serverNow: number | undefined, fetchedAt: number, every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  const offset = serverNow ? serverNow - fetchedAt : 0;
  return now + offset;
}

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** When each lottery slot is revealed (ms after the draw starts): the last slots first, the top two last. */
function revealAt(slot: number, n: number) {
  if (slot >= 3) return 3000 + (n - slot) * 1800;
  const three = 3000 + Math.max(0, n - 3) * 1800;
  return slot === 2 ? three + 5000 : three + 10000;
}

export function useDraftOverview(leagueId: string) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.offseason.overview.queryOptions({ leagueId }), refetchInterval: usePollInterval(2000, 20_000) });
}

export function DraftLottery({ leagueId, draft, canAdvance, now }: { leagueId: string; draft: DraftInfo; canAdvance: boolean; now: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const hold = useMutation(trpc.offseason.holdLottery.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const teams = draft.lotteryTeams;
  const n = teams.length;
  const show = draft.lotteryShow;
  const elapsed = show ? now - show.startedAt : Infinity;
  const live = !!show && elapsed < show.length;
  const open = true;
  if (!n) return null;

  // Before the draw: the odds.
  if (!draft.lotteryHeld) {
    return (
      <Card title="Draft lottery">
        <p className="mb-3 text-sm text-ice-300">
          The {n} teams that missed the playoffs are in the draw. Two picks are drawn; a winner can move up at most 10 spots, and everyone else keeps
          their order.
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {teams.map((t) => (
            <div key={t.team.id} className="flex items-center gap-2 text-sm">
              <span className="tabular w-6 text-ice-500">{t.seed}</span>
              <TeamChip team={t.team} size="sm" />
              <span className="flex-1 truncate">
                {t.team.city} {t.team.name}
              </span>
              <span className="h-1.5 w-20 overflow-hidden rounded bg-rink-800">
                <span className="block h-full bg-blueline" style={{ width: `${Math.min(100, (t.odds / 18.5) * 100)}%` }} />
              </span>
              <span className="tabular w-12 text-right text-ice-200">{t.odds.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <ErrorBox error={hold.error} />
        {canAdvance ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={hold.isPending} onClick={() => hold.mutate({ leagueId, live: true })}>
              Watch the draw
            </Button>
            <Button variant="ghost" disabled={hold.isPending} onClick={() => hold.mutate({ leagueId, live: false })}>
              Sim the lottery
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ice-400">Waiting for the commissioner to hold the lottery.</p>
        )}
      </Card>
    );
  }

  // The draw (live) or its result.
  const bySlot = [...teams].sort((a, b) => (a.pick ?? 99) - (b.pick ?? 99));
  const nextReveal = live ? bySlot.map((t) => t.pick!).filter((s) => revealAt(s, n) > elapsed).sort((a, b) => b - a)[0] : undefined;
  return (
    <Shell live={live} winners={teams.filter((t) => t.pick! < t.seed).map((t) => `${t.team.abbr} to #${t.pick}`).join(', ')}>
      {live && (
        <p className="mb-3 text-sm text-ice-200" aria-live="polite">
          {elapsed < 3000
            ? 'The draw is under way…'
            : nextReveal === 1
              ? 'And the first overall pick goes to…'
              : nextReveal === 2
                ? 'The second pick goes to…'
                : nextReveal
                  ? `Pick #${nextReveal}…`
                  : ''}
        </p>
      )}
      {(open || live) && (
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {bySlot.map((t) => {
            const slot = t.pick!;
            const shown = !live || elapsed >= revealAt(slot, n);
            const moved = slot < t.seed;
            const top = slot <= 2;
            return (
              <li
                key={t.team.id}
                className={cx(
                  'flex items-center gap-2 rounded px-1.5 py-1 text-sm transition-all duration-700',
                  shown && moved && 'bg-goal/15 ring-1 ring-goal/40',
                  shown && top && live && 'scale-[1.02]',
                )}
              >
                <span className={cx('tabular w-7 font-display', top ? 'text-lg text-white' : 'text-ice-400')}>#{slot}</span>
                {shown ? (
                  <>
                    <TeamChip team={t.team} size="sm" />
                    <span className="flex-1 truncate">
                      {t.team.city} {t.team.name}
                    </span>
                    {moved ? (
                      <Badge tone="good">▲ from #{t.seed}</Badge>
                    ) : slot > t.seed ? (
                      <span className="text-xs text-red-300">▼ from #{t.seed}</span>
                    ) : null}
                  </>
                ) : (
                  <span className={cx('flex-1 text-ice-600', slot === nextReveal && 'animate-pulse text-ice-300')}>
                    {slot === nextReveal ? 'Drawing…' : '—'}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Shell>
  );
}

/** Live: always shown. Afterwards: a fold-away card, closed by default. */
function Shell({ live, winners, children }: { live: boolean; winners: string; children: React.ReactNode }) {
  return live ? (
    <Card title="Draft lottery · live">{children}</Card>
  ) : (
    <CollapsibleCard id="draft-lottery-results" title="Draft lottery results" summary={winners ? `Moved up: ${winners}` : 'No team moved up'}>
      {children}
    </CollapsibleCard>
  );
}

/** The pick on the clock, time left, and (for the commissioner) the controls. */
export function DraftClockBar({
  leagueId,
  draft,
  canAdvance,
  now,
  mine,
  onClockTeam,
}: {
  leagueId: string;
  draft: DraftInfo;
  canAdvance: boolean;
  now: number;
  mine: boolean;
  onClockTeam: React.ReactNode;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const control = useMutation(trpc.offseason.draftControl.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const act = (action: 'start' | 'skip' | 'finish' | 'pause' | 'resume') => control.mutate({ leagueId, action });
  const c = draft.clock;
  const left = c ? (c.paused ?? c.deadline - now) : null;
  const beforeStart = c && c.deadline - c.perPick > now;
  // A short chime-free nudge: flash when it becomes your pick.
  const wasMine = useRef(mine);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (mine && !wasMine.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 3000);
      return () => clearTimeout(t);
    }
    wasMine.current = mine;
  }, [mine]);
  if (draft.done || !draft.lotteryHeld) return null;
  const live = draft.lotteryShow && now < draft.lotteryShow.startedAt + draft.lotteryShow.length;

  return (
    <div className={cx('rounded-lg border p-3', mine ? 'border-goal bg-goal/10' : 'border-rink-600 bg-rink-900', flash && 'animate-pulse')}>
      <div className="flex flex-wrap items-center gap-4">
        {onClockTeam}
        {c ? (
          <div className="text-center">
            <p className={cx('tabular font-display text-3xl leading-none', left != null && left < 30_000 && !c.paused ? 'text-red-300' : 'text-white')}>
              {beforeStart ? mmss(c.perPick) : mmss(left ?? 0)}
            </p>
            <p className="text-[11px] tracking-wider text-ice-400 uppercase">{c.paused != null ? 'Paused' : beforeStart ? (live ? 'After the lottery' : 'Starting') : 'On the clock'}</p>
          </div>
        ) : (
          <p className="text-sm text-ice-300">{draft.started ? 'The clock is stopped.' : "The draft hasn't started."} Each pick gets 3 minutes.</p>
        )}
        {canAdvance && (
          <div className="ml-auto flex flex-wrap gap-2">
            {!c && (
              <Button disabled={control.isPending} onClick={() => act('start')}>
                Start the draft
              </Button>
            )}
            {c &&
              (c.paused != null ? (
                <Button variant="ghost" disabled={control.isPending} onClick={() => act('resume')}>
                  Resume
                </Button>
              ) : (
                <Button variant="ghost" disabled={control.isPending} onClick={() => act('pause')}>
                  Pause
                </Button>
              ))}
            <Button variant="ghost" disabled={control.isPending} onClick={() => act('skip')} title="AI teams pick until a manager is on the clock">
              Skip to next manager pick
            </Button>
            <Button
              variant="ghost"
              disabled={control.isPending}
              onClick={() => {
                if (window.confirm('Sim the rest of the draft? Managers who are still to pick get their draft list or scouts’ top choice.')) act('finish');
              }}
            >
              Sim rest of draft
            </Button>
          </div>
        )}
      </div>
      <ErrorBox error={control.error} />
    </div>
  );
}
