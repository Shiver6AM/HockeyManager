import {
  ARENA_CAPACITY,
  assignScout,
  hireScout,
  playerRegion,
  regionConfidence,
  regionScoutReads,
  scoutCeiling,
  REGIONS,
  releaseScout,
  SCOUTING,
  scoutPayroll,
  scoutRate,
  scoutRegions,
  type Region,
  type Scout,
  coachability,
  coachabilityLabel,
  coachesOf,
  hireSkillsCoach,
  overall,
  projectedSeasonGain,
  releaseSkillsCoach,
  resolvePlan,
  setCoachPlan,
  SKILL_GROUP_LABEL,
  SKILL_GROUP_OF,
  SKILL_GROUPS,
  SKILLS,
  skillLabel,
  skillsCoachPayroll,
  skillsFor,
  skillValue,
  type SkillsCoach,
  type TrainableSkill,
  expenses,
  hireStaff,
  OWNER_GOAL_LABEL,
  revenue,
  STAFF_LABEL,
  STAFF_ROLES,
  staffPayroll,
  type League,
  type TeamFinances,
  cssEdition,
  cssUpdate,
  scoutTargets,
  scoutConfidence,
  assignScoutTargets,
  isDraftClass,
  clearScoutPlan,
  currentLeg,
  scoutPlanWindow,
  setScoutPlan,
  withMemo,
} from '@hockey-gm/sim-core';
import { z } from 'zod';
import { mutateLeague } from '../advance';
import { readLeague } from '../state';
import { authedProcedure, badRequest, memberProcedure, router } from '../trpc';
import { storyPlayers, teamInfo } from '../views';
import { classView } from './offseason';

function financeView(f: TeamFinances) {
  return {
    season: f.season,
    homeGames: f.homeGames,
    avgAttendance: f.homeGames ? Math.round(f.attendance / f.homeGames) : 0,
    capacity: ARENA_CAPACITY,
    gate: f.gate,
    playoffGate: f.playoffGate,
    media: f.media,
    sponsorship: f.sponsorship,
    salaries: f.salaries,
    staff: f.staff,
    operations: f.operations,
    revenue: revenue(f),
    expenses: expenses(f),
    profit: revenue(f) - expenses(f),
  };
}

