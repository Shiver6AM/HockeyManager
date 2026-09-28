/** Name pools for generated players, grouped by nationality. */

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
    ],
  },
  {
    nationality: 'SWE',
    weight: 10,
    first: ['Erik', 'Lucas', 'Oskar', 'William', 'Elias', 'Filip', 'Rasmus', 'Viktor', 'Gustav', 'Nils', 'Jesper', 'Adrian', 'Linus', 'Hampus'],
    last: ['Lindqvist', 'Karlsson', 'Nilsson', 'Bergstrom', 'Sandin', 'Holmberg', 'Ekman', 'Sjoberg', 'Forsberg', 'Wallin', 'Dahlin', 'Brannstrom', 'Lundgren', 'Hedman', 'Ostlund'],
  },
  {
    nationality: 'FIN',
    weight: 7,
    first: ['Mikko', 'Aleksander', 'Jesse', 'Kasperi', 'Sebastian', 'Joonas', 'Eeli', 'Otto', 'Aatu', 'Juuse', 'Teuvo', 'Valtteri'],
    last: ['Laine', 'Rantanen', 'Heiskanen', 'Aho', 'Korpisalo', 'Lehkonen', 'Makinen', 'Virtanen', 'Niemi', 'Salminen', 'Kakko', 'Hintz', 'Puljujarvi'],
  },
  {
    nationality: 'RUS',
    weight: 8,
    first: ['Nikita', 'Artemi', 'Kirill', 'Evgeni', 'Ilya', 'Andrei', 'Pavel', 'Dmitri', 'Vladislav', 'Maxim', 'Ivan', 'Semyon'],
    last: ['Kuznetsov', 'Volkov', 'Sorokin', 'Morozov', 'Orlov', 'Popov', 'Zaitsev', 'Fedorov', 'Belov', 'Kaprizov', 'Romanov', 'Gusev', 'Sokolov'],
  },
  {
    nationality: 'CZE',
    weight: 5,
    first: ['David', 'Tomas', 'Jakub', 'Ondrej', 'Martin', 'Lukas', 'Filip', 'Radek', 'Pavel', 'Dominik'],
    last: ['Pastrnak', 'Hertl', 'Novotny', 'Dvorak', 'Svoboda', 'Kubalik', 'Necas', 'Zacha', 'Hronek', 'Vrana', 'Palat'],
  },
  {
    nationality: 'SVK',
    weight: 2,
    first: ['Juraj', 'Simon', 'Marian', 'Tomas', 'Martin', 'Erik'],
    last: ['Slafkovsky', 'Nemec', 'Tatar', 'Chara', 'Hossa', 'Cernak', 'Fehervary'],
  },
  {
    nationality: 'GER',
    weight: 2,
    first: ['Leon', 'Tim', 'Moritz', 'Lukas', 'Nico', 'Dominik'],
    last: ['Draisaitl', 'Seider', 'Sturm', 'Stutzle', 'Kahun', 'Grubauer', 'Peterka'],
  },
];

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
