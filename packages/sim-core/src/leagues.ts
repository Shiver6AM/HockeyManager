/**
 * Where players outside the NHL play: North American junior and college
 * leagues, European pro and junior leagues, and the AHL (farm teams).
 *
 * Every league belongs to a scouting region. A prospect's league follows from
 * his nationality and age (Canadians mostly in the CHL, Americans in the USHL
 * then college, Swedes in the J20 then the SHL, and so on), and his team is
 * stable for as long as he stays in that league.
 */
import { age } from './ratings';
import { deriveSeed, Rng } from './rng';
import type { League, Player } from './types';

export type Region = 'west' | 'ontario' | 'quebec' | 'usa' | 'sweden' | 'finland' | 'russia' | 'central';

export const REGIONS: Array<{ id: Region; label: string; leagues: string }> = [
  { id: 'west', label: 'Western Canada', leagues: 'WHL' },
  { id: 'ontario', label: 'Ontario', leagues: 'OHL' },
  { id: 'quebec', label: 'Quebec & Maritimes', leagues: 'QMJHL' },
  { id: 'usa', label: 'United States', leagues: 'USHL, NCAA' },
  { id: 'sweden', label: 'Sweden', leagues: 'SHL, J20' },
  { id: 'finland', label: 'Finland', leagues: 'Liiga, U20' },
  { id: 'russia', label: 'Russia', leagues: 'KHL, MHL' },
  { id: 'central', label: 'Central Europe', leagues: 'Czech Extraliga, Swiss NL, DEL' },
];
export const REGION_LABEL = Object.fromEntries(REGIONS.map((r) => [r.id, r.label])) as Record<Region, string>;

export interface MinorLeague {
  name: string;
  region: Region | 'pro';
  /** Typical overall of a player at this level (drives stat lines). */
  level: number;
  /** Regular-season games. */
  games: number;
  teams: string[];
}

export const MINOR_LEAGUES: Record<string, MinorLeague> = {
  WHL: { name: 'WHL', region: 'west', level: 49, games: 68, teams: ['Kamloops', 'Kelowna', 'Portland', 'Seattle', 'Spokane', 'Everett', 'Regina', 'Saskatoon', 'Brandon', 'Lethbridge', 'Medicine Hat', 'Red Deer', 'Prince George', 'Victoria', 'Calgary', 'Edmonton', 'Moose Jaw', 'Swift Current', 'Vancouver', 'Wenatchee'] },
  OHL: { name: 'OHL', region: 'ontario', level: 50, games: 68, teams: ['London', 'Kitchener', 'Oshawa', 'Peterborough', 'Ottawa', 'Sudbury', 'Kingston', 'Barrie', 'Windsor', 'Sarnia', 'Guelph', 'Erie', 'Flint', 'Saginaw', 'Niagara', 'North Bay', 'Owen Sound', 'Sault Ste. Marie', 'Brampton', 'Brantford'] },
  QMJHL: { name: 'QMJHL', region: 'quebec', level: 48, games: 68, teams: ['Rimouski', 'Halifax', 'Moncton', 'Saint John', 'Quebec', 'Shawinigan', 'Drummondville', 'Gatineau', 'Sherbrooke', 'Chicoutimi', 'Charlottetown', 'Cape Breton', 'Val-d’Or', 'Rouyn-Noranda', 'Baie-Comeau', 'Victoriaville', 'Blainville', 'Bathurst'] },
  USHL: { name: 'USHL', region: 'usa', level: 46, games: 62, teams: ['Sioux City', 'Dubuque', 'Green Bay', 'Madison', 'Chicago', 'Omaha', 'Fargo', 'Lincoln', 'Des Moines', 'Youngstown', 'Muskegon', 'Tri-City', 'Cedar Rapids', 'Waterloo', 'Sioux Falls', 'Youngstown'] },
  NCAA: { name: 'NCAA', region: 'usa', level: 54, games: 36, teams: ['Boston University', 'Boston College', 'Minnesota', 'Michigan', 'North Dakota', 'Denver', 'Wisconsin', 'Harvard', 'Cornell', 'Notre Dame', 'Maine', 'Providence', 'Michigan State', 'Minnesota Duluth', 'Quinnipiac', 'Penn State', 'Ohio State', 'Colorado College'] },
  J20: { name: 'J20 Nationell', region: 'sweden', level: 46, games: 44, teams: ['Stockholm', 'Gothenburg', 'Luleå', 'Skellefteå', 'Växjö', 'Örebro', 'Linköping', 'Malmö', 'Jönköping', 'Karlstad', 'Leksand', 'Brynäs'] },
  SHL: { name: 'SHL', region: 'sweden', level: 61, games: 52, teams: ['Stockholm', 'Gothenburg', 'Luleå', 'Skellefteå', 'Växjö', 'Örebro', 'Linköping', 'Malmö', 'Jönköping', 'Karlstad', 'Leksand', 'Gävle'] },
  U20: { name: 'U20 SM-sarja', region: 'finland', level: 46, games: 46, teams: ['Helsinki', 'Tampere', 'Turku', 'Oulu', 'Kuopio', 'Jyväskylä', 'Rauma', 'Lahti', 'Pori', 'Hämeenlinna'] },
  Liiga: { name: 'Liiga', region: 'finland', level: 59, games: 60, teams: ['Helsinki', 'Tampere', 'Turku', 'Oulu', 'Kuopio', 'Jyväskylä', 'Rauma', 'Lahti', 'Pori', 'Hämeenlinna', 'Lappeenranta', 'Vaasa'] },
  MHL: { name: 'MHL', region: 'russia', level: 47, games: 60, teams: ['Moscow', 'St. Petersburg', 'Kazan', 'Yaroslavl', 'Omsk', 'Ufa', 'Magnitogorsk', 'Chelyabinsk', 'Novosibirsk', 'Nizhny Novgorod'] },
  KHL: { name: 'KHL', region: 'russia', level: 63, games: 68, teams: ['Moscow', 'St. Petersburg', 'Kazan', 'Yaroslavl', 'Omsk', 'Ufa', 'Magnitogorsk', 'Chelyabinsk', 'Novosibirsk', 'Nizhny Novgorod', 'Minsk', 'Sochi'] },
  Extraliga: { name: 'Czech Extraliga', region: 'central', level: 58, games: 52, teams: ['Prague', 'Brno', 'Pilsen', 'Třinec', 'Liberec', 'Pardubice', 'Vítkovice', 'Kladno', 'Litvínov', 'Olomouc'] },
  NL: { name: 'Swiss NL', region: 'central', level: 60, games: 52, teams: ['Zurich', 'Bern', 'Lugano', 'Geneva', 'Davos', 'Zug', 'Lausanne', 'Fribourg', 'Biel'] },
  DEL: { name: 'DEL', region: 'central', level: 58, games: 52, teams: ['Munich', 'Berlin', 'Mannheim', 'Cologne', 'Düsseldorf', 'Ingolstadt', 'Wolfsburg', 'Nuremberg', 'Straubing'] },
  ECHL: { name: 'ECHL', region: 'pro', level: 52, games: 72, teams: ['Florida', 'Toledo', 'Idaho', 'Allen', 'Cincinnati', 'Reading', 'South Carolina', 'Wheeling', 'Kalamazoo', 'Norfolk'] },
  AHL: { name: 'AHL', region: 'pro', level: 58, games: 72, teams: [] },
};

