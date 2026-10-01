/** Every franchise's logo, division by division, at large and small sizes. */
import { Link } from 'react-router-dom';
import { TeamLogo } from '../components/TeamLogo';

const DIVISIONS: Array<[string, Array<[string, string, string, string, string]>]> = [
  ['Maritime', [
    ['Halifax', 'Tidewater', 'HAL', '#0B3D91', '#E8B923'],
    ['Quebec', 'Harfangs', 'QUE', '#1B5EAB', '#D9E1E8'],
    ['Moncton', 'Wildcats', 'MON', '#C8102E', '#00205B'],
    ['Kingston', 'Frontenacs', 'KGN', '#1A1A1A', '#C8102E'],
    ['London', 'Knights', 'LDN', '#154734', '#B9975B'],
    ['Hamilton', 'Forge', 'HAM', '#2B2B2B', '#F2A900'],
    ['Rochester', 'Americans', 'ROC', '#C8102E', '#002868'],
    ['Thunder Bay', 'Thunder', 'TBY', '#FFB81C', '#041E42'],
  ]],
  ['Atlantic', [
    ['Hartford', 'Harpoons', 'HFD', '#006A4E', '#0A2240'],
    ['Hershey', 'Chocolatiers', 'HER', '#4B2E1E', '#C9A66B'],
    ['Cleveland', 'Barons', 'CLE', '#311D00', '#FF3C00'],
    ['Baltimore', 'Clippers', 'BAL', '#241773', '#9E7C0C'],
    ['Atlanta', 'Firebirds', 'ATL', '#C8102E', '#1A1A1A'],
    ['Cincinnati', 'Stingers', 'CIN', '#FFD100', '#1A1A1A'],
    ['Birmingham', 'Bulls', 'BHM', '#8A1538', '#F1BE48'],
    ['Providence', 'Reds', 'PRV', '#BA0C2F', '#5B6770'],
  ]],
  ['Prairie', [
    ['Portland', 'Lumberjacks', 'POR', '#2E5E2A', '#C8102E'],
    ['Saskatoon', 'Blades', 'SAS', '#004225', '#FFC72C'],
    ['Victoria', 'Cougars', 'VIC', '#00205B', '#A2AAAD'],
    ['Regina', 'Pats', 'REG', '#C8102E', '#003087'],
    ['Spokane', 'Chiefs', 'SPO', '#E31837', '#002B5C'],
    ['Kamloops', 'Blazers', 'KAM', '#F47A38', '#003087'],
    ['Milwaukee', 'Admirals', 'MIL', '#12284B', '#FFC52F'],
    ['Omaha', 'Lancers', 'OMA', '#003B71', '#E03A3E'],
  ]],
  ['Frontier', [
    ['Kansas City', 'Scouts', 'KC', '#004687', '#BD9B60'],
    ['Houston', 'Aeros', 'HOU', '#002D62', '#EB6E1F'],
    ['San Diego', 'Gulls', 'SD', '#002F6C', '#C4CED4'],
    ['Oklahoma City', 'Stampede', 'OKC', '#007AC1', '#EF3B24'],
    ['Albuquerque', 'Roadrunners', 'ABQ', '#8C2633', '#E9A13B'],
    ['Sacramento', 'Monarchs', 'SAC', '#5A2D81', '#63727A'],
    ['Austin', 'Outlaws', 'AUS', '#BF5700', '#333F48'],
    ['Memphis', 'Riverkings', 'MEM', '#5D76A9', '#12173F'],
  ]],
];

export function LogoGalleryPage() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-8 p-6">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-wide text-white uppercase">The league's logos</h1>
        <Link to="/" className="text-sm text-ice-400 hover:text-white">
          ← Back
        </Link>
      </div>
      {DIVISIONS.map(([div, teams]) => (
        <section key={div}>
          <h2 className="mb-3 font-display text-lg tracking-wider text-ice-300 uppercase">{div} division</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
            {teams.map(([city, name, abbr, c1, c2]) => {
              const team = { city, name, abbr, colors: [c1, c2] };
              return (
                <div key={abbr} className="flex flex-col items-center gap-2 rounded-xl border border-rink-700 bg-rink-900 p-3">
                  <TeamLogo team={team} size={150} />
                  <div className="flex items-center gap-3 rounded-lg bg-[#f4f6f9] px-2 py-1">
                    <TeamLogo team={team} size={56} />
                    <TeamLogo team={team} size={28} />
                    <TeamLogo team={team} size={20} />
                  </div>
                  <div className="flex items-center gap-3">
                    <TeamLogo team={team} size={56} />
                    <TeamLogo team={team} size={28} />
                    <TeamLogo team={team} size={20} />
                  </div>
                  <p className="text-center text-xs text-ice-300">
                    {city} {name}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
