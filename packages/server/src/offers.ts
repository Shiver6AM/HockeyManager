/**
 * A manager's open contract offers: re-signing offers waiting for an answer,
 * sealed free-agent offers and RFA offer sheets, with the seasons each would
 * cover (for the cap outlook), plus the latest answer to a re-signing offer.
 */
import { faDecidesIn, type ContractOffer, type League, type PlayerId, type TeamId } from '@hockey-gm/sim-core';

export type OfferKind = 're-sign' | 'free-agent' | 'offer-sheet';

export interface OpenOffer {
  playerId: PlayerId;
  name: string;
  pos: string;
  kind: OfferKind;
  offer: ContractOffer;
  /** Index into the cap outlook's seasons where the deal would start. */
  startIndex: number;
  /** What's happening with it, in a few words. */
  status: string;
}

export interface LatestAnswer {
  result: 'accept' | 'counter' | 'reject' | 'refuse' | 'considering';
  offer: ContractOffer;
  counter?: ContractOffer;
  message: string;
}

export function openOffers(L: League, teamId: TeamId): OpenOffer[] {
  const os = L.offseason;
  if (!os) return [];
  const out: OpenOffer[] = [];
  const nm = (id: PlayerId) => {
    const p = L.players[id];
    return { name: p ? `${p.firstName} ${p.lastName}` : id, pos: p?.pos ?? '' };
  };
  for (const [id, pend] of Object.entries(os.pendingOffers ?? {})) {
    if (pend.teamId !== teamId || !L.players[id]) continue;
    const p = L.players[id];
    // The new deal starts when his current one ends (after this season, for an expiring player).
    const left = p.contract ? Math.max(0, p.contract.yearsLeft - 1) : 0;
    const considering = os.responses?.[id]?.teamId === teamId && os.responses[id].result === 'considering';
    out.push({ playerId: id, ...nm(id), kind: 're-sign', offer: pend.offer, startIndex: left, status: considering ? 'Thinking it over' : 'Answers tomorrow' });
  }
  for (const [id, offer] of Object.entries(os.bids?.[teamId] ?? {})) {
    if (!L.players[id]) continue;
    const d = faDecidesIn(L, id);
    out.push({ playerId: id, ...nm(id), kind: 'free-agent', offer, startIndex: 0, status: d === null ? 'Sealed offer' : d === 0 ? 'Decides today' : `Decides in ${d} day${d === 1 ? '' : 's'}` });
  }
  for (const [id, offer] of Object.entries(os.sheets?.[teamId] ?? {})) {
    if (!L.players[id]) continue;
    out.push({ playerId: id, ...nm(id), kind: 'offer-sheet', offer, startIndex: 0, status: 'Offer sheet' });
  }
  return out.map((o) => ({ ...o, startIndex: Math.min(o.startIndex, 6) }));
}

/** Latest answer to this team's re-signing offer to a player (this offseason). */
export function latestAnswer(L: League, teamId: TeamId, playerId: PlayerId): LatestAnswer | null {
  const r = L.offseason?.responses?.[playerId];
  if (!r || r.teamId !== teamId) return null;
  return { result: r.result, offer: r.offer, counter: r.counter, message: r.message };
}

/** Total offered per season (AAV), over the given number of seasons from the cap season. */
export function offeredBySeason(offers: OpenOffer[], seasons: number): number[] {
  const out = Array.from({ length: seasons }, () => 0);
  for (const o of offers) for (let i = o.startIndex; i < Math.min(seasons, o.startIndex + o.offer.years); i++) out[i] += o.offer.salary;
  return out;
}
