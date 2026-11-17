/**
 * Pure game rules (no I/O), unit tested in rules.test.ts.
 *
 * - Distance: great-circle (haversine) km, `haversineKm` from `#lib/geo.ts`.
 * - A guess counts if it was locked in, or if the player touched the map that round.
 * - Winner takes the round: the closest counting guess gets 1 point; exact ties all score;
 *   nobody scores if nobody has a counting guess. Only eligible players count (sudden death,
 *   late joiners, kicked players).
 * - Game winner: most rounds won. A tie for the lead after the planned rounds triggers sudden
 *   death between the tied leaders on a random unused location; if none is left they share.
 *   If nobody won a single round, nobody wins.
 * - Teams: everyone still guesses alone; a round goes to the team(s) of its closest player(s),
 *   1 point per team and round. The same leader / sudden-death rules apply between teams, and
 *   sudden death is played by every active member of the tied teams.
 */
import { haversineKm, normalizeLatLng, type LatLng } from '#lib/geo.ts';
import type { NextStep, StandingRow } from '#lib/game/types.ts';

export { haversineKm } from '#lib/geo.ts';

export interface GuessRecord {
	playerId: string;
	lat: number;
	lng: number;
	touched: boolean;
	lockedAt: Date | null;
}

export interface ScoredGuess {
	playerId: string;
	distanceKm: number;
	/** 1-based, ties share a rank. */
	rank: number;
	isWinner: boolean;
}

export interface RoundScore {
	/** Counting guesses sorted by distance ascending. */
	scored: ScoredGuess[];
	winnerPlayerIds: string[];
	/** Eligible players without a counting guess. */
	noGuessPlayerIds: string[];
}

/** Outcome of a finished round, as input for standings. */
export interface RoundOutcome {
	winnerPlayerIds: string[];
	/** Distance per player with a counting guess. */
	distances: ReadonlyMap<string, number>;
}

export interface StandingPlayer {
	id: string;
	nickname: string;
	color: string;
}

export function countsAsGuess(guess: Pick<GuessRecord, 'touched' | 'lockedAt'>): boolean {
	return guess.lockedAt !== null || guess.touched;
}

/**
 * Competition ranks ("1, 1, 3") for values sorted ascending by `key`; equal keys share a rank.
 */
function competitionRanks<T>(sorted: readonly T[], key: (t: T) => number): number[] {
	const ranks: number[] = [];
	for (let i = 0; i < sorted.length; i++) {
		ranks.push(i > 0 && key(sorted[i]!) === key(sorted[i - 1]!) ? ranks[i - 1]! : i + 1);
	}
	return ranks;
}

/**
 * Scores one round. `playerIds` are the players still in the game (not kicked);
 * `eligiblePlayerIds` null means all `playerIds` are eligible. Guesses of players outside the
 * eligible set are ignored, as are duplicate guesses for one player (first wins).
 */
export function scoreRound(
	target: LatLng,
	guesses: readonly GuessRecord[],
	playerIds: readonly string[],
	eligiblePlayerIds: readonly string[] | null
): RoundScore {
	const present = new Set(playerIds);
	const eligible = (eligiblePlayerIds ?? playerIds).filter((id) => present.has(id));
	const eligibleSet = new Set(eligible);
	const goal = normalizeLatLng(target);

	const counted = new Map<string, number>();
	for (const g of guesses) {
		if (!eligibleSet.has(g.playerId) || counted.has(g.playerId) || !countsAsGuess(g)) continue;
		counted.set(g.playerId, haversineKm(normalizeLatLng(g), goal));
	}

	const sorted = [...counted.entries()]
		.map(([playerId, distanceKm]) => ({ playerId, distanceKm }))
		.sort((a, b) => a.distanceKm - b.distanceKm || (a.playerId < b.playerId ? -1 : 1));
	const ranks = competitionRanks(sorted, (s) => s.distanceKm);
	const scored: ScoredGuess[] = sorted.map((s, i) => ({
		...s,
		rank: ranks[i]!,
		isWinner: ranks[i] === 1
	}));

	return {
		scored,
		winnerPlayerIds: scored.filter((s) => s.isWinner).map((s) => s.playerId),
		noGuessPlayerIds: eligible.filter((id) => !counted.has(id))
	};
}

