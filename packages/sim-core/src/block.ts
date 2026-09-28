/**
 * Trade blocks.
 *
 * Every team has one: the players and picks it's shopping, and what it's
 * looking for in return. Human managers set theirs; AI teams' blocks follow
 * from their strategy and roster. AI teams value incoming assets that fit
 * their needs a little higher, and are a little more willing to move what's
 * on their block, so the block is a real signal, not decoration.
 */
import { capRoom, marketValue } from './contracts';
import { age, overall } from './ratings';
import type { League, NeedTag, Player, Team, TradeAsset, TradeBlock } from './types';
import { parsePickKey, teamPicks, tradeablePickSeasons } from './trades';

export const NEED_TAGS: NeedTag[] = ['C', 'W', 'D', 'G', 'young', 'prospects', 'picks', 'veteran', 'cap-space'];
export const NEED_LABEL: Record<NeedTag, string> = {
  C: 'Center',
  W: 'Winger',
  D: 'Defenseman',
  G: 'Goalie',
  young: 'Young players',
  prospects: 'Prospects',
  picks: 'Draft picks',
  veteran: 'Proven veterans',
  'cap-space': 'Cap relief',
};


/** Value multiplier an AI applies to incoming assets that fit its needs. */
export const NEED_BONUS = 1.1;
/** …and to its own outgoing assets that it has put on the block. */
export const BLOCK_DISCOUNT = 0.9;

const slotOf = (p: Player): 'C' | 'W' | 'D' | 'G' => (p.pos === 'G' ? 'G' : p.pos === 'D' ? 'D' : p.pos === 'C' ? 'C' : 'W');
const DEPTH = { C: 4, W: 8, D: 6, G: 1 } as const;

function depthScore(league: League, team: Team, slot: keyof typeof DEPTH): number {
  const ovrs = team.roster
    .map((id) => league.players[id])
    .filter((p) => p && slotOf(p) === slot)
    .map(overall)
    .sort((a, b) => b - a);
  const top = Array.from({ length: DEPTH[slot] }, (_, i) => ovrs[i] ?? 50);
  return top.reduce((s, x) => s + x, 0) / top.length;
}

/** Positions where a team ranks in the bottom third of the league. */
export function positionNeeds(league: League, team: Team): NeedTag[] {
  const teams = Object.values(league.teams);
  const cut = Math.floor(teams.length * (2 / 3));
  return (['C', 'W', 'D', 'G'] as const).filter((slot) => {
    const scores = teams.map((t) => [t.id, depthScore(league, t, slot)] as const).sort((a, b) => b[1] - a[1]);
    return scores.findIndex(([id]) => id === team.id) >= cut;
  });
}

function aiNeeds(league: League, team: Team): NeedTag[] {
  const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
  const tags: NeedTag[] = positionNeeds(league, team);
  if (strategy === 'rebuild') tags.push('picks', 'prospects', 'young');
  if (strategy === 'contend') tags.push('veteran');
  if (capRoom(league, team) < 1_500_000) tags.push('cap-space');
  return tags;
}

function aiBlock(league: League, team: Team): TradeBlock {
  const strategy = team.controller.kind === 'ai' ? team.controller.strategy : 'balanced';
  const season = league.season + (league.phase === 'offseason' ? 1 : 0);
  const roster = team.roster.map((id) => league.players[id]).filter(Boolean);
  const pendingUfa = (p: Player) => (p.contract?.yearsLeft ?? 0) <= 1 && p.contract?.expiresAs === 'UFA' && !p.extension;
  const overpaid = (p: Player) => !!p.contract && p.contract.salary > marketValue(p, league.season, league.settings.salaryCap) * 1.3 && p.contract.salary > 2_000_000;
  let players: Player[];
  if (strategy === 'rebuild') players = roster.filter((p) => (age(p, season) >= 29 && overall(p) >= 68) || (pendingUfa(p) && overall(p) >= 65));
  else if (strategy === 'contend') players = roster.filter((p) => overpaid(p) || (age(p, season) >= 33 && overall(p) < 72));
  else players = roster.filter((p) => overpaid(p) || (pendingUfa(p) && age(p, season) >= 28));
  const needs = aiNeeds(league, team);
  const picks =
    strategy === 'contend'
      ? teamPicks(league, team.id).filter((k) => {
          const { round, season: s } = parsePickKey(k);
          return round >= 2 && round <= 4 && s <= tradeablePickSeasons(league)[1];
        })
      : [];
  return { players: players.sort((a, b) => overall(b) - overall(a)).slice(0, 6).map((p) => p.id), picks: picks.slice(0, 6), needs };
}

/** A team's current block. Human blocks drop anything the team no longer owns. */
export function tradeBlock(league: League, team: Team): TradeBlock {
  if (team.controller.kind === 'ai') return aiBlock(league, team);
  const b = team.tradeBlock ?? { players: [], picks: [], needs: [] };
  const own = new Set(teamPicks(league, team.id));
  return {
    players: b.players.filter((id) => league.players[id] && (league.players[id].teamId === team.id || league.players[id].prospectOf === team.id)),
    picks: b.picks.filter((k) => own.has(k)),
    needs: b.needs.filter((t) => NEED_TAGS.includes(t)),
    note: b.note,
  };
}

export function setTradeBlock(league: League, team: Team, block: TradeBlock) {
  if (team.controller.kind !== 'human') throw new Error('Only managers set their own trade block');
  const clean = { ...block, note: block.note?.slice(0, 200) };
  team.tradeBlock = clean;
  team.tradeBlock = tradeBlock(league, team);
}

/** Which of a team's needs an asset satisfies (empty = none). */
export function assetFits(league: League, a: TradeAsset, needs: NeedTag[]): NeedTag[] {
  if (!needs.length) return [];
  if (a.kind === 'pick') return needs.includes('picks') ? ['picks'] : [];
  const p = league.players[a.id];
  if (!p) return [];
  const out: NeedTag[] = [];
  const season = league.season + (league.phase === 'offseason' ? 1 : 0);
  const a_ = age(p, season);
  const ovr = overall(p);
  const slot = slotOf(p);
  // A position need is only filled by someone who'd actually play there.
  if (needs.includes(slot) && ovr >= 66) out.push(slot);
  if (needs.includes('prospects') && !p.teamId) out.push('prospects');
  if (needs.includes('young') && a_ <= 24 && p.teamId) out.push('young');
  if (needs.includes('veteran') && a_ >= 27 && ovr >= 76) out.push('veteran');
  if (needs.includes('cap-space') && (!p.contract || p.contract.salary <= 1_000_000)) out.push('cap-space');
  return out;
}
