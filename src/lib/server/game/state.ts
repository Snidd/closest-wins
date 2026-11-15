/**
 * Game data helpers shared by the engine (inside its transactions) and the views. Reads only;
 * never selects a location's answer (that is `targets` in library.ts, for ended rounds only).
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Executor } from '#lib/server/db/index.ts';
import { gameRound, guess, player, type Game, type GameRound, type Player } from '#lib/server/db/schema.ts';
import type { NextStep, StandingRow } from '#lib/game/types.ts';
import { computeStandings, decideNextStep, type RoundOutcome } from './rules.ts';
import { deps } from './deps.ts';

export async function loadPlayers(ex: Executor, gameId: string): Promise<Player[]> {
	return ex
		.select()
		.from(player)
		.where(eq(player.gameId, gameId))
		.orderBy(asc(player.joinedAt), asc(player.id));
}

export async function loadRounds(ex: Executor, gameId: string): Promise<GameRound[]> {
	return ex.select().from(gameRound).where(eq(gameRound.gameId, gameId)).orderBy(asc(gameRound.index));
}

export function activePlayers(players: readonly Player[]): Player[] {
	return players.filter((p) => !p.kicked);
}

export function currentRoundOf(game: Game, rounds: readonly GameRound[]): GameRound | null {
	if (game.currentRound === null) return null;
	return rounds.find((r) => r.index === game.currentRound) ?? null;
}

/**
 * May `p` guess in `round`? Sudden death: only the listed players. Regular rounds: everyone who
 * had joined when the round started (a player joining mid-round spectates that round).
 */
export function isEligible(round: GameRound, p: Player): boolean {
	if (p.kicked) return false;
	if (round.eligiblePlayerIds) return round.eligiblePlayerIds.includes(p.id);
	return round.startedAt !== null && p.joinedAt.getTime() <= round.startedAt.getTime();
}

export function eligibleIds(round: GameRound, players: readonly Player[]): string[] {
	return players.filter((p) => isEligible(round, p)).map((p) => p.id);
}

/** 1-based display number: regular rounds count from 1, sudden-death rounds count from 1 too. */
export function roundNumber(round: Pick<GameRound, 'index' | 'isSuddenDeath'>, rounds: readonly GameRound[]): number {
	return (
		rounds.filter((r) => r.isSuddenDeath === round.isSuddenDeath && r.index <= round.index).length || 1
	);
}

export function regularRoundsStarted(rounds: readonly GameRound[]): number {
	return rounds.filter((r) => !r.isSuddenDeath && r.startedAt !== null).length;
}

export function regularRoundsEnded(rounds: readonly GameRound[]): number {
	return rounds.filter((r) => !r.isSuddenDeath && r.endedAt !== null).length;
}

/** Outcome per ended round (stored winners and stored distances of counting guesses). */
export async function roundOutcomes(
	ex: Executor,
	rounds: readonly GameRound[]
): Promise<Map<string, RoundOutcome>> {
	const ended = rounds.filter((r) => r.endedAt !== null);
	const out = new Map<string, RoundOutcome>();
	if (ended.length === 0) return out;
	const rows = await ex
		.select({ roundId: guess.roundId, playerId: guess.playerId, distanceKm: guess.distanceKm })
		.from(guess)
		.where(
			and(
				inArray(
					guess.roundId,
					ended.map((r) => r.id)
				),
				isNotNull(guess.distanceKm)
			)
		);
	for (const r of ended) out.set(r.id, { winnerPlayerIds: r.winnerPlayerIds, distances: new Map() });
	for (const row of rows) {
		(out.get(row.roundId)!.distances as Map<string, number>).set(row.playerId, row.distanceKm!);
	}
	return out;
}

export function standingsOf(
	players: readonly Player[],
	outcomes: ReadonlyMap<string, RoundOutcome>
): Omit<StandingRow, 'connected'>[] {
	return computeStandings(
		activePlayers(players).map((p) => ({ id: p.id, nickname: p.nickname, color: p.color })),
		[...outcomes.values()]
	);
}

/** Library locations not used by any round of this game. */
export async function unusedLocationIds(rounds: readonly GameRound[]): Promise<string[]> {
	const used = new Set(rounds.map((r) => r.locationId));
	return (await deps.libraryLocationIds()).filter((id) => !used.has(id));
}

/** `decideNextStep` with the library only consulted when it can matter. */
export async function nextStepFor(
	game: Game,
	rounds: readonly GameRound[],
	standings: readonly Pick<StandingRow, 'playerId' | 'roundsWon'>[]
): Promise<NextStep> {
	const regularRoundsPlayed = regularRoundsStarted(rounds);
	const base = { regularRoundsPlayed, totalRounds: game.roundCount, standings };
	const first = decideNextStep({ ...base, unusedLocationIds: ['?'] });
	if (first.kind !== 'suddenDeath') return first;
	return decideNextStep({ ...base, unusedLocationIds: await unusedLocationIds(rounds) });
}
