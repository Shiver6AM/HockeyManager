/**
 * Thousands more names: extra first names per nationality, and surnames built
 * from each language's own building blocks (English place/trade names,
 * French-Canadian compounds, Swedish nature compounds, Finnish -nen/-la names,
 * Russian -ov/-in names, Czech and Slovak diminutives, German compounds).
 * Well-known hockey names are filtered out, so generated players don't
 * borrow real stars' identities.
 */

const cross = (a: string[], b: string[], join: (x: string, y: string) => string = (x, y) => x + y) => a.flatMap((x) => b.map((y) => join(x, y)));

/** Surnames the game won't use: famous past and present NHL players and coaches. */
export const FAMOUS = new Set(
  (
    'Gretzky Lemieux Crosby Ovechkin McDavid Orr Howe Hull Messier Yzerman Sakic Lecavalier Brodeur Bergeron Marchand Duchene Giroux Fleury Sutter Roy ' +
    'Bourque Quenneville Hughes Tkachuk Kaprizov Pastrnak Hertl Necas Zacha Hronek Vrana Palat Kubalik Slafkovsky Nemec Tatar Chara Hossa Cernak ' +
    'Fehervary Draisaitl Seider Sturm Stutzle Kahun Grubauer Peterka Laine Rantanen Heiskanen Aho Korpisalo Lehkonen Kakko Hintz Puljujarvi Forsberg ' +
    'Hedman Dahlin Lundqvist Sandin Karlsson Kucherov Sorokin Kuznetsov Kovalev Fedorov Mikhailov Tikhonov Tarasov Stastny Krejci Jagr Hasek Selanne ' +
    'Kurri Lidstrom Sundin Zetterberg Backstrom Nylander Pettersson Gaudreau Kane Toews Keith Doughty Price Subban Stamkos Hedberg Ekman-Larsson ' +
    'Makar Matthews Marner Tavares Rielly Point Cirelli Vasilevskiy Barkov Ekblad Reinhart Eichel Pietrangelo Stone Marchessault Kopitar Drouin ' +
    'Gallagher Suzuki Caufield Slavin Aho Svechnikov Andersen Kessel Malkin Letang Guentzel Panarin Zibanejad Kreider Shesterkin Fox Trouba ' +
    'Pettersson Hughes Demko Boeser Horvat Miller Nurse Hyman Bouchard Kadri Huberdeau Lindholm Tanev Burns Couture Hertl Meier Nichushkin Landeskog ' +
    'MacKinnon Rantanen Byram Josi Forsberg Saros Kaprizov Zuccarello Spurgeon Boldy Thomas Kyrou Binnington Parayko Scheifele Connor Hellebuyck ' +
    'Morrissey Ehlers Robertson Hintz Oettinger Heiskanen Benn Seguin Dubois Kopitar Doughty Keller Schmaltz Bedard Raddysh Dach Nylander Tkachuk ' +
    'Chabot Batherson Stutzle Giroux Werenski Laine Marchenko Eberle Kessler Couturier Konecny Sanheim Tippett Hart Thompson Dahlin Power Cozens ' +
    'Ullmark Swayman Pastrnak McAvoy Larkin Raymond Seider DeBrincat Samuelsson Vatrano Zegras Gauthier Terry Mittelstadt Bratt Hischier Nemec'
  ).split(' '),
);

const EN_PRE = [
  'Ash', 'Alder', 'Bar', 'Black', 'Brad', 'Bram', 'Brent', 'Brook', 'Brom', 'Burn', 'Cal', 'Carl', 'Clay', 'Clif', 'Cold', 'Cole', 'Crans', 'Crom',
  'Dal', 'Dun', 'East', 'Elm', 'Ever', 'Fair', 'Farn', 'Fen', 'Frank', 'Glen', 'Gold', 'Grant', 'Green', 'Ham', 'Hal', 'Hart', 'Haw', 'Hazel',
  'Heath', 'Hol', 'Hunt', 'Kings', 'Kirk', 'Lang', 'Lin', 'Lock', 'Marl', 'Mid', 'Mill', 'Moor', 'Nor', 'North', 'Oak', 'Pem', 'Pen', 'Ram',
  'Red', 'Ridge', 'Rock', 'Rose', 'Rush', 'Sal', 'Shel', 'South', 'Stan', 'Stock', 'Stone', 'Sum', 'Thorn', 'Wal', 'Ware', 'Well', 'West', 'White',
  'Wil', 'Win', 'Wood', 'Wor', 'Yar',
];
const EN_SUF = ['ford', 'ley', 'ton', 'well', 'wood', 'field', 'worth', 'by', 'more', 'dale', 'wick', 'ham', 'shaw', 'brook', 'land', 'ridge', 'stead', 'combe', 'den', 'hurst', 'cott', 'bury', 'wyn', 'mont'];

