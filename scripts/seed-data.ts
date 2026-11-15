/** Sample content for `pnpm seed`. Fixed ids keep the seed idempotent. */
import type { NewLocation, NewPlaylist } from '../src/lib/server/db/schema.ts';

type SeedLocation = NewLocation & { id: string };
type SeedPlaylist = NewPlaylist & { id: string; locationIds: string[] };

const L = (n: number) => `c0ffee00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number) => `c0ffee00-0000-4000-9000-${String(n).padStart(12, '0')}`;

export const LOCATIONS: SeedLocation[] = [
	{
		id: L(1),
		nameSv: 'Eiffeltornet',
		nameEn: 'Eiffel Tower',
		clueTextSv: 'Ett järngaller som skulle rivas efter 20 år står fortfarande kvar vid floden.',
		clueTextEn: 'An iron lattice meant to be torn down after 20 years still stands by the river.',
		factSv: 'Tornet byggdes till världsutställningen 1889 och var världens högsta byggnad i 41 år.',
		factEn: 'Built for the 1889 World’s Fair, it was the tallest structure in the world for 41 years.',
		lat: 48.85826,
		lng: 2.2945
	},
	{
		id: L(2),
		nameSv: 'Frihetsgudinnan',
		nameEn: 'Statue of Liberty',
		clueTextSv: 'En gåva i koppar som blivit grön hälsar fartyg välkomna med en fackla.',
		clueTextEn: 'A copper gift, long since turned green, greets ships with a torch.',
		factSv: 'Statyn var en gåva från Frankrike och invigdes 1886. Stommen konstruerades av Gustave Eiffel.',
		factEn: 'A gift from France dedicated in 1886; its internal frame was engineered by Gustave Eiffel.',
		lat: 40.68925,
		lng: -74.0445
	},
	{
		id: L(3),
		nameSv: 'Operahuset i Sydney',
		nameEn: 'Sydney Opera House',
		clueTextSv: 'Vita skal som segel vid en hamn på södra halvklotet.',
		clueTextEn: 'White shells like sails on a harbour in the southern hemisphere.',
		factSv: 'Ritat av dansken Jørn Utzon och invigt 1973. Taket är täckt av över en miljon kakelplattor.',
		factEn: 'Designed by Dane Jørn Utzon and opened in 1973; its roof is covered by over a million tiles.',
		lat: -33.85678,
		lng: 151.2153
	},
	{
		id: L(4),
		nameSv: 'Cheopspyramiden',
		nameEn: 'Great Pyramid of Giza',
		clueTextSv: 'Det enda av antikens sju underverk som fortfarande står.',
		clueTextEn: 'The only one of the Seven Wonders of the Ancient World still standing.',
		factSv: 'Pyramiden byggdes för cirka 4 500 år sedan och var världens högsta byggnad i nästan 4 000 år.',
		factEn: 'Built about 4,500 years ago, it was the tallest human-made structure for nearly 4,000 years.',
		lat: 29.97923,
		lng: 31.1342
	},
	{
		id: L(5),
		nameSv: 'Machu Picchu',
		nameEn: 'Machu Picchu',
		clueTextSv: 'En stad av sten på en bergsrygg, återupptäckt för omvärlden 1911.',
		clueTextEn: 'A city of stone on a mountain ridge, brought to world attention in 1911.',
		factSv: 'Inkastaden byggdes på 1400-talet cirka 2 430 meter över havet.',
		factEn: 'The Inca citadel was built in the 15th century about 2,430 metres above sea level.',
		lat: -13.16306,
		lng: -72.545
	},
	{
		id: L(6),
		nameSv: 'Taj Mahal',
		nameEn: 'Taj Mahal',
		clueTextSv: 'Ett mausoleum i vit marmor, byggt av en sörjande kejsare.',
		clueTextEn: 'A white marble mausoleum built by a grieving emperor.',
		factSv: 'Stormogulen Shah Jahan lät bygga det till minne av sin hustru Mumtaz Mahal på 1600-talet.',
		factEn: 'Mughal emperor Shah Jahan commissioned it in the 17th century in memory of his wife Mumtaz Mahal.',
		lat: 27.175,
		lng: 78.04194
	},
	{
		id: L(7),
		nameSv: 'Kristusstatyn i Rio de Janeiro',
		nameEn: 'Christ the Redeemer',
		clueTextSv: 'Med utsträckta armar vakar en staty över en stad från ett berg.',
		clueTextEn: 'With outstretched arms, a statue watches over a city from a mountaintop.',
		factSv: 'Statyn på berget Corcovado är 30 meter hög och invigdes 1931.',
		factEn: 'The statue on Corcovado mountain is 30 metres tall and was completed in 1931.',
		lat: -22.95194,
		lng: -43.21056
	},
	{
		id: L(8),
		nameSv: 'Fuji',
		nameEn: 'Mount Fuji',
		clueTextSv: 'En nästan perfekt snöklädd kon, motiv för otaliga träsnitt.',
		clueTextEn: 'An almost perfect snow-capped cone, the subject of countless woodblock prints.',
		factSv: 'Den aktiva vulkanen är 3 776 meter hög och har senast fått utbrott 1707.',
		factEn: 'The active volcano rises 3,776 metres and last erupted in 1707.',
		lat: 35.36056,
		lng: 138.7275
	},
	{
		id: L(9),
		nameSv: 'Colosseum',
		nameEn: 'Colosseum',
		clueTextSv: 'En arena där gladiatorer en gång kämpade inför 50 000 åskådare.',
		clueTextEn: 'An arena where gladiators once fought in front of 50,000 spectators.',
		factSv: 'Amfiteatern invigdes år 80 e.Kr. och är den största som någonsin byggts.',
		factEn: 'Opened in 80 AD, it is the largest amphitheatre ever built.',
		lat: 41.89021,
		lng: 12.49223
	},
	{
		id: L(10),
		nameSv: 'Uluru',
		nameEn: 'Uluru',
		clueTextSv: 'En enorm röd sandstensklippa mitt i en ökenslätt, helig för sitt urfolk.',
		clueTextEn: 'A huge red sandstone monolith in the middle of a desert plain, sacred to its traditional owners.',
		factSv: 'Klippan reser sig 348 meter över slätten och skiftar färg i solnedgången.',
		factEn: 'The rock rises 348 metres above the plain and changes colour at sunset.',
		lat: -25.345,
		lng: 131.03611
	},
	{
		id: L(11),
		nameSv: 'Victoriafallen',
		nameEn: 'Victoria Falls',
		clueTextSv: 'Lokalbefolkningen kallar det ”röken som dånar”.',
		clueTextEn: 'Locals call it “the smoke that thunders”.',
		// No Swedish fact on purpose: exercises the sv → en content fallback.
		factSv: null,
		factEn: 'On the border of Zambia and Zimbabwe, it forms the largest sheet of falling water in the world.',
		lat: -17.92444,
		lng: 25.85583
	},
	{
		id: L(12),
		nameSv: 'Golden Gate-bron',
		nameEn: 'Golden Gate Bridge',
		clueTextSv: 'En orangeröd hängbro som ofta försvinner i dimman.',
		clueTextEn: 'An orange-red suspension bridge that often disappears into the fog.',
		factSv: 'Bron öppnade 1937 och var då världens längsta hängbro.',
		factEn: 'It opened in 1937 as the longest suspension bridge in the world.',
		lat: 37.81972,
		lng: -122.47861
	},
	{
		id: L(13),
		nameSv: 'Angkor Wat',
		nameEn: 'Angkor Wat',
		clueTextSv: 'Världens största religiösa monument, avbildat på landets flagga.',
		clueTextEn: 'The largest religious monument in the world, pictured on its country’s flag.',
		factSv: 'Tempelstaden byggdes på 1100-talet, först som hinduiskt och sedan buddhistiskt tempel.',
		factEn: 'Built in the 12th century, first as a Hindu and later as a Buddhist temple.',
		lat: 13.4125,
		lng: 103.86667
	},
	{
		id: L(14),
		nameSv: 'Burj Khalifa',
		nameEn: 'Burj Khalifa',
		clueTextSv: 'Världens högsta byggnad reser sig ur öknen vid en kust.',
		clueTextEn: 'The world’s tallest building rises out of the desert by the coast.',
		factSv: 'Skyskrapan är 828 meter hög och invigdes 2010.',
		factEn: 'The skyscraper is 828 metres tall and opened in 2010.',
		lat: 25.19722,
		lng: 55.27444
	},
	{
		id: L(15),
		nameSv: 'Mount Everest',
		nameEn: 'Mount Everest',
		clueTextSv: 'Den högsta punkten ovanför havsytan.',
		clueTextEn: 'The highest point above sea level.',
		factSv: 'Toppen nåddes första gången 1953 av Edmund Hillary och Tenzing Norgay.',
		factEn: 'First summited in 1953 by Edmund Hillary and Tenzing Norgay.',
		lat: 27.98806,
		lng: 86.925
	},
	{
		id: L(16),
		nameSv: 'Turning Torso',
		nameEn: 'Turning Torso',
		clueTextSv: 'En skyskrapa som vrider sig 90 grader, med utsikt över ett sund mot ett grannland.',
		// No English clue on purpose: exercises the en → sv content fallback.
		clueTextEn: null,
		factSv: 'Santiago Calatravas byggnad i Malmö är 190 meter hög och stod klar 2005.',
		factEn: 'Santiago Calatrava’s tower in Malmö is 190 metres tall and was completed in 2005.',
		lat: 55.61333,
		lng: 12.97556
	}
];

export const PLAYLISTS: SeedPlaylist[] = [
	{
		id: P(1),
		nameSv: 'Kända landmärken',
		nameEn: 'Famous landmarks',
		defaultTimerSeconds: 30,
		locationIds: [L(1), L(2), L(3), L(9), L(12), L(14), L(6), L(7)]
	},
	{
		id: P(2),
		nameSv: 'Jorden runt',
		nameEn: 'Around the world',
		defaultTimerSeconds: 45,
		locationIds: LOCATIONS.map((l) => l.id)
	}
];