export const lifeRouter = router({
  // ---- Notifications (across all leagues for the signed-in user) ----
  notifications: authedProcedure.input(z.object({ leagueId: z.string().optional() })).query(async ({ ctx, input }) => {
    const params: unknown[] = [ctx.user.id];
    let where = 'user_id = $1';
    if (input.leagueId) {
      params.push(input.leagueId);
      where += ' and league_id = $2';
    }
    const rows = await ctx.db.query<{ id: string; league_id: string; kind: string; text: string; link: string | null; created_at: Date; read_at: Date | null; refs: Array<{ id: string; name: string }> | string | null }>(
      `select id, league_id, kind, text, link, created_at, read_at, refs from notifications where ${where} order by id desc limit 40`,
      params,
    );
    const unread = await ctx.db.query<{ n: string }>(`select count(*) as n from notifications where ${where} and read_at is null`, params);
    return {
      unread: Number(unread[0].n),
      items: rows.map((r) => ({
        id: Number(r.id),
        leagueId: r.league_id,
        kind: r.kind,
        text: r.text,
        link: r.link,
        at: r.created_at,
        read: !!r.read_at,
        /** Players named in the text (each name links to his page). */
        players: (typeof r.refs === 'string' ? (JSON.parse(r.refs) as Array<{ id: string; name: string }>) : r.refs) ?? [],
      })),
    };
  }),

  markRead: authedProcedure.input(z.object({ leagueId: z.string().optional(), id: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    if (input.id) await ctx.db.query('update notifications set read_at = now() where user_id = $1 and id = $2', [ctx.user.id, input.id]);
    else if (input.leagueId) await ctx.db.query('update notifications set read_at = now() where user_id = $1 and league_id = $2 and read_at is null', [ctx.user.id, input.leagueId]);
    else await ctx.db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [ctx.user.id]);
    return { ok: true };
  }),

  // ---- News ----
  news: memberProcedure.input(z.object({ teamId: z.string().optional(), limit: z.number().int().min(1).max(200).default(60) })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return (L.news ?? [])
      .filter((n) => !input.teamId || n.teamIds.includes(input.teamId))
      .slice(-input.limit)
      .reverse()
      .map((n) => ({
        ...n,
        teams: n.teamIds.filter((id) => L.teams[id]).map((id) => teamInfo(L.teams[id])),
        /** Players named in the headline, in order (each name links to his page). */
        players: storyPlayers(L, n),
      }));
  }),

  // ---- Front office: staff, finances, owner ----
  frontOffice: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw badRequest('No such team');
    const isMine = ctx.membership.teamId === t.id;
    return {
      team: teamInfo(t),
      isMine,
      market: t.market ?? 1,
      staff: STAFF_ROLES.map((role) => ({ role, label: STAFF_LABEL[role], member: t.staff?.[role] ?? null })),
      staffPayroll: staffPayroll(t) + skillsCoachPayroll(t) + scoutPayroll(t),
      finances: t.finances ? financeView(t.finances) : null,
      history: (t.financeHistory ?? []).map(financeView).reverse(),
      cash: t.cash ?? 0,
      owner: t.owner ? { ...t.owner, goalLabel: OWNER_GOAL_LABEL[t.owner.goal] } : null,
    };
  }),

  staffPool: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return (L.staffPool ?? []).slice().sort((a, b) => a.role.localeCompare(b.role) || b.rating - a.rating);
  }),

  hireStaff: memberProcedure.input(z.object({ staffId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return hireStaff(L, L.teams[teamId], input.staffId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  // ---- Skills coaches ----
  skillsCoaching: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw badRequest('No such team');
    const isMine = ctx.membership.teamId === t.id;
    const plan = resolvePlan(L, t);
    const coachView = (c: SkillsCoach) => ({
      id: c.id,
      name: c.name,
      ratings: c.ratings,
      specialties: c.specialties,
      salary: c.salary,
      yearsLeft: c.yearsLeft,
      auto: c.auto,
      assignments: c.assignments,
      kind: c.kind ?? 'skills',
    });
    const skillOptions = [...new Set(t.roster.flatMap((id) => (L.players[id] ? skillsFor(L.players[id]) : [])))].map((s) => ({
      id: s,
      label: skillLabel(s),
      group: SKILL_GROUP_OF[s],
      situational: !['skating', 'shooting', 'passing', 'handling', 'offIQ', 'defIQ', 'checking', 'faceoffs', 'discipline', 'endurance', 'reflexes', 'positioning', 'rebounds', 'mental'].includes(s),
    }));
    return {
      isMine,
      maxCoaches: SKILLS.maxCoaches,
      maxPlayers: SKILLS.maxPlayers,
      groups: SKILL_GROUPS.map((g) => ({ id: g, label: SKILL_GROUP_LABEL[g] })),
      skills: skillOptions,
      maxGoalies: SKILLS.maxGoalies,
      coaches: coachesOf(t).map((c) => ({
        ...coachView(c),
        working: plan
          .filter((x) => x.coach.id === c.id)
          .map((x) => ({
            playerId: x.player.id,
            name: `${x.player.firstName} ${x.player.lastName}`,
            pos: x.player.pos,
            skill: x.skill,
            label: skillLabel(x.skill),
            value: skillValue(x.player, x.skill),
            progress: Math.round(((x.player.trainingProgress?.[x.skill] ?? 0) % 1) * 100) / 100,
            seasonPace: projectedSeasonGain(L, c, x.player, x.skill),
          })),
      })),
      roster: t.roster
        .map((id) => L.players[id])
        .filter(Boolean)
        .map((p) => ({
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
          pos: p.pos,
          age: L.season - p.birthYear,
          overall: overall(p),
          coachability: coachability(p),
          coachabilityLabel: coachabilityLabel(coachability(p)),
          skills: Object.fromEntries(skillsFor(p).map((s) => [s, skillValue(p, s)])),
          gains: p.trainingLog?.season === L.season ? p.trainingLog.gains : {},
          /** Pace (points per season) under each of this team's coaches for each skill, for the assignment editor. */
          pace: Object.fromEntries(
            coachesOf(t).map((c) => [c.id, Object.fromEntries(skillsFor(p).map((s) => [s, projectedSeasonGain(L, c, p, s as TrainableSkill)]))]),
          ),
        }))
        .sort((a, b) => b.overall - a.overall),
      pool: isMine ? [...(L.skillsCoachPool ?? []), ...(L.goalieCoachPool ?? [])].map(coachView).sort((a, b) => b.salary - a.salary) : [],
      payroll: skillsCoachPayroll(t),
    };
  }),

  hireSkillsCoach: memberProcedure.input(z.object({ coachId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        const c = hireSkillsCoach(L, L.teams[teamId], input.coachId);
        return { name: c.name };
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  releaseSkillsCoach: memberProcedure.input(z.object({ coachId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return releaseSkillsCoach(L, L.teams[teamId], input.coachId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  setCoachPlan: memberProcedure
    .input(
      z.object({
        coachId: z.string(),
        auto: z.boolean(),
        assignments: z.array(z.object({ playerId: z.string(), skill: z.string() })).max(5),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = ctx.membership.teamId;
      if (!teamId) throw badRequest('You do not manage a team');
      await mutateLeague(ctx.db, input.leagueId, (L) => {
        try {
          setCoachPlan(L.teams[teamId], input.coachId, { auto: input.auto, assignments: input.assignments as SkillsCoach['assignments'] }, L);
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
      return { ok: true };
    }),

  // ---- Scouting ----
  scouting: memberProcedure.input(z.object({ teamId: z.string() })).query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const t = L.teams[input.teamId];
    if (!t) throw badRequest('No such team');
    const isMine = ctx.membership.teamId === t.id;
    const where = new Map(scoutRegions(L, t).map((x) => [x.scout.id, x.region]));
    // Other teams' scouting knowledge stays private.
    const conf = (r: Region) => (isMine ? Math.round(regionConfidence(L, t.id, r) * 100) / 100 : null);
    const classIds = L.draftClass?.ids ?? L.offseason?.draft.classIds ?? [];
    const inRegion = (r: Region) => classIds.filter((id) => L.players[id] && L.players[id].draftClass !== undefined && playerRegion(L, L.players[id]) === r).length;
    const nameOf = (id: string) => (L.players[id] ? `${L.players[id].firstName} ${L.players[id].lastName}` : id);
    const planView = (sc: Scout) => {
      const plan = sc.plan!;
      const cur = currentLeg(L, sc);
      let day = plan.startDay;
      return {
        season: plan.season,
        startDay: plan.startDay,
        current: cur?.index ?? null,
        legs: plan.legs.map((l, i) => {
          const from = day;
          day += l.weeks * 7;
          return {
            ...l,
            from,
            to: day - 1,
            done: plan.season === L.season && L.phase !== 'offseason' && cur !== null && i < cur.index,
            targets: l.targets ? { league: l.targets.league, players: l.targets.ids.map((id) => ({ id, name: nameOf(id) })) } : undefined,
          };
        }),
      };
    };
    const scoutView = (sc: Scout) => {
      const targets = isMine ? scoutTargets(L, sc) : [];
      return {
        ...sc,
        region: where.get(sc.id) ?? null,
        /** The most he can learn about a region on his own. */
        ceiling: Math.round(scoutCeiling(sc.skill) * 100) / 100,
        ratePerDay: where.get(sc.id) ? Math.round(scoutRate(t, sc, where.get(sc.id)!) * 100) / 100 : null,
        /** His schedule: each stop with the days it covers (the last one carries on to season's end). */
        plan: isMine && sc.plan ? planView(sc) : null,
        /** Prospects he's following (with your confidence in each). */
        following:
          sc.assignment === 'players' && sc.targets
            ? {
                league: sc.targets.league,
                players: targets.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, pos: p.pos, confidence: Math.round(scoutConfidence(L, t.id, p) * 100) / 100 })),
              }
            : null,
      };
    };
    return {
      isMine,
      maxScouts: SCOUTING.maxScouts,
      maxTargets: SCOUTING.maxTargets,
      maxLegs: SCOUTING.maxLegs,
      /** What a new schedule would cover: weeks left in this season (or all of next season in the summer). */
      planWindow: isMine ? scoutPlanWindow(L) : null,
      season: L.season,
      day: L.day,
      headScout: t.staff?.scout ?? null,
      draftSeason: L.draftClass?.season ?? L.offseason?.draft.season ?? null,
      regions: REGIONS.map((r) => ({
        ...r,
        confidence: conf(r.id),
        prospects: inRegion(r.id),
        /** Each scout's own read of the region this season (they combine into the confidence). */
        reads: isMine
          ? regionScoutReads(L, t.id, r.id).map((x) => ({
              scoutId: x.scoutId,
              name: t.scouts?.find((sc) => sc.id === x.scoutId)?.name ?? 'A former scout',
              read: Math.round(x.read * 100) / 100,
            }))
          : [],
      })),
      scouts: (t.scouts ?? []).map(scoutView),
      pool: isMine ? (L.scoutPool ?? []).map((sc) => ({ ...sc, region: null, ceiling: Math.round(scoutCeiling(sc.skill) * 100) / 100, ratePerDay: null })).sort((a, b) => b.skill - a.skill) : [],
      payroll: scoutPayroll(t),
      /** Knowledge needed for ~63% confidence, and a good scout's daily pace, for the explainer. */
      k: SCOUTING.K,
    };
  }),

  /** This season's draft class, as your scouts see it. */
  draftClass: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    return withMemo(() => {
    const d = L.draftClass ?? (L.offseason?.draft ? { season: L.offseason.draft.season, ids: L.offseason.draft.classIds } : null);
    if (!d) return null;
    const my = ctx.membership.teamId;
    // Scouts follow prospects while they're playing: the regular season and playoffs, before the draft.
    const followable = L.phase !== 'offseason';
    return {
      season: d.season,
      /** Can scouts be sent to follow specific prospects right now? */
      followable,
      followNote: followable
        ? null
        : L.offseason?.stage === 'draft' || L.offseason?.stage === 'fantasy-draft'
          ? 'This class has stopped playing: the draft is on. Next season’s class takes the ice on opening night.'
          : 'Next season’s draft class takes the ice on opening night. Until then you can plan regions; specific prospects can be followed once the season starts.',
      /** Which Central Scouting list is out ("Preliminary", "Update 4", "Final") and when it was published. */
      cssEdition: cssEdition(L),
      cssUpdate: cssUpdate(L),
      /** Prospects my scouts are following. */
      targeted: my ? (L.teams[my].scouts ?? []).flatMap((sc) => (sc.assignment === 'players' ? (sc.targets?.ids ?? []) : [])) : [],
      players: d.ids
        .map((id) => L.players[id])
        .filter((p) => p && p.draftClass !== undefined)
        .map((p) => ({ ...classView(L, my, p, d.season), followable: followable && isDraftClass(L, p) }))
        .sort((a, b) => b.scoutValue - a.scoutValue),
    };
    });
  }),

  hireScout: memberProcedure.input(z.object({ scoutId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return { name: hireScout(L, L.teams[teamId], input.scoutId).name };
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  releaseScout: memberProcedure.input(z.object({ scoutId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    return mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        return releaseScout(L, L.teams[teamId], input.scoutId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
  }),

  /** Send a scout to follow specific prospects (up to 10, all in one league). */
  assignScoutTargets: memberProcedure
    .input(z.object({ scoutId: z.string(), league: z.string(), playerIds: z.array(z.string()).min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = ctx.membership.teamId;
      if (!teamId) throw badRequest('You do not manage a team');
      await mutateLeague(ctx.db, input.leagueId, (L) => {
        try {
          assignScoutTargets(L, L.teams[teamId], input.scoutId, input.league, input.playerIds);
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
      return { ok: true };
    }),

  /** Give a scout a schedule of assignments (region, head scout's call, or specific prospects), each for a number of weeks. */
  setScoutPlan: memberProcedure
    .input(
      z.object({
        scoutId: z.string(),
        legs: z
          .array(
            z.object({
              weeks: z.number().int().min(1).max(60),
              assignment: z.enum(['auto', 'players', 'west', 'ontario', 'quebec', 'usa', 'sweden', 'finland', 'russia', 'central']),
              targets: z.object({ league: z.string(), ids: z.array(z.string()).min(1).max(10) }).optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = ctx.membership.teamId;
      if (!teamId) throw badRequest('You do not manage a team');
      await mutateLeague(ctx.db, input.leagueId, (L) => {
        try {
          setScoutPlan(L, L.teams[teamId], input.scoutId, input.legs);
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
      return { ok: true };
    }),

  clearScoutPlan: memberProcedure.input(z.object({ scoutId: z.string() })).mutation(async ({ ctx, input }) => {
    const teamId = ctx.membership.teamId;
    if (!teamId) throw badRequest('You do not manage a team');
    await mutateLeague(ctx.db, input.leagueId, (L) => {
      try {
        clearScoutPlan(L.teams[teamId], input.scoutId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    });
    return { ok: true };
  }),

  assignScout: memberProcedure
    .input(z.object({ scoutId: z.string(), region: z.enum(['auto', 'west', 'ontario', 'quebec', 'usa', 'sweden', 'finland', 'russia', 'central']) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = ctx.membership.teamId;
      if (!teamId) throw badRequest('You do not manage a team');
      await mutateLeague(ctx.db, input.leagueId, (L) => {
        try {
          assignScout(L.teams[teamId], input.scoutId, input.region);
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      });
      return { ok: true };
    }),

  // ---- League history ----
  history: memberProcedure.query(async ({ ctx, input }) => {
    const L = await readLeague(ctx.db, input.leagueId);
    const ti = (id: string | null) => (id && L.teams[id] ? teamInfo(L.teams[id]) : null);
    const titles = new Map<string, number>();
    for (const h of L.history) if (h.champion) titles.set(h.champion, (titles.get(h.champion) ?? 0) + 1);
    return {
      seasons: L.history
        .slice()
        .reverse()
        .map((h) => ({ season: h.season, champion: ti(h.champion), runnerUp: ti(h.runnerUp), mvp: h.awards['Hart Trophy'] ?? null, mvpName: nameOf(L, h.awards['Hart Trophy']?.playerId) })),
      titles: [...titles].map(([id, n]) => ({ team: ti(id)!, titles: n })).sort((a, b) => b.titles - a.titles),
      hallOfFame: (L.hallOfFame ?? []).slice().reverse().map((h) => ({ ...h, team: ti(h.lastTeamId) })),
      leaders: allTimeLeaders(L),
    };
  }),
});

function nameOf(L: League, id: string | null | undefined) {
  if (!id) return null;
  const p = L.players[id];
  if (p) return `${p.firstName} ${p.lastName}`;
  return L.retired?.[id]?.name ?? null;
}

/** League-era career totals for active and retired players. */
function allTimeLeaders(L: League) {
  const totals = new Map<string, { id: string; name: string; gp: number; g: number; a: number; w: number; so: number; active: boolean }>();
  const add = (id: string, name: string, active: boolean, lines: Array<{ skater: { gp: number; g: number; a: number } | null; goalie: { gp: number; w: number; so: number } | null }>) => {
    const t = totals.get(id) ?? { id, name, gp: 0, g: 0, a: 0, w: 0, so: 0, active };
    for (const c of lines) {
      if (c.skater) {
        t.gp += c.skater.gp;
        t.g += c.skater.g;
        t.a += c.skater.a;
      }
      if (c.goalie) {
        t.gp += c.goalie.gp;
        t.w += c.goalie.w;
        t.so += c.goalie.so;
      }
    }
    totals.set(id, t);
  };
  for (const [id, lines] of Object.entries(L.careerStats ?? {})) {
    const p = L.players[id];
    if (p) add(id, `${p.firstName} ${p.lastName}`, true, lines);
  }
  for (const r of Object.values(L.retired ?? {})) add(r.id, r.name, false, r.career);
  // Include the season in progress.
  if (L.phase !== 'offseason') {
    for (const [id, s] of Object.entries(L.skaterStats)) {
      const p = L.players[id];
      if (p) add(id, `${p.firstName} ${p.lastName}`, true, [{ skater: s, goalie: null }]);
    }
    for (const [id, s] of Object.entries(L.goalieStats)) {
      const p = L.players[id];
      if (p) add(id, `${p.firstName} ${p.lastName}`, true, [{ skater: null, goalie: s }]);
    }
  }
  const all = [...totals.values()];
  const top = (key: (x: (typeof all)[number]) => number) =>
    all
      .filter((x) => key(x) > 0)
      .sort((a, b) => key(b) - key(a))
      .slice(0, 10)
      .map((x) => ({ id: x.id, name: x.name, active: x.active, value: key(x) }));
  return { points: top((x) => x.g + x.a), goals: top((x) => x.g), wins: top((x) => x.w) };
}
