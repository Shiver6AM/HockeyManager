/** Name pools for generated players, grouped by nationality. */
import { EXTRA_FIRST, EXTRA_LAST, FAMOUS } from './nameParts';

export interface NamePool {
  nationality: string;
  weight: number;
  first: string[];
  last: string[];
}

export const NAME_POOLS: NamePool[] = [
  {
    nationality: 'CAN',
    weight: 40,
    first: [
      'Connor', 'Tyler', 'Ryan', 'Brayden', 'Cole', 'Owen', 'Liam', 'Nathan', 'Evan', 'Mitch',
      'Dylan', 'Logan', 'Jordan', 'Mathieu', 'Alexandre', 'Samuel', 'Jake', 'Brandon', 'Kyle', 'Travis',
      'Jonathan', 'Mark', 'Sean', 'Carter', 'Mason', 'Hunter', 'Riley', 'Jacob', 'Nick', 'Justin',
      'Adam', 'Zach', 'Colton', 'Brett', 'Shane', 'Jean-Luc', 'Philippe', 'Gabriel', 'Olivier', 'Wyatt',
    ],
    last: [
      'MacDonald', 'Tremblay', 'Gagnon', 'Campbell', 'Stewart', 'Fraser', 'Bouchard', 'Leblanc', 'Morrison', 'Sutter',
      'Richardson', 'Cameron', 'McKenzie', 'Boucher', 'Pelletier', 'Gauthier', 'Robertson', 'Kennedy', 'Lachance', 'Hebert',
      'Reid', 'Murray', 'Dubois', 'Paquette', 'Harrison', 'Sinclair', 'Ferguson', 'Belanger', 'Doucet', 'Chisholm',
      'Wallace', 'Beaulieu', 'Marchand', 'Carlyle', 'Duchene', 'Brodeur', 'Lecavalier', 'Ouellet', 'Haines', 'Kirkwood',
      'Pritchard', 'Thibodeau', 'Vachon', 'MacLean', 'Gillis', 'Nolan', 'Brennan', 'Doyle', 'Hartley', 'Laroche',
      'Abbott', 'Aitken', 'Allard', 'Archambault', 'Arsenault', 'Babineau', 'Bannerman', 'Barkley', 'Beaton', 'Beaudoin',
      'Bedard', 'Belliveau', 'Bergeron', 'Bertrand', 'Bishop', 'Blackwood', 'Blanchette', 'Boisvert', 'Bolduc', 'Bourque',
      'Boutin', 'Boyle', 'Brassard', 'Bristow', 'Brunet', 'Buchanan', 'Burrows', 'Cadieux', 'Caldwell', 'Carmichael',
      'Caron', 'Chabot', 'Chamberlain', 'Charbonneau', 'Chartrand', 'Chiasson', 'Cloutier', 'Comeau', 'Cormier', 'Coutu',
      'Crowe', 'Cyr', 'Daigle', 'Dallaire', 'Deschamps', 'Desjardins', 'Doiron', 'Dorion', 'Drummond', 'Dufresne',
      'Dunbar', 'Dunphy', 'Durocher', 'Elliott', 'Fairbairn', 'Fitzgerald', 'Fleury', 'Fontaine', 'Forbes', 'Fortin',
      'Fournier', 'Galbraith', 'Gallant', 'Garneau', 'Gaudet', 'Gendron', 'Giroux', 'Godin', 'Goulet', 'Grady',
      'Guay', 'Guimond', 'Hadley', 'Halliday', 'Hastings', 'Hawthorne', 'Hendry', 'Holloway', 'Hudon', 'Imbeault',
      'Jardine', 'Johnstone', 'Joncas', 'Keating', 'Kerr', 'Labelle', 'Lacroix', 'Lafleur', 'Laframboise', 'Lalonde',
      'Landry', 'Langlois', 'Lapierre', 'Larocque', 'Lavallee', 'Leger', 'Lemieux', 'Lessard', 'Levesque', 'Lockhart',
      'Lussier', 'MacAulay', 'MacGregor', 'MacIsaac', 'MacKay', 'MacKinnon', 'MacLeod', 'MacNeil', 'Mailloux', 'Malone',
      'Marcotte', 'Martel', 'McAllister', 'McCann', 'McCormick', 'McFadden', 'McIntyre', 'McLellan', 'McNab', 'McPhee',
      'Meagher', 'Mercier', 'Michaud', 'Mondou', 'Morin', 'Munro', 'Nadeau', 'Nicholson', 'Noiseux', 'Ogilvie',
      'Ouimet', 'Paradis', 'Parent', 'Patenaude', 'Payette', 'Perron', 'Picard', 'Plamondon', 'Poirier', 'Pratte',
      'Proulx', 'Quenneville', 'Rancourt', 'Raymond', 'Renaud', 'Rioux', 'Robichaud', 'Rousseau', 'Roy', 'Sauve',
      'Savard', 'Sheppard', 'Simard', 'Sirois', 'Sorensen', 'Stairs', 'Surette', 'Tanguay', 'Theriault', 'Thibault',
      'Thorne', 'Tousignant', 'Turcotte', 'Vaillancourt', 'Vallieres', 'Veilleux', 'Villeneuve', 'Wainwright', 'Whelan', 'Whitcombe',
    ],
  },
  {
    nationality: 'USA',
    weight: 26,
    first: [
      'Jack', 'Matthew', 'Brady', 'Charlie', 'Quinn', 'Cutter', 'Trevor', 'Kevin', 'Chris', 'Patrick',
      'Brock', 'Cam', 'Jason', 'Tanner', 'Zeke', 'Drew', 'Beckett', 'Cooper', 'Tommy', 'Mike',
      'Lane', 'Gavin', 'Luke', 'Will', 'Sam', 'Bobby', 'Austin', 'Joey', 'Seth', 'Jimmy',
    ],
    last: [
      'Miller', 'Johnson', 'Anderson', 'Kowalski', 'Sullivan', 'Hughes', 'Walsh', 'Peterson', 'Brooks', 'Carlson',
      'Hayes', 'Donovan', 'Keller', 'Bennett', 'Foley', 'Gallagher', 'Larson', 'Novak', 'Porter', 'Quigley',
      'Reilly', 'Schultz', 'Tkachuk', 'Vogel', 'Whitman', 'Yates', 'Zimmer', 'Callahan', 'Duffy', 'Eaton',
      'Harlow', 'Jansen', 'Kessler', 'Lombardi', 'Maddox', 'Nyberg', 'Oakes', 'Pollard', 'Ramsey', 'Sheehan',
      'Abernathy', 'Ackerman', 'Aldridge', 'Alvarez', 'Babcock', 'Bancroft', 'Barlow', 'Bauer', 'Beckman', 'Birch',
      'Blake', 'Bowers', 'Bradshaw', 'Brennan', 'Brewer', 'Buckley', 'Burke', 'Calloway', 'Carver', 'Chambers',
      'Chandler', 'Cline', 'Coleman', 'Conroy', 'Cortez', 'Crane', 'Cunningham', 'Dalton', 'Dawson', 'Delaney',
      'Dempsey', 'Dillon', 'Dorsey', 'Doherty', 'Dunn', 'Ellison', 'Emerson', 'Farrell', 'Fenwick', 'Finch',
      'Fitzpatrick', 'Fleming', 'Flynn', 'Fowler', 'Garrison', 'Gibbons', 'Gilmore', 'Gordon', 'Graves', 'Griffin',
      'Hale', 'Halverson', 'Hanlon', 'Hardy', 'Hartman', 'Haskins', 'Hawkins', 'Hendricks', 'Hogan', 'Holt',
      'Horton', 'Houston', 'Hudson', 'Ingram', 'Jennings', 'Kaminski', 'Kavanagh', 'Keane', 'Kinney', 'Kirby',
      'Kline', 'Lambert', 'Landon', 'Lawson', 'Lindgren', 'Lowell', 'Lynch', 'Mahoney', 'Malloy', 'Manning',
      'Marsh', 'McBride', 'McCarthy', 'McGrath', 'Mercer', 'Monroe', 'Moran', 'Mulligan', 'Nash', 'Nielsen',
      'Norris', 'Novotny', "O'Connell", 'Olsen', 'Osborne', 'Pearce', 'Pendleton', 'Pierce', 'Prescott', 'Quinn',
      'Radford', 'Randall', 'Reyes', 'Rhodes', 'Riordan', 'Rowland', 'Russo', 'Sawyer', 'Schaefer', 'Schmidt',
      'Shaw', 'Sherwood', 'Slater', 'Sloan', 'Spencer', 'Stafford', 'Stanton', 'Stokes', 'Strickland', 'Sweeney',
      'Talbot', 'Thornton', 'Tucker', 'Vance', 'Vaughn', 'Wagner', 'Walker', 'Warner', 'Watts', 'Weber',
      'Whitaker', 'Wilder', 'Winslow', 'Wolfe', 'Woodward', 'Wyatt', 'Zielinski',
    ],
  },
  {
    nationality: 'SWE',
    weight: 10,
    first: ['Erik', 'Lucas', 'Oskar', 'William', 'Elias', 'Filip', 'Rasmus', 'Viktor', 'Gustav', 'Nils', 'Jesper', 'Adrian', 'Linus', 'Hampus'],
    last: [
      'Lindqvist', 'Karlsson', 'Nilsson', 'Bergstrom', 'Sandin', 'Holmberg', 'Ekman', 'Sjoberg', 'Forsberg', 'Wallin',
      'Dahlin', 'Brannstrom', 'Lundgren', 'Hedman', 'Ostlund', 'Abrahamsson', 'Andersson', 'Axelsson', 'Bergqvist', 'Blomqvist',
      'Bjorklund', 'Borg', 'Carlsson', 'Dahlberg', 'Danielsson', 'Edlund', 'Ekberg', 'Eklund', 'Engstrom', 'Eriksson',
      'Fransson', 'Gustafsson', 'Hagberg', 'Hallberg', 'Hansson', 'Hellstrom', 'Holm', 'Isaksson', 'Jakobsson', 'Johansson',
      'Jonsson', 'Kjellberg', 'Larsson', 'Lindberg', 'Lindgren', 'Lindholm', 'Ljungberg', 'Lofgren', 'Lundberg', 'Lundqvist',
      'Magnusson', 'Mattsson', 'Nordin', 'Nordstrom', 'Norberg', 'Ohlsson', 'Olofsson', 'Persson', 'Pettersson', 'Rosen',
      'Sandberg', 'Sjogren', 'Soderberg', 'Stromberg', 'Sundqvist', 'Svensson', 'Wahlberg', 'Wikstrom',
    ],
  },
  {
    nationality: 'FIN',
    weight: 7,
    first: ['Mikko', 'Aleksander', 'Jesse', 'Kasperi', 'Sebastian', 'Joonas', 'Eeli', 'Otto', 'Aatu', 'Juuse', 'Teuvo', 'Valtteri'],
    last: [
      'Laine', 'Rantanen', 'Heiskanen', 'Aho', 'Korpisalo', 'Lehkonen', 'Makinen', 'Virtanen', 'Niemi', 'Salminen',
      'Kakko', 'Hintz', 'Puljujarvi', 'Aaltonen', 'Ahonen', 'Anttila', 'Hakala', 'Halonen', 'Hamalainen', 'Heikkinen',
      'Heinonen', 'Hiltunen', 'Honkanen', 'Huttunen', 'Jokinen', 'Juntunen', 'Kallio', 'Karjalainen', 'Keskinen', 'Kinnunen',
      'Kivela', 'Koivisto', 'Korhonen', 'Koskinen', 'Laaksonen', 'Lahtinen', 'Laitinen', 'Lampinen', 'Lehtonen', 'Leinonen',
      'Lindroos', 'Manninen', 'Mattila', 'Miettinen', 'Mustonen', 'Nieminen', 'Nurmi', 'Ojala', 'Peltonen', 'Pesonen',
      'Rasanen', 'Rautio', 'Ruotsalainen', 'Saarinen', 'Seppala', 'Siltanen', 'Suominen', 'Tikkanen', 'Toivonen', 'Turunen',
      'Vainio', 'Valimaki', 'Vesterinen',
    ],
  },
  {
    nationality: 'RUS',
    weight: 8,
    first: ['Nikita', 'Artemi', 'Kirill', 'Evgeni', 'Ilya', 'Andrei', 'Pavel', 'Dmitri', 'Vladislav', 'Maxim', 'Ivan', 'Semyon'],
    last: [
      'Kuznetsov', 'Volkov', 'Sorokin', 'Morozov', 'Orlov', 'Popov', 'Zaitsev', 'Fedorov', 'Belov', 'Kaprizov',
      'Romanov', 'Gusev', 'Sokolov', 'Abramov', 'Alekseev', 'Antonov', 'Baranov', 'Bogdanov', 'Bykov', 'Chernov',
      'Danilov', 'Dmitriev', 'Egorov', 'Frolov', 'Gavrilov', 'Golubev', 'Grigoriev', 'Ignatov', 'Ilyin', 'Kalinin',
      'Karpov', 'Kiselev', 'Klimov', 'Komarov', 'Kovalev', 'Kozlov', 'Krylov', 'Lebedev', 'Makarov', 'Maslov',
      'Medvedev', 'Mikhailov', 'Nikitin', 'Novikov', 'Osipov', 'Pavlov', 'Petrov', 'Polyakov', 'Rybakov', 'Semenov',
      'Sergeev', 'Smirnov', 'Solovyov', 'Stepanov', 'Tarasov', 'Tikhonov', 'Vasiliev', 'Vinogradov', 'Vlasov', 'Yakovlev',
      'Zakharov', 'Zhukov', 'Zuev',
    ],
  },
  {
    nationality: 'CZE',
    weight: 5,
    first: ['David', 'Tomas', 'Jakub', 'Ondrej', 'Martin', 'Lukas', 'Filip', 'Radek', 'Pavel', 'Dominik'],
    last: [
      'Pastrnak', 'Hertl', 'Novotny', 'Dvorak', 'Svoboda', 'Kubalik', 'Necas', 'Zacha', 'Hronek', 'Vrana',
      'Palat', 'Bartos', 'Benes', 'Blazek', 'Cerny', 'Dolezal', 'Dusek', 'Fiala', 'Hajek', 'Havel',
      'Horak', 'Hruby', 'Jelinek', 'Kadlec', 'Kolar', 'Kopecky', 'Kratochvil', 'Krejci', 'Kriz', 'Kucera',
      'Mares', 'Marek', 'Musil', 'Nemecek', 'Novak', 'Pokorny', 'Pospisil', 'Prochazka', 'Ruzicka', 'Sedlacek',
      'Simek', 'Soukup', 'Stastny', 'Urban', 'Vesely', 'Vlcek', 'Zeman',
    ],
  },
  {
    nationality: 'SVK',
    weight: 2,
    first: ['Juraj', 'Simon', 'Marian', 'Tomas', 'Martin', 'Erik'],
    last: [
      'Slafkovsky', 'Nemec', 'Tatar', 'Chara', 'Hossa', 'Cernak', 'Fehervary', 'Balaz', 'Baran', 'Bielik',
      'Chovanec', 'Dubovsky', 'Gajdos', 'Hudak', 'Jurcik', 'Kollar', 'Kovac', 'Kral', 'Lukac', 'Mihalik',
      'Oravec', 'Polak', 'Rusnak', 'Sabol', 'Simko', 'Tomasik', 'Urban', 'Vargha', 'Zelenak',
    ],
  },
  {
    nationality: 'GER',
    weight: 2,
    first: ['Leon', 'Tim', 'Moritz', 'Lukas', 'Nico', 'Dominik'],
    last: [
      'Draisaitl', 'Seider', 'Sturm', 'Stutzle', 'Kahun', 'Grubauer', 'Peterka', 'Albrecht', 'Bauer', 'Becker',
      'Brandt', 'Eberle', 'Fischer', 'Frank', 'Friedrich', 'Graf', 'Hahn', 'Hartmann', 'Hoffmann', 'Huber',
      'Jung', 'Keller', 'Kohler', 'Kraus', 'Krueger', 'Lang', 'Lehmann', 'Maier', 'Moser', 'Neumann',
      'Richter', 'Roth', 'Schafer', 'Schneider', 'Schreiber', 'Schulz', 'Vogt', 'Wagner', 'Weiss', 'Winkler',
      'Wolf', 'Ziegler',
    ],
  },
];