/**
 * Standings ordered by roundsWon desc; for display only, then by guessedRounds desc (a player
 * who skipped rounds has an artificially low total), totalDistanceKm asc, then input (join)
 * order. Ranks depend on roundsWon only.
 */
export function computeStandings(
	players: readonly StandingPlayer[],
	rounds: readonly RoundOutcome[]
): Omit<StandingRow, 'connected'>[] {
	const rows = players.map((p, order) => {
		let roundsWon = 0;
		let totalDistanceKm = 0;
		let guessedRounds = 0;
		for (const r of rounds) {
			if (r.winnerPlayerIds.includes(p.id)) roundsWon++;
			const d = r.distances.get(p.id);
			if (d !== undefined) {
				guessedRounds++;
				totalDistanceKm += d;
			}
		}
		return { p, order, roundsWon, totalDistanceKm, guessedRounds };
	});
	rows.sort(
		(a, b) =>
			b.roundsWon - a.roundsWon ||
			b.guessedRounds - a.guessedRounds ||
			a.totalDistanceKm - b.totalDistanceKm ||
			a.order - b.order
	);
	// Ranks by roundsWon only (sorted descending, so negate for the ascending helper).
	const ranks = competitionRanks(rows, (r) => -r.roundsWon);
	return rows.map((r, i) => ({
		playerId: r.p.id,
		nickname: r.p.nickname,
		color: r.p.color,
		rank: ranks[i]!,
		roundsWon: r.roundsWon,
		totalDistanceKm: r.totalDistanceKm,
		guessedRounds: r.guessedRounds
	}));
}

/** Ids sharing first place by roundsWon (one id means a clear leader). Empty for no players. */
export function leaders(standings: readonly Pick<StandingRow, 'playerId' | 'roundsWon'>[]): string[] {
	if (standings.length === 0) return [];
	const top = Math.max(...standings.map((s) => s.roundsWon));
	return standings.filter((s) => s.roundsWon === top).map((s) => s.playerId);
}

/** Winners if the game ended right now: the leaders, or nobody if no round was won. */
export function currentWinners(
	standings: readonly Pick<StandingRow, 'playerId' | 'roundsWon'>[]
): string[] {
	const top = leaders(standings);
	if (top.length === 0) return [];
	const won = standings.find((s) => s.playerId === top[0])!.roundsWon;
	return won > 0 ? top : [];
}

/**
 * What happens after the standings screen.
 * @param regularRoundsPlayed regular rounds already played
 * @param totalRounds planned regular rounds
 * @param unusedLocationIds library locations not yet used in this game (for sudden death)
 */
export function decideNextStep(args: {
	regularRoundsPlayed: number;
	totalRounds: number;
	standings: readonly Pick<StandingRow, 'playerId' | 'roundsWon'>[];
	unusedLocationIds: readonly string[];
}): NextStep {
	const { regularRoundsPlayed, totalRounds, standings, unusedLocationIds } = args;
	if (regularRoundsPlayed < totalRounds) return { kind: 'round', number: regularRoundsPlayed + 1 };

	const winners = currentWinners(standings);
	if (winners.length <= 1) return { kind: 'finish', winnerPlayerIds: winners };
	if (unusedLocationIds.length === 0) return { kind: 'finish', winnerPlayerIds: winners };
	return { kind: 'suddenDeath', eligiblePlayerIds: winners };
}

// --- Teams -------------------------------------------------------------------------------------

/** An active (non-kicked) player of a teams game, in join order. */
export interface TeamPlayer {
	id: string;
	team: number;
}

/** A team's standing without its display name (added by the views). */
export interface TeamStanding<R> {
	team: number;
	rank: number;
	roundsWon: number;
	members: R[];
}

/**
 * The unique teams (ascending) of a round's winning players. `players` are the active players:
 * a kicked player's round win no longer counts for their team.
 */
export function roundWinnerTeams(
	winnerPlayerIds: readonly string[],
	players: readonly TeamPlayer[]
): number[] {
	const teamOf = new Map(players.map((p) => [p.id, p.team]));
	const teams = new Set<number>();
	for (const id of winnerPlayerIds) {
		const team = teamOf.get(id);
		if (team !== undefined) teams.add(team);
	}
	return [...teams].sort((a, b) => a - b);
}

