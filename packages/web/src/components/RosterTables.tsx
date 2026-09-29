/**
 * The team's roster: NHL skaters and goalies, then the farm team. Every column
 * sorts; stats can be this season, a past season or career totals.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { gaa, money, signed, svPct, toi } from '../format';
import { useLeague } from '../pages/LeagueLayout';
import { useSort } from '../sort';
import { useTRPC, type Outputs } from '../trpc';
import { OfferForm } from './OfferForm';
import { Badge, Button, Card, cx, Modal, PotentialBadge, Rating, ValueBar } from './ui';

type TeamData = Outputs['data']['team'];
export type P = TeamData['players'][number];

const STAT = 'bg-blueline/10 text-base tabular';
const STAT_H = 'bg-blueline/10 text-ice-200';
const POS_ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, G: 4 };
const GRADE_ORDER = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const potVal = (p: P) => GRADE_ORDER.indexOf(p.potential.grade);
const statusVal = (p: P) => (p.contract ? (p.contract.kind === 'ELC' ? 2 : p.contract.expiresAs === 'UFA' ? 0 : 1) : 4);

function PlayerCell({ p }: { p: P }) {
  const L = useLeague();
  return (
    <td className="whitespace-nowrap">
      <Link to={`/league/${L.id}/player/${p.id}`} className="block text-base font-semibold text-ice-50 hover:underline">
        {p.name}
      </Link>
      <span className="text-xs text-ice-500">{p.archetype}</span>
    </td>
  );
}

function Status({ p }: { p: P }) {
  if (!p.injury) return null;
  return (
    <Badge tone={p.injury.severity === 'day-to-day' ? 'warn' : 'bad'}>
      {p.injury.severity === 'day-to-day' ? 'DTD' : 'IR'} · {p.injury.type} · {p.injury.daysLeft}d
    </Badge>
  );
}

function ContractCells({ p }: { p: P }) {
  const c = p.contract;
  return (
    <>
      <td className="num tabular">
        {c ? money(c.salary) : <span className="text-ice-500">—</span>}
        {p.extension && (
          <span className="block text-[10px] text-win" title="Agreed new deal">
            → {money(p.extension.salary)} × {p.extension.years}
          </span>
        )}
      </td>
      <td className="num tabular">{c ? c.yearsLeft : '—'}</td>
      <td>
        {c ? (
          <span className={cx('text-xs', c.yearsLeft === 1 && !p.extension ? 'font-semibold text-warn' : 'text-ice-400')}>
            {c.kind === 'ELC' && <span className="mr-1 text-blue-300">ELC</span>}
            {c.expiresAs}
          </span>
        ) : (
          '—'
        )}
      </td>
    </>
  );
}

const skaterColumns = {
  name: (p: P) => p.lastName,
  pos: (p: P) => POS_ORDER[p.pos] ?? 9,
  age: (p: P) => p.age,
  ovr: (p: P) => p.overall,
  pot: potVal,
  value: (p: P) => p.tradeValue,
  gp: (p: P) => p.stats?.gp ?? 0,
  g: (p: P) => p.stats?.g ?? 0,
  a: (p: P) => p.stats?.a ?? 0,
  p: (p: P) => (p.stats ? p.stats.g + p.stats.a : 0),
  pm: (p: P) => p.stats?.pm ?? 0,
  pim: (p: P) => p.stats?.pim ?? 0,
  hits: (p: P) => p.stats?.hits ?? 0,
  toi: (p: P) => (p.stats?.gp ? p.stats.toi / p.stats.gp : 0),
  skt: (p: P) => p.skater?.skating ?? 0,
  sht: (p: P) => p.skater?.shooting ?? 0,
  pas: (p: P) => p.skater?.passing ?? 0,
  hnd: (p: P) => p.skater?.handling ?? 0,
  oiq: (p: P) => p.skater?.offIQ ?? 0,
  diq: (p: P) => p.skater?.defIQ ?? 0,
  chk: (p: P) => p.skater?.checking ?? 0,
  aav: (p: P) => p.contract?.salary ?? -1,
  yrs: (p: P) => p.contract?.yearsLeft ?? 0,
  exp: statusVal,
  inj: (p: P) => (p.injury ? p.injury.daysLeft : null),
};

export function SkaterTable({ title, players, t, statsLabel }: { title: string; players: P[]; t: TeamData; statsLabel: string }) {
  const { sorted, Th } = useSort(players, skaterColumns, { key: 'ovr' }, 'roster-skaters');
  return (
    <Card title={title} action={<span className="text-xs text-ice-400">Stats: {statsLabel}</span>}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Player</Th>
              <Th k="pos">Pos</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ovr" className="num">OVR</Th>
              <Th k="pot" title="Scouts' read on his ceiling">Pot</Th>
              <Th k="value" title="Trade value to your front office">Value</Th>
              <Th k="gp" className={cx('num', STAT_H)}>GP</Th>
              <Th k="g" className={cx('num', STAT_H)}>G</Th>
              <Th k="a" className={cx('num', STAT_H)}>A</Th>
              <Th k="p" className={cx('num', STAT_H)}>P</Th>
              <Th k="pm" className={cx('num', STAT_H)}>+/-</Th>
              <Th k="pim" className={cx('num', STAT_H)}>PIM</Th>
              <Th k="hits" className={cx('num', STAT_H)}>HIT</Th>
              <Th k="toi" className={cx('num', STAT_H)}>TOI</Th>
              <Th k="skt" className="num text-ice-500">SKT</Th>
              <Th k="sht" className="num text-ice-500">SHT</Th>
              <Th k="pas" className="num text-ice-500">PAS</Th>
              <Th k="hnd" className="num text-ice-500">HND</Th>
              <Th k="oiq" className="num text-ice-500">OIQ</Th>
              <Th k="diq" className="num text-ice-500">DIQ</Th>
              <Th k="chk" className="num text-ice-500">CHK</Th>
              <Th k="aav" className="num" title="Average annual value">AAV</Th>
              <Th k="yrs" className="num" title="Years left, including this one">Yrs</Th>
              <Th k="exp" title="Status when the contract ends">Expiry</Th>
              <Th k="inj">Injury</Th>
              {t.isMine && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const s = p.stats;
              return (
                <tr key={p.id}>
                  <PlayerCell p={p} />
                  <td className="text-ice-300">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td>
                    <PotentialBadge potential={p.potential} />
                  </td>
                  <td>
                    <ValueBar value={p.tradeValue} />
                  </td>
                  <td className={cx('num', STAT)}>{s?.gp ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.g ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.a ?? 0}</td>
                  <td className={cx('num font-bold text-white', STAT)}>{s ? s.g + s.a : 0}</td>
                  <td className={cx('num', STAT, s && s.pm > 0 ? 'text-win' : s && s.pm < 0 ? 'text-red-300' : '')}>{s ? signed(s.pm) : 0}</td>
                  <td className={cx('num', STAT)}>{s?.pim ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.hits ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.gp ? toi(s.toi, s.gp) : '—'}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.skating}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.shooting}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.passing}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.handling}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.offIQ}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.defIQ}</td>
                  <td className="num text-xs text-ice-400">{p.skater?.checking}</td>
                  <ContractCells p={p} />
                  <td>
                    <Status p={p} />
                  </td>
                  {t.isMine && (
                    <td>
                      <RosterActions t={t} p={p} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const goalieColumns = {
  name: (p: P) => p.lastName,
  age: (p: P) => p.age,
  ovr: (p: P) => p.overall,
  pot: potVal,
  value: (p: P) => p.tradeValue,
  gp: (p: P) => p.goalieStats?.gp ?? 0,
  w: (p: P) => p.goalieStats?.w ?? 0,
  l: (p: P) => p.goalieStats?.l ?? 0,
  otl: (p: P) => p.goalieStats?.otl ?? 0,
  sv: (p: P) => (p.goalieStats?.sa ? 1 - p.goalieStats.ga / p.goalieStats.sa : null),
  gaa: (p: P) => (p.goalieStats?.toi ? (p.goalieStats.ga * 3600) / p.goalieStats.toi : null),
  so: (p: P) => p.goalieStats?.so ?? 0,
  ref: (p: P) => p.goalie?.reflexes ?? 0,
  posi: (p: P) => p.goalie?.positioning ?? 0,
  reb: (p: P) => p.goalie?.rebounds ?? 0,
  men: (p: P) => p.goalie?.mental ?? 0,
  aav: (p: P) => p.contract?.salary ?? -1,
  yrs: (p: P) => p.contract?.yearsLeft ?? 0,
  exp: statusVal,
  inj: (p: P) => (p.injury ? p.injury.daysLeft : null),
};

export function GoalieTable({ players, t, statsLabel }: { players: P[]; t: TeamData; statsLabel: string }) {
  const { sorted, Th } = useSort(players, goalieColumns, { key: 'ovr' }, 'roster-goalies');
  return (
    <Card title={`Goalies (${players.length})`} action={<span className="text-xs text-ice-400">Stats: {statsLabel}</span>}>
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Player</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ovr" className="num">OVR</Th>
              <Th k="pot">Pot</Th>
              <Th k="value">Value</Th>
              <Th k="gp" className={cx('num', STAT_H)}>GP</Th>
              <Th k="w" className={cx('num', STAT_H)}>W</Th>
              <Th k="l" className={cx('num', STAT_H)}>L</Th>
              <Th k="otl" className={cx('num', STAT_H)}>OTL</Th>
              <Th k="sv" className={cx('num', STAT_H)}>SV%</Th>
              <Th k="gaa" className={cx('num', STAT_H)}>GAA</Th>
              <Th k="so" className={cx('num', STAT_H)}>SO</Th>
              <Th k="ref" className="num text-ice-500">REF</Th>
              <Th k="posi" className="num text-ice-500">POS</Th>
              <Th k="reb" className="num text-ice-500">REB</Th>
              <Th k="men" className="num text-ice-500">MEN</Th>
              <Th k="aav" className="num">AAV</Th>
              <Th k="yrs" className="num">Yrs</Th>
              <Th k="exp">Expiry</Th>
              <Th k="inj">Injury</Th>
              {t.isMine && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const s = p.goalieStats;
              return (
                <tr key={p.id}>
                  <PlayerCell p={p} />
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td>
                    <PotentialBadge potential={p.potential} />
                  </td>
                  <td>
                    <ValueBar value={p.tradeValue} />
                  </td>
                  <td className={cx('num', STAT)}>{s?.gp ?? 0}</td>
                  <td className={cx('num font-bold text-white', STAT)}>{s?.w ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.l ?? 0}</td>
                  <td className={cx('num', STAT)}>{s?.otl ?? 0}</td>
                  <td className={cx('num font-bold text-white', STAT)}>{s ? svPct(s.sa, s.ga) : '—'}</td>
                  <td className={cx('num', STAT)}>{s ? gaa(s.ga, s.toi) : '—'}</td>
                  <td className={cx('num', STAT)}>{s?.so ?? 0}</td>
                  <td className="num text-xs text-ice-400">{p.goalie?.reflexes}</td>
                  <td className="num text-xs text-ice-400">{p.goalie?.positioning}</td>
                  <td className="num text-xs text-ice-400">{p.goalie?.rebounds}</td>
                  <td className="num text-xs text-ice-400">{p.goalie?.mental}</td>
                  <ContractCells p={p} />
                  <td>
                    <Status p={p} />
                  </td>
                  {t.isMine && (
                    <td>
                      <RosterActions t={t} p={p} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const farmColumns = {
  name: (p: P) => p.lastName,
  pos: (p: P) => POS_ORDER[p.pos] ?? 9,
  age: (p: P) => p.age,
  ovr: (p: P) => p.overall,
  pot: potVal,
  value: (p: P) => p.tradeValue,
  gp: (p: P) => p.minor?.gp ?? 0,
  g: (p: P) => (p.pos === 'G' ? (p.minor?.w ?? 0) : (p.minor?.g ?? 0)),
  a: (p: P) => (p.pos === 'G' ? (p.minor?.sa ? 1 - (p.minor.ga ?? 0) / p.minor.sa : null) : (p.minor?.a ?? 0)),
  p: (p: P) => (p.pos === 'G' ? null : (p.minor?.g ?? 0) + (p.minor?.a ?? 0)),
  aav: (p: P) => p.contract?.salary ?? -1,
  yrs: (p: P) => p.contract?.yearsLeft ?? 0,
  exp: statusVal,
};

export function FarmTable({ players, t }: { players: P[]; t: TeamData }) {
  const { sorted, Th } = useSort(players, farmColumns, { key: 'ovr' }, 'roster-farm');
  return (
    <Card
      title={`Farm team · ${t.affiliate} (${players.length})`}
      action={<span className="text-xs text-ice-400">AHL stats this season · salaries count against the cap only above $1.15M</span>}
    >
      <div className="-m-4 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <Th k="name">Player</Th>
              <Th k="pos">Pos</Th>
              <Th k="age" className="num">Age</Th>
              <Th k="ovr" className="num">OVR</Th>
              <Th k="pot">Pot</Th>
              <Th k="value">Value</Th>
              <Th k="gp" className={cx('num', STAT_H)}>GP</Th>
              <Th k="g" className={cx('num', STAT_H)} title="Goals (goalies: wins)">G/W</Th>
              <Th k="a" className={cx('num', STAT_H)} title="Assists (goalies: save %)">A/SV%</Th>
              <Th k="p" className={cx('num', STAT_H)}>P</Th>
              <Th k="aav" className="num">AAV</Th>
              <Th k="yrs" className="num">Yrs</Th>
              <Th k="exp">Expiry</Th>
              {t.isMine && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const m = p.minor;
              return (
                <tr key={p.id}>
                  <PlayerCell p={p} />
                  <td className="text-ice-300">{p.pos}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Rating value={p.overall} />
                  </td>
                  <td>
                    <PotentialBadge potential={p.potential} />
                  </td>
                  <td>
                    <ValueBar value={p.tradeValue} />
                  </td>
                  <td className={cx('num', STAT)}>{m?.gp ?? 0}</td>
                  {p.pos === 'G' ? (
                    <>
                      <td className={cx('num', STAT)}>{m?.w ?? 0}</td>
                      <td className={cx('num', STAT)}>{m?.sa ? svPct(m.sa, m.ga ?? 0) : '—'}</td>
                      <td className={cx('num', STAT)}>—</td>
                    </>
                  ) : (
                    <>
                      <td className={cx('num', STAT)}>{m?.g ?? 0}</td>
                      <td className={cx('num', STAT)}>{m?.a ?? 0}</td>
                      <td className={cx('num font-bold text-white', STAT)}>{(m?.g ?? 0) + (m?.a ?? 0)}</td>
                    </>
                  )}
                  <ContractCells p={p} />
                  {t.isMine && (
                    <td>
                      <RosterActions t={t} p={p} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function RosterActions({ t, p }: { t: TeamData; p: P }) {
  const L = useLeague();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const done = { onSuccess: () => qc.invalidateQueries() };
  const release = useMutation(trpc.offseason.release.mutationOptions(done));
  const down = useMutation(trpc.offseason.sendDown.mutationOptions(done));
  const up = useMutation(trpc.offseason.callUp.mutationOptions(done));
  const [extending, setExtending] = useState(false);
  if (!t.isMine) return null;
  const buyoutNote = p.buyout
    ? `He'll be bought out: ${money(p.buyout.perSeason)} of dead cap per season for ${p.buyout.seasons} seasons.`
    : 'His contract comes off your cap and he becomes a free agent.';
  const full = t.active >= t.activeMax;
  const err = release.error ?? down.error ?? up.error;
  return (
    <span className="flex flex-wrap gap-1">
      {p.canExtend && p.deal && (
        <Button variant="ghost" className="px-1.5 py-0 text-[11px] text-blue-300" onClick={() => setExtending(!extending)}>
          Extend
        </Button>
      )}
      {p.farm ? (
        <Button
          variant="ghost"
          className="px-1.5 py-0 text-[11px] text-win"
          disabled={up.isPending || (full && !p.injury)}
          title={full ? `You have ${t.activeMax} healthy players. Send someone down first.` : 'Bring him up to the NHL roster'}
          onClick={() => up.mutate({ leagueId: L.id, playerId: p.id })}
        >
          Call up
        </Button>
      ) : (
        <Button variant="ghost" className="px-1.5 py-0 text-[11px]" disabled={down.isPending} onClick={() => down.mutate({ leagueId: L.id, playerId: p.id })}>
          Send down
        </Button>
      )}
      <Button
        variant="ghost"
        className="px-1.5 py-0 text-[11px] hover:text-red-300"
        disabled={release.isPending}
        onClick={() => {
          if (confirm(`Release ${p.name}? ${buyoutNote}`)) release.mutate({ leagueId: L.id, playerId: p.id });
        }}
      >
        Release
      </Button>
      {err && <span className="text-[11px] text-red-300">{String(err.message)}</span>}
      {extending && p.deal && (
        <Modal title={`Extend ${p.name}`} onClose={() => setExtending(false)}>
          <OfferForm leagueId={L.id} playerId={p.id} deal={p.deal} mode="negotiate" attemptsLeft={p.attemptsLeft} />
        </Modal>
      )}
    </span>
  );
}