// Thousands more names (see nameParts.ts), and no famous hockey names.
for (const pool of NAME_POOLS) {
  const fix = (n: string) => n.replace(/-(\w)/g, (_, c: string) => `-${c.toUpperCase()}`);
  pool.first = [...new Set([...pool.first, ...(EXTRA_FIRST[pool.nationality] ?? [])])];
  pool.last = [...new Set([...pool.last, ...(EXTRA_LAST[pool.nationality] ?? []).map(fix)])].filter((n) => !FAMOUS.has(n));
}

/** Fictional franchises, grouped by conference and division. Rename freely. */
export interface FranchiseDef {
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  conference: string;
  division: string;
}

const F = (conference: string, division: string, rows: Array<[string, string, string, string, string]>): FranchiseDef[] =>
  rows.map(([city, name, abbr, c1, c2]) => ({ city, name, abbr, colors: [c1, c2], conference, division }));

export const FRANCHISES: FranchiseDef[] = [
  ...F('East', 'Maritime', [
    ['Halifax', 'Tidewater', 'HAL', '#0B3D91', '#E8B923'],
    ['Quebec', 'Harfangs', 'QUE', '#1B5EAB', '#D9E1E8'],
    ['Moncton', 'Wildcats', 'MON', '#C8102E', '#00205B'],
    ['Kingston', 'Frontenacs', 'KGN', '#1A1A1A', '#C8102E'],
    ['London', 'Knights', 'LDN', '#154734', '#B9975B'],
    ['Hamilton', 'Forge', 'HAM', '#2B2B2B', '#F2A900'],
    ['Rochester', 'Americans', 'ROC', '#C8102E', '#002868'],
    ['Thunder Bay', 'Thunder', 'TBY', '#FFB81C', '#041E42'],
  ]),
  ...F('East', 'Atlantic', [
    ['Hartford', 'Harpoons', 'HFD', '#006A4E', '#0A2240'],
    ['Hershey', 'Chocolatiers', 'HER', '#4B2E1E', '#C9A66B'],
    ['Cleveland', 'Barons', 'CLE', '#311D00', '#FF3C00'],
    ['Baltimore', 'Clippers', 'BAL', '#241773', '#9E7C0C'],
    ['Atlanta', 'Firebirds', 'ATL', '#C8102E', '#1A1A1A'],
    ['Cincinnati', 'Stingers', 'CIN', '#FFD100', '#1A1A1A'],
    ['Birmingham', 'Bulls', 'BHM', '#8A1538', '#F1BE48'],
    ['Providence', 'Reds', 'PRV', '#BA0C2F', '#5B6770'],
  ]),
  ...F('West', 'Prairie', [
    ['Portland', 'Lumberjacks', 'POR', '#2E5E2A', '#C8102E'],
    ['Saskatoon', 'Blades', 'SAS', '#004225', '#FFC72C'],
    ['Victoria', 'Cougars', 'VIC', '#00205B', '#A2AAAD'],
    ['Regina', 'Pats', 'REG', '#C8102E', '#003087'],
    ['Spokane', 'Chiefs', 'SPO', '#E31837', '#002B5C'],
    ['Kamloops', 'Blazers', 'KAM', '#F47A38', '#003087'],
    ['Milwaukee', 'Admirals', 'MIL', '#12284B', '#FFC52F'],
    ['Omaha', 'Lancers', 'OMA', '#003B71', '#E03A3E'],
  ]),
  ...F('West', 'Frontier', [
    ['Kansas City', 'Scouts', 'KC', '#004687', '#BD9B60'],
    ['Houston', 'Aeros', 'HOU', '#002D62', '#EB6E1F'],
    ['San Diego', 'Gulls', 'SD', '#002F6C', '#C4CED4'],
    ['Oklahoma City', 'Stampede', 'OKC', '#007AC1', '#EF3B24'],
    ['Albuquerque', 'Roadrunners', 'ABQ', '#8C2633', '#E9A13B'],
    ['Sacramento', 'Monarchs', 'SAC', '#5A2D81', '#63727A'],
    ['Austin', 'Outlaws', 'AUS', '#BF5700', '#333F48'],
    ['Memphis', 'Riverkings', 'MEM', '#5D76A9', '#12173F'],
  ]),
];
