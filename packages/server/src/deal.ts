/**
 * What a manager may see before making a contract offer: the player's interest
 * in their team (with coarse reasons, never the hidden numbers), his ask from
 * them, how he feels about term, and his agent's estimate of the price for
 * each length of deal. The estimate carries a little per-player noise, so it
 * guides an offer without giving away the exact acceptance line.
 */
import {
  askFromTeam,
  deriveSeed,
  priceByTerm,
  priorities,
  Rng,
  teamInterest,
  termProfile,
  type ContractOffer,
  type League,
  type Player,
  type Team,
} from '@hockey-gm/sim-core';

const round25k = (x: number) => Math.round(x / 25_000) * 25_000;

export function dealTerms(L: League, p: Player, team: Team, base: ContractOffer, faRound = 0) {
  const ask = askFromTeam(L, p, team, base);
  const interest = teamInterest(L, p, team);
  const noise = 1 + new Rng(deriveSeed(L.seed, `agent:${L.season}:${p.id}:${team.id}`)).normal(0, 0.03);
  return {
    ask,
    interest: {
      score: interest.score,
      label: interest.label,
      factors: interest.factors.map((f) => ({ label: f.label, good: f.effect > 0, strong: Math.abs(f.effect) >= 0.04 })),
    },
    term: termProfile(L, p).label,
    priorities: priorities(p),
    /** Agent's estimate of the salary each term would take. */
    estimate: priceByTerm(L, p, team, base, faRound).map((x) => ({ years: x.years, salary: round25k(x.salary * noise) })),
  };
}

export type DealTerms = ReturnType<typeof dealTerms>;