/** Trade, patronymic and Irish/Scottish surnames used in Canada and the US. */
const EN_WORDS = (
  'Abbey Acres Adair Ainsley Alcott Allison Ames Appleby Archer Arden Arnott Atwater Avery Bagley Bain Baird Baldwin Ballard Banks Barber Barnes Barnett ' +
  'Barton Baxter Beasley Beckford Bell Benson Bentley Berry Bingham Blair Blaine Bledsoe Bloom Bolton Booker Boone Bowden Bowman Boyd Bradford Bray Brewster ' +
  'Briggs Brinkley Bristol Brody Bromley Brown Bryce Buckner Bullock Burgess Burnett Burton Bush Butler Byrne Cahill Cain Callaway Calder Cannon Carey Carmody ' +
  'Carr Carroll Carson Carter Case Casey Cassidy Chalmers Chapman Chase Cheney Church Clancy Clark Clement Cobb Coburn Cochrane Cody Coffey Collier Collins ' +
  'Colson Conley Connolly Conrad Conway Cooke Corbett Corcoran Costello Cotter Coughlin Cowan Cox Craig Crawford Creighton Crosbie Crowley Cullen Cummings ' +
  'Curran Curtis Dade Dailey Dane Darby Darcy Davenport Davis Deacon Dean Decker Dermott Devlin Dickson Dix Dobson Dodd Donahue Donnelly Dooley Dougherty ' +
  'Dowd Downey Doyle Drake Draper Driscoll Duggan Duncan Dunlop Durant Dwyer Dyer Easton Eckert Edgar Egan Elder Ellery Ellis Emery Ennis Ervin Eustace ' +
  'Evans Everett Ewing Fagan Falk Fallon Fanning Farley Faulkner Fenton Field Finley Finnegan Fisher Fitch Flanagan Fletcher Ford Forrest Foster Fox Frost ' +
  'Fuller Gaffney Galloway Gamble Gannon Gardner Garland Garvey Gates Geary Gentry Gibson Gilbert Gill Glover Goff Golden Goodwin Gorman Grady Graham Granger ' +
  'Gray Greer Grimes Grove Guthrie Hackett Hadden Haggerty Hall Halloran Hamlin Hammond Hancock Hanley Hanna Harding Harmon Harper Harrington Hatch Hayden ' +
  'Healy Heath Hennessy Henson Herrick Hewitt Hickey Higgins Hill Hines Hobbs Hodge Hogarth Holden Holland Hollis Hooper Hopkins Horne Howard Howell Hoyt ' +
  'Hubbard Huff Hughson Hurley Hutchins Hyde Irwin Jarvis Jeffries Jenkins Jewell Joyce Judd Kane Keefe Keegan Kelleher Kelley Kemp Kendall Kenney Kent ' +
  'Kerrigan Kilbride Kimball Kinsella Kirkland Knapp Knight Knox Lacey Laird Lane Langley Larkin Latham Lawless Leary Leland Lennon Lester Lewis Lindsay ' +
  'Lister Little Logan Long Lord Lowe Lowry Lucas Lyle Lyons Mack Madden Magee Maguire Maher Mallory Malone Marlowe Marshall Martin Mason Masters Mathers ' +
  'Maxwell Mayo McAlpine McArthur McCabe McCall McClure McCoy McCrae McDermott McDonough McEwen McGee McGowan McGuire McHugh McKay McKee McKenna McLaren ' +
  'McMahon McManus McMillan McNally McNamara McQueen Meade Merritt Metcalf Middleton Miles Milner Mitchell Moffat Molloy Monaghan Mooney Moore Morgan ' +
  'Morley Morrow Morton Mosley Moss Mullen Murphy Myers Nagle Neal Nelson Newell Newman Nixon Noble Nolan Norton Nugent Oakley Ogden Oliver Orton ' +
  'Owens Padgett Page Palmer Parker Parrish Parsons Patton Paxton Payne Peck Penn Perry Phelan Phillips Piper Platt Plummer Pope Potter Powell Pratt ' +
  'Preston Price Pryor Purcell Quayle Quimby Rafferty Rankin Rawlings Ray Rayburn Read Redmond Reese Regan Rennie Reynolds Rice Riggs Riley Ripley Roach ' +
  'Roche Rogers Rooney Ross Rourke Rowe Rudd Rutherford Ryan Salter Sanders Savage Sayers Scanlon Scott Seaton Sexton Seymour Shannon Sharp Shea Shelby ' +
  'Shepherd Sherman Shields Short Sidwell Sims Skinner Slattery Small Snow Somers Sparks Stack Stark Steele Sterling Stevens Stone Stroud Styles Summers ' +
  'Sutton Swift Tanner Tate Taylor Temple Terry Thatcher Tierney Tobin Todd Toomey Townsend Tracy Travers Truman Tully Turner Tyler Underwood Upton Vail ' +
  'Vernon Wade Walden Wallis Walton Ward Waters Watson Weaver Webb Welch Weller Wheeler Whelan Whitney Wiley Wilkes Willard Willis Wilson Winter Wise ' +
  'Woods Wray Wren Wright Wylie Young'
).split(' ');