/**
 * Team standings: one row per team with at least one active player, ordered by roundsWon desc
 * then team index. A team scores at most 1 per round (sudden death included). Ranks depend on
 * roundsWon only. `members` keep the order of the per-player `standings`.
 */
export function computeTeamStandings<R extends { playerId: string }>(
	players: readonly TeamPlayer[],
	standings: readonly R[],
	rounds: readonly Pick<RoundOutcome, 'winnerPlayerIds'>[]
): TeamStanding<R>[] {
	const teamOf = new Map(players.map((p) => [p.id, p.team]));
	const won = new Map<number, number>();
	for (const p of players) won.set(p.team, 0);
	for (const r of rounds) {
		for (const team of roundWinnerTeams(r.winnerPlayerIds, players)) won.set(team, won.get(team)! + 1);
	}
	const rows = [...won.entries()]
		.map(([team, roundsWon]) => ({
			team,
			roundsWon,
			members: standings.filter((s) => teamOf.get(s.playerId) === team)
		}))
		.sort((a, b) => b.roundsWon - a.roundsWon || a.team - b.team);
	const ranks = competitionRanks(rows, (r) => -r.roundsWon);
	return rows.map((r, i) => ({ ...r, rank: ranks[i]! }));
}

/** Teams if the game ended right now: the leading teams, or none if no round was won. */
export function currentWinnerTeams(rows: readonly Pick<TeamStanding<unknown>, 'team' | 'roundsWon'>[]): number[] {
	if (rows.length === 0) return [];
	const top = Math.max(...rows.map((r) => r.roundsWon));
	if (top === 0) return [];
	return rows
		.filter((r) => r.roundsWon === top)
		.map((r) => r.team)
		.sort((a, b) => a - b);
}

/** Active members of `teams`, in team order, then join order. */
export function teamMembers(teams: readonly number[], players: readonly TeamPlayer[]): string[] {
	return [...teams]
		.sort((a, b) => a - b)
		.flatMap((team) => players.filter((p) => p.team === team).map((p) => p.id));
}

/**
 * `decideNextStep` for a teams game: the leading team wins; tied leading teams play sudden death
 * with all their active members (or share the win when no location is left).
 */
export function decideTeamNextStep(args: {
	regularRoundsPlayed: number;
	totalRounds: number;
	teamStandings: readonly Pick<TeamStanding<unknown>, 'team' | 'roundsWon'>[];
	players: readonly TeamPlayer[];
	unusedLocationIds: readonly string[];
}): NextStep {
	const { regularRoundsPlayed, totalRounds, teamStandings, players, unusedLocationIds } = args;
	if (regularRoundsPlayed < totalRounds) return { kind: 'round', number: regularRoundsPlayed + 1 };

	const teams = currentWinnerTeams(teamStandings);
	const members = teamMembers(teams, players);
	if (teams.length <= 1 || unusedLocationIds.length === 0) {
		return { kind: 'finish', winnerPlayerIds: members, winnerTeams: teams };
	}
	return { kind: 'suddenDeath', eligiblePlayerIds: members, teams };
}

/** Fisher–Yates shuffle (copy). */
export function shuffled<T>(items: readonly T[], rng: () => number = Math.random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.min(i, Math.floor(rng() * (i + 1)));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

/**
 * The location ids for the regular rounds: the first `count` of the playlist order, or `count`
 * random ones (kept in playlist order); then shuffled if `shuffle`. Duplicates are dropped and
 * `count` is capped at the number of distinct locations.
 */
export function pickRoundLocations(
	playlistLocationIds: readonly string[],
	count: number,
	selection: 'first' | 'random',
	shuffle: boolean,
	rng: () => number = Math.random
): string[] {
	const ids = [...new Set(playlistLocationIds)];
	const n = Math.max(0, Math.min(Math.floor(count), ids.length));
	let picked: string[];
	if (selection === 'first') {
		picked = ids.slice(0, n);
	} else {
		const chosen = new Set(shuffled(ids, rng).slice(0, n));
		picked = ids.filter((id) => chosen.has(id));
	}
	return shuffle ? shuffled(picked, rng) : picked;
}

/** A random element, or null for an empty list (sudden-death location pick). */
export function pickRandom<T>(items: readonly T[], rng: () => number = Math.random): T | null {
	if (items.length === 0) return null;
	return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}
