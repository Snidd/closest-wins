/** Fake players and round results for the /dev/map playground. */
import { haversineKm, normalizeLng } from '#lib/geo.ts';
import { REVEAL_SUSPENSE_MS, type PlayerSummary, type RevealGuess, type RoundResult } from '#lib/game/types.ts';
import { PLAYER_COLORS } from '#lib/ui/colors.ts';

const NAMES = [
	'Anna', 'Björn', 'Chen', 'Dalia', 'Erik', 'Fatima', 'Gustav', 'Hiro', 'Ines', 'Jonas',
	'Kofi', 'Lena', 'Mateo', 'Nora', 'Oskar', 'Priya', 'Quinn', 'Rasmus', 'Sofia', 'Tariq',
	'Ulla', 'Viktor', 'Wen', 'Xenia', 'Yusuf', 'Zara', 'Alva', 'Bosse', 'Cleo', 'Dino',
	'Elsa', 'Filip', 'Greta', 'Hugo', 'Ida', 'Jack', 'Klara', 'Liam', 'Maja', 'Superlongname16'
];

export const TARGETS = {
	stockholm: { lat: 59.3293, lng: 18.0686, nameEn: 'Stockholm', nameSv: 'Stockholm' },
	fiji: { lat: -17.7134, lng: 178.065, nameEn: 'Fiji (antimeridian)', nameSv: 'Fiji (datumgränsen)' },
	machuPicchu: { lat: -13.1631, lng: -72.545, nameEn: 'Machu Picchu', nameSv: 'Machu Picchu' },
	uluru: { lat: -25.3444, lng: 131.0369, nameEn: 'Uluru', nameSv: 'Uluru' }
} as const;
export type TargetKey = keyof typeof TARGETS;

/** Deterministic PRNG so a replay shows the same guesses. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function fakePlayers(n: number): PlayerSummary[] {
	return Array.from({ length: n }, (_, i) => ({
		id: `p${i}`,
		nickname: NAMES[i % NAMES.length]!,
		color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
		connected: i % 11 !== 5,
		lateJoiner: false
	}));
}

export function fakeResult(
	players: PlayerSummary[],
	targetKey: TargetKey,
	serverNow: number,
	opts: { seed?: number; skipped?: boolean } = {}
): RoundResult {
	const target = TARGETS[targetKey];
	const rand = rng(opts.seed ?? 7);
	const noGuess: string[] = [];
	const raw: Array<Omit<RevealGuess, 'rank' | 'isWinner'>> = [];
	for (const p of players) {
		if (rand() < 0.08 && players.length > 3) {
			noGuess.push(p.id);
			continue;
		}
		// Log-normal-ish spread: a few close guesses, many within a continent, some wild.
		const dist = Math.exp(rand() * 8.3) * 1.2; // 1 km … ~5000 km
		const bearing = rand() * Math.PI * 2;
		const dLat = (dist / 111) * Math.cos(bearing);
		const dLng = ((dist / 111) * Math.sin(bearing)) / Math.max(0.2, Math.cos((target.lat * Math.PI) / 180));
		const lat = Math.max(-80, Math.min(80, target.lat + dLat));
		const lng = normalizeLng(target.lng + dLng);
		raw.push({ playerId: p.id, lat, lng, distanceKm: haversineKm({ lat, lng }, target), locked: rand() > 0.2 });
	}
	raw.sort((a, b) => a.distanceKm - b.distanceKm);
	const guesses: RevealGuess[] = raw.map((g) => ({
		...g,
		rank: raw.findIndex((x) => x.distanceKm === g.distanceKm) + 1,
		isWinner: g.distanceKm === raw[0]?.distanceKm
	}));
	return {
		round: {
			index: 0,
			number: 1,
			isSuddenDeath: false,
			eligiblePlayerIds: players.map((p) => p.id),
			clue: { textSv: null, textEn: 'Fake clue', photo: null },
			startedAt: serverNow - 60_000,
			endedAt: serverNow
		},
		target: {
			lat: target.lat,
			lng: target.lng,
			nameEn: target.nameEn,
			nameSv: target.nameSv,
			factEn: 'A fact about the place.',
			factSv: 'Ett faktum om platsen.'
		},
		guesses,
		noGuessPlayerIds: noGuess,
		winnerPlayerIds: guesses.filter((g) => g.isWinner).map((g) => g.playerId),
		revealStartedAt: serverNow,
		answerVisibleAt: opts.skipped ? serverNow : serverNow + REVEAL_SUSPENSE_MS,
		skipped: opts.skipped ?? false
	};
}