const FR_PRE = ['Beau', 'Bel', 'Bon', 'Char', 'Dela', 'Des', 'Du', 'Fon', 'La', 'Le', 'Mar', 'Mont', 'Val', 'Bois', 'Clair', 'Roche', 'Saint-'];
const FR_SUF = ['champ', 'court', 'lieu', 'mont', 'pre', 'rive', 'lande', 'fort', 'marais', 'ville', 'croix', 'fontaine', 'bois', 'val', 'pierre', 'jean'];
const FR_WORDS = (
  'Allaire Amyot Asselin Aubin Aubry Audet Auger Babin Bachand Barbeau Barrette Baril Beauchemin Beaudry Bedard Beland Bellefeuille Benoit Berard Bernier ' +
  'Berube Besner Bilodeau Bisson Blais Blouin Boily Boisclair Boivin Bolduc Bonneau Bordeleau Bouffard Bouliane Bourassa Bourbonnais Bourdon Bourget Brisson ' +
  'Brochu Brodeur Brousseau Bruneau Cadorette Caouette Carignan Carrier Casavant Cayer Chalifoux Champagne Chapdelaine Charron Chenard Chevalier Choquette ' +
  'Corbeil Cote Couture Croteau Cusson Daoust Dauphinais Deblois Delisle Demers Denis Desautels Deslauriers Desrosiers Dion Dostie Drouin Dube Dufour ' +
  'Dugas Dumont Duplessis Dupuis Durand Emond Fafard Faucher Ferland Filion Fortier Frechette Frenette Gagne Gamache Garon Gaudreault Gelinas Gervais ' +
  'Gignac Girard Gosselin Goyette Gravel Grenier Guerin Guillemette Hamel Harvey Houle Huard Jacques Jobin Joly Labbe Labrecque Lacasse Lachapelle ' +
  'Lacombe Laflamme Lafond Lafrance Laliberte Lamarche Lambert Lamontagne Landreville Langevin Lanoue Lapointe Laporte Larose Latour Laurin Lauzon Lavoie ' +
  'Leclerc Lefebvre Legault Lemay Lepage Lesage Letourneau Lorrain Loiselle Major Maltais Mathieu Menard Messier Methot Mongeau Moreau Nadon Normandin ' +
  'Ouellette Page Paiement Paquin Paradis Pare Payeur Pelchat Pepin Perreault Pichette Plante Plourde Poulin Prevost Quintal Rheaume Richard Rivard ' +
  'Robert Rochon Rodrigue Rouleau Roussel Sabourin Samson Savard Simard Soucy Talbot Tanguay Tardif Tessier Theriault Thibault Trudel Turcotte Vaillancourt ' +
  'Veilleux Verreault Vezina Villeneuve'
).split(' ');

