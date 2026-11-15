/**
 * Pure game rules (no I/O), unit tested. STUB (Wave 0): signatures are final.
 *
 * - Distance: great-circle (haversine) km, `haversineKm` from `#lib/geo.ts`.
 * - A guess counts if it was locked in, or if the player touched the map that round.
 * - Winner takes the round: the closest counting guess gets 1 point; exact ties all score;
 *   nobody scores if nobody has a counting guess. Only eligible players count (sudden death).
 * - Game winner: most rounds won. A tie for the lead after the planned rounds triggers sudden
 *   death between the tied leaders on a random unused location; if none is left they share.
 */
import type { LatLng } from '#lib/geo.ts';
import type { NextStep, StandingRow } from '#lib/game/types.ts';
import { notImplemented } from '../not-implemented.ts';

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
	return notImplemented('countsAsGuess');
}

/**
 * Scores one round. `eligiblePlayerIds` null means all `playerIds` are eligible.
 */
export function scoreRound(
	target: LatLng,
	guesses: readonly GuessRecord[],
	playerIds: readonly string[],
	eligiblePlayerIds: readonly string[] | null
): RoundScore {
	return notImplemented('scoreRound');
}

/** Standings ordered by roundsWon desc (then totalDistanceKm asc for display only). */
export function computeStandings(
	players: readonly StandingPlayer[],
	rounds: readonly RoundOutcome[]
): Omit<StandingRow, 'connected'>[] {
	return notImplemented('computeStandings');
}

/** Ids sharing first place by roundsWon (one id means a clear leader). */
export function leaders(standings: readonly Pick<StandingRow, 'playerId' | 'roundsWon'>[]): string[] {
	return notImplemented('leaders');
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
	return notImplemented('decideNextStep');
}

/**
 * The location ids for the regular rounds: the first `count` of the playlist order, or `count`
 * random ones; then shuffled if `shuffle`.
 */
export function pickRoundLocations(
	playlistLocationIds: readonly string[],
	count: number,
	selection: 'first' | 'random',
	shuffle: boolean,
	rng: () => number = Math.random
): string[] {
	return notImplemented('pickRoundLocations');
}

/** A random element, or null for an empty list (sudden-death location pick). */
export function pickRandom<T>(items: readonly T[], rng: () => number = Math.random): T | null {
	return notImplemented('pickRandom');
}