export interface MinorTeam {
  season: number;
  league: string;
  team: string;
}

const EUROPE: Record<string, [string, string]> = {
  SWE: ['J20', 'SHL'],
  FIN: ['U20', 'Liiga'],
  RUS: ['MHL', 'KHL'],
  CZE: ['Extraliga', 'Extraliga'],
  SVK: ['Extraliga', 'Extraliga'],
  GER: ['DEL', 'DEL'],
};

/** Which league a player outside the NHL plays in this season (stable for the season). */
export function minorLeagueOf(league: League, p: Player, farmTeamLabel?: string): MinorTeam {
  const season = league.season;
  if (p.minorTeam && p.minorTeam.season === season && (!farmTeamLabel || p.minorTeam.league === 'AHL')) return p.minorTeam;
  if (farmTeamLabel) return (p.minorTeam = { season, league: 'AHL', team: farmTeamLabel });
  const a = age(p, season);
  const rng = new Rng(deriveSeed(league.seed, `minor-league:${p.id}`));
  const roll = rng.next(); // stable choices for this player
  const nat = p.nationality;
  let lg: string;
  if (nat === 'CAN') lg = a <= 20 ? (roll < 0.36 ? 'OHL' : roll < 0.7 ? 'WHL' : roll < 0.9 ? 'QMJHL' : 'NCAA') : roll < 0.25 ? 'NCAA' : 'ECHL';
  else if (nat === 'USA') lg = a <= 18 ? (roll < 0.25 ? 'OHL' : 'USHL') : a <= 22 ? (roll < 0.2 ? 'OHL' : 'NCAA') : 'ECHL';
  else if (EUROPE[nat]) {
    const [junior, pro] = EUROPE[nat];
    // Some Europeans come over to the CHL as teenagers.
    lg = a <= 19 && roll < 0.2 ? (roll < 0.1 ? 'OHL' : 'WHL') : a <= 18 ? junior : pro;
  } else lg = a <= 19 ? 'OHL' : 'ECHL';
  // Stay with the same club when moving up within the same country.
  const prev = p.minorTeam;
  const teams = MINOR_LEAGUES[lg].teams;
  const team = prev && teams.includes(prev.team) ? prev.team : teams[Math.floor(rng.next() * teams.length)];
  return (p.minorTeam = { season, league: lg, team });
}

export const leagueRegion = (lg: string): Region | 'pro' => MINOR_LEAGUES[lg]?.region ?? 'pro';