const SWE_ROOT = ['Berg', 'Lind', 'Ek', 'Holm', 'Sjo', 'Strom', 'Dahl', 'Lund', 'Nord', 'Sand', 'Fors', 'Hag', 'Bjork', 'Al', 'Ask', 'Gran', 'Ros', 'Soder', 'Wall', 'Eng', 'Fal', 'Hed', 'Lov', 'Mal', 'Ny', 'Ohl', 'Ram', 'Sten', 'Tor', 'Vall', 'Ceder', 'Lilje', 'Blom', 'Eken', 'Elf'];
const SWE_SUF = ['berg', 'gren', 'strom', 'qvist', 'lund', 'dahl', 'holm', 'man', 'borg', 'stedt', 'blad', 'feldt', 'sten', 'ling', 'by', 'vall', 'ros', 'mark'];
const SWE_PATRON = ['Anders', 'Bengt', 'Bo', 'Einar', 'Gunnar', 'Hakan', 'Ivar', 'Jens', 'Karl', 'Lars', 'Leif', 'Mats', 'Mikael', 'Nils', 'Ola', 'Per', 'Rune', 'Sten', 'Sven', 'Ulf', 'Arvid', 'Torsten', 'Mauritz', 'Edvin'];

const FIN_ROOT = [
  'Aalto', 'Haka', 'Heikki', 'Kalli', 'Karja', 'Kosk', 'Lahti', 'Lehti', 'Leino', 'Maki', 'Nieme', 'Nurmi', 'Oja', 'Rinne', 'Salo', 'Toivo', 'Virta',
  'Valko', 'Hirvo', 'Kivi', 'Lampi', 'Metsa', 'Jarvi', 'Harju', 'Pelto', 'Rauta', 'Suo', 'Tamm', 'Vuori', 'Haapa', 'Kuusi', 'Paju', 'Pihla', 'Saari', 'Kari', 'Honka', 'Ranta',
];
const FIN_SUF = ['nen', 'la', 'lainen', 'maki', 'niemi', 'koski', 'salo', 'aho', 'oja', 'vaara', 'lahti', 'mo', 'rinne', 'harju'];

const RUS_ROOT = [
  'Bel', 'Bogdan', 'Vasil', 'Gavril', 'Grom', 'Zait', 'Kozl', 'Kuzmin', 'Lebed', 'Nikit', 'Orl', 'Pavl', 'Petr', 'Rom', 'Sidor', 'Tit', 'Ulyan', 'Fil',
  'Chern', 'Shub', 'Yegor', 'Anis', 'Borisov', 'Vorob', 'Glad', 'Dem', 'Zhar', 'Isa', 'Kalash', 'Loban', 'Mart', 'Naum', 'Prokh', 'Ryab', 'Sav', 'Tolst',
  'Ust', 'Fom', 'Khar', 'Shch', 'Yurl', 'Ark', 'Bur', 'Gorb', 'Dud', 'Yefim', 'Zim', 'Kor', 'Log', 'Mel', 'Nes', 'Ost', 'Rakh', 'Sukh', 'Trof', 'Shar', 'Yak',
];
const RUS_SUF = ['ov', 'ev', 'in', 'enko', 'akov', 'ichev', 'ushkin', 'anov'];

const CZE_ROOT = ['Nov', 'Svob', 'Dvor', 'Cern', 'Proch', 'Kuch', 'Vesel', 'Hor', 'Pos', 'Kral', 'Ben', 'Jel', 'Pokor', 'Haj', 'Kop', 'Mach', 'Rys', 'Sin', 'Tich', 'Vav', 'Zav', 'Brez', 'Hol', 'Krej', 'Lis', 'Mal', 'Nem', 'Pav', 'Sed', 'Stan', 'Vlas', 'Zel', 'Hav', 'Kov', 'Mik', 'Pet', 'Rad', 'Sim', 'Tom', 'Vit'];
const CZE_SUF = ['ak', 'acek', 'ek', 'ik', 'ka', 'ny', 'ovsky', 'icka', 'as', 'ec', 'al', 'ar'];

const SVK_ROOT = ['Bal', 'Bart', 'Ciz', 'Dan', 'Duch', 'Fed', 'Gaj', 'Hric', 'Jan', 'Kolar', 'Lach', 'Mat', 'Ondr', 'Pal', 'Rus', 'Sab', 'Straka', 'Tok', 'Urb', 'Zub'];
const SVK_SUF = ['ak', 'ik', 'ovic', 'ko', 'ar', 'uch', 'ovsky', 'ina'];

const GER_ROOT = ['Bach', 'Berg', 'Brand', 'Busch', 'Eich', 'Feld', 'Fisch', 'Gross', 'Hahn', 'Hart', 'Hof', 'Horn', 'Kalt', 'Klein', 'Koch', 'Lang', 'Linden', 'Neu', 'Ober', 'Rein', 'Rosen', 'Schwarz', 'Stein', 'Wald', 'Weiss', 'Winter', 'Ehren', 'Falken', 'Grun', 'Kirch', 'Mittel', 'Sommer', 'Tann'];
const GER_SUF = ['mann', 'er', 'berg', 'hardt', 'hofer', 'meier', 'burger', 'bach', 'feld', 'ner', 'ling', 'stein', 'huber', 'wald'];

