import { describe, expect, it } from 'vitest';
import { autoLines, generateLeague, overall, retirementChance, roleSkill, suggestTactics, systemFits, type Player } from '../src/index';

const L = generateLeague({ seed: 7 });
const players = Object.values(L.players);
const forward = players.find((p) => p.pos === 'C' && p.teamId)!;
const defenseman = players.find((p) => p.pos === 'D' && p.teamId)!;
const as = (p: Player, archetype: string): Player => ({
  ...structuredClone(p),
  archetype,
});

describe('role skills', () => {
  it('follow playing style: the same player is a better net-front man as a power forward than as a sniper', () => {
    const pf = as(forward, 'Power Forward');
    const sn = as(forward, 'Sniper');
    expect(roleSkill(pf, 'netFront')).toBeGreaterThan(roleSkill(sn, 'netFront'));
    expect(roleSkill(pf, 'forecheck')).toBeGreaterThan(roleSkill(sn, 'forecheck'));
    expect(roleSkill(sn, 'oneTimer')).toBeGreaterThan(roleSkill(pf, 'oneTimer'));
  });

  it('put offensive defensemen on the point and shutdown ones on the kill', () => {
    const od = as(defenseman, 'Offensive D');
    const sd = as(defenseman, 'Shutdown D');
    expect(roleSkill(od, 'point')).toBeGreaterThan(roleSkill(sd, 'point'));
    expect(roleSkill(sd, 'pkDefense')).toBeGreaterThan(roleSkill(od, 'pkDefense'));
  });

  it('keep forwards off the point and defensemen off the net front, on average', () => {
    const fs = players.filter((p) => p.skater && p.pos !== 'D');
    const ds = players.filter((p) => p.pos === 'D');
    const avg = (xs: Player[], r: Parameters<typeof roleSkill>[1]) => xs.reduce((s, p) => s + roleSkill(p, r), 0) / xs.length;
    expect(avg(ds, 'point')).toBeGreaterThan(avg(fs, 'point'));
    expect(avg(fs, 'netFront')).toBeGreaterThan(avg(ds, 'netFront'));
  });
});

describe('lines for every situation', () => {
  it('fills 4-on-4, 3-on-3, 5-on-3 units, the extra attacker and a shootout order with dressed, distinct players', () => {
    const team = Object.values(L.teams)[0];
    const roster = team.roster.map((id) => L.players[id]);
    const tactics = suggestTactics(roster.filter((p) => p.skater));
    const lines = autoLines(roster, tactics);
    expect(lines.fourOnFour).toHaveLength(2);
    expect(lines.threeOnThree).toHaveLength(3);
    for (const u of lines.fourOnFour!) expect(new Set(u).size).toBe(4);
    for (const u of lines.threeOnThree!) expect(new Set(u).size).toBe(3);
    expect(new Set(lines.pp4).size).toBe(4);
    expect(new Set(lines.pk3).size).toBe(3);
    expect(lines.extraAttacker).toHaveLength(6);
    expect(new Set(lines.extraAttacker).size).toBe(6);
    expect(lines.shootout).toHaveLength(5);
    const goalies = new Set(lines.goalies);
    for (const id of [...lines.fourOnFour!.flat(), ...lines.threeOnThree!.flat(), ...lines.pp4!, ...lines.pk3!, ...lines.extraAttacker!, ...lines.shootout!]) {
      expect(goalies.has(id)).toBe(false);
      expect(team.roster).toContain(id);
    }
    const fits = systemFits(roster.filter((p) => p.skater), tactics);
    for (const g of ['forecheck', 'offense', 'pp', 'pk'] as const) expect(Object.values(fits[g]).every((v) => v > 0)).toBe(true);
  });
});

describe('retirement', () => {
  const vet = players.find((p) => p.pos !== 'G' && p.skater)!;
  const withOverall = (target: number): Player => {
    const p = structuredClone(vet);
    const s = p.skater!;
    for (let i = 0; i < 200 && overall(p) !== target; i++) {
      const d = overall(p) < target ? 1 : -1;
      for (const k of Object.keys(s) as Array<keyof typeof s>) s[k] = Math.max(20, Math.min(99, s[k] + d));
    }
    return p;
  };

  it('keeps serviceable veterans playing and retires fading ones', () => {
    const star = withOverall(80);
    const fringe = withOverall(60);
    for (const age of [33, 35, 37]) expect(retirementChance(star, age, true)).toBeLessThan(retirementChance(fringe, age, true));
    expect(retirementChance(star, 33, true)).toBeLessThan(0.05);
    expect(retirementChance(fringe, 36, true)).toBeGreaterThan(0.4);
  });

  it('is rare for young players, likely in the 40s and certain at 44', () => {
    const p = withOverall(70);
    expect(retirementChance(p, 25, true)).toBeLessThan(0.01);
    expect(retirementChance(p, 41, true)).toBeGreaterThanOrEqual(0.3);
    expect(retirementChance(p, 44, true)).toBe(1);
  });
});