/** More first names per nationality. */
export const EXTRA_FIRST: Record<string, string[]> = {
  CAN: (
    'Aiden Alex Andrew Anthony Ben Blake Brody Caleb Cameron Chase Christian Cody Colin Curtis Daniel Darren Derek Dominic Donovan Dustin Easton Eli Emmett ' +
    'Eric Ethan Felix Finn Gavin Graham Grant Greg Hayden Isaac Jackson Jared Jeremy Jesse Joel Josh Julien Kaden Keegan Kellan Kieran Landon Laurent Lucas ' +
    'Marc Marcus Max Maxime Micah Nicolas Noah Parker Patrick Pierre Quinton Raphael Reid Rhys Robbie Rowan Scott Simon Spencer Stephane Taylor Theo Thomas ' +
    'Tristan Vincent Wesley Xavier Yanick Zane'
  ).split(' '),
  USA: (
    'Aaron Adam Alec Andy Ben Billy Blake Brendan Brian Caleb Cole Colin Connor Dan Dane Danny Dawson Derek Dylan Eddie Eli Eric Ethan Evan Frank Garrett ' +
    'Grant Griffin Hank Hudson Hunter Ian Jake Jared Jeff Joe John Jordan Josh Kyle Landon Leo Liam Logan Mason Max Nate Nolan Owen Parker Pete Reed Rich ' +
    'Riley Ryan Scott Shane Skyler Steve Ted Tom Tony Travis Troy Tyler Vinny Wade Walker Wes Zach'
  ).split(' '),
  SWE: 'Albin Alfred Anton Arvid Axel David Edvin Emil Fabian Felix Hugo Isak Jacob Jonathan Kevin Leo Ludvig Marcus Melker Noel Olle Pontus Samuel Simon Theo Vincent Wilmer Otto Loke Hannes'.split(' '),
  FIN: 'Aapo Antti Arttu Eemeli Eetu Elmeri Henri Ilari Jere Joel Joni Juho Julius Kalle Lauri Leevi Markus Miro Niko Oskari Patrik Roope Santeri Tuomas Veeti Ville Onni Waltteri Jami'.split(' '),
  RUS: 'Alexei Anton Arseni Artur Bogdan Daniil Denis Egor Fyodor Gleb Grigori Igor Konstantin Leonid Matvei Mikhail Nikolai Oleg Roman Ruslan Sergei Stepan Timofei Vadim Viktor Yaroslav Yegor Zakhar'.split(' '),
  CZE: 'Adam Ales Daniel Jan Jiri Josef Karel Libor Matej Michal Miroslav Petr Roman Stepan Tadeas Vaclav Vit Vojtech Zdenek'.split(' '),
  SVK: 'Adam Branislav Dominik Jakub Jan Lukas Matus Michal Milan Patrik Peter Richard Samuel Stefan Viliam'.split(' '),
  GER: 'Alexander Ben Daniel Elias Felix Finn Florian Jan Jonas Julian Kai Lars Luca Maximilian Niklas Noah Paul Philipp Sebastian Tobias'.split(' '),
};

export const EXTRA_LAST: Record<string, string[]> = {
  CAN: [...EN_WORDS, ...cross(EN_PRE, EN_SUF), ...FR_WORDS, ...cross(FR_PRE, FR_SUF)],
  USA: [...EN_WORDS, ...cross(EN_PRE, EN_SUF)],
  SWE: [...cross(SWE_ROOT, SWE_SUF).filter((n) => !/(.)\1\1/.test(n)), ...SWE_PATRON.map((n) => `${n}${n.endsWith('s') ? 'son' : 'sson'}`)],
  FIN: cross(FIN_ROOT, FIN_SUF).filter((n) => n.length <= 12),
  RUS: cross(RUS_ROOT, RUS_SUF).filter((n) => !/ovov|evov|inov|ovin/.test(n)),
  CZE: cross(CZE_ROOT, CZE_SUF),
  SVK: cross(SVK_ROOT, SVK_SUF),
  GER: cross(GER_ROOT, GER_SUF).filter((n) => !/(.)\1\1/.test(n)),
};
