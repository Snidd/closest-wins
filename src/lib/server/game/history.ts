/**
 * Game history for the admin UI. Answers are only read for rounds that have ended, so a game
 * that is still running never exposes its current round here either.
 */
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { game, gameRound, guess, player, type Game, type Player } from '#lib/server/db/schema.ts';
import type { GameHistoryDetail, GameHistoryItem, GameHistoryRound, ListGamesInput } from '#lib/game/types.ts';
import { connectedPlayerIds } from './presence.ts';
import { playlistNames, targets } from './library.ts';
import { activePlayers, loadPlayers, loadRounds, roundOutcomes, standingsOf } from './state.ts';
import { GameError } from './engine.ts';

function item(
	g: Game,
	names: Map<string, { nameSv: string | null; nameEn: string | null }>,
	playerCount: number,
	roundsPlayed: number,
	players: Pick<Player, 'id' | 'nickname' | 'color'>[]
): GameHistoryItem {
	const byId = new Map(players.map((p) => [p.id, p]));
	return {
		id: g.id,
		joinCode: g.joinCode,
		phase: g.phase,
		playlistName: (g.playlistId && names.get(g.playlistId)) || null,
		language: g.language,
		createdAt: g.createdAt.getTime(),
		finishedAt: g.finishedAt?.getTime() ?? null,
		playerCount,
		roundsPlayed,
		winners: g.winnerPlayerIds.flatMap((id) => {
			const p = byId.get(id);
			return p ? [{ playerId: p.id, nickname: p.nickname, color: p.color }] : [];
		}),
		endedEarly: g.endedEarly
	};
}

export async function listGames(input: ListGamesInput): Promise<GameHistoryItem[]> {
	const games = await db
		.select()
		.from(game)
		.orderBy(desc(game.createdAt))
		.limit(input.limit)
		.offset(input.offset);
	if (games.length === 0) return [];
	const ids = games.map((g) => g.id);
	const [names, counts, played, winners] = await Promise.all([
		playlistNames(games.flatMap((g) => (g.playlistId ? [g.playlistId] : []))),
		db
			.select({ gameId: player.gameId, n: count() })
			.from(player)
			.where(and(inArray(player.gameId, ids), eq(player.kicked, false)))
			.groupBy(player.gameId),
		db
			.select({ gameId: gameRound.gameId, n: count() })
			.from(gameRound)
			.where(and(inArray(gameRound.gameId, ids), isNotNull(gameRound.startedAt)))
			.groupBy(gameRound.gameId),
		(() => {
			const winnerIds = games.flatMap((g) => g.winnerPlayerIds);
			return winnerIds.length === 0
				? Promise.resolve([])
				: db
						.select({ id: player.id, nickname: player.nickname, color: player.color })
						.from(player)
						.where(inArray(player.id, winnerIds));
		})()
	]);
	const countOf = (rows: { gameId: string; n: number }[], id: string) =>
		rows.find((r) => r.gameId === id)?.n ?? 0;
	return games.map((g) => item(g, names, countOf(counts, g.id), countOf(played, g.id), winners));
}

export async function getGameHistory(gameId: string): Promise<GameHistoryDetail> {
	const [g] = await db.select().from(game).where(eq(game.id, gameId));
	if (!g) throw new GameError('NOT_FOUND', 'Game not found');
	const [players, rounds, names] = await Promise.all([
		loadPlayers(db, gameId),
		loadRounds(db, gameId),
		g.playlistId ? playlistNames([g.playlistId]) : Promise.resolve(new Map())
	]);
	const ended = rounds.filter((r) => r.endedAt !== null);
	const [outcomes, targetMap, guesses] = await Promise.all([
		roundOutcomes(db, rounds),
		targets(ended.map((r) => r.locationId)),
		ended.length === 0
			? Promise.resolve([])
			: db
					.select({
						roundId: guess.roundId,
						playerId: guess.playerId,
						distanceKm: guess.distanceKm,
						lockedAt: guess.lockedAt
					})
					.from(guess)
					.where(
						inArray(
							guess.roundId,
							ended.map((r) => r.id)
						)
					)
	]);
	const connected = connectedPlayerIds(gameId);
	const historyRounds: GameHistoryRound[] = ended.flatMap((r) => {
		const target = targetMap.get(r.locationId);
		if (!target) return [];
		return [
			{
				index: r.index,
				isSuddenDeath: r.isSuddenDeath,
				target,
				winnerPlayerIds: r.winnerPlayerIds,
				guesses: guesses
					.filter((x) => x.roundId === r.id)
					.map((x) => ({ playerId: x.playerId, distanceKm: x.distanceKm, locked: x.lockedAt !== null }))
			}
		];
	});
	return {
		...item(
			g,
			names,
			activePlayers(players).length,
			rounds.filter((r) => r.startedAt !== null).length,
			players
		),
		standings: standingsOf(players, outcomes).map((s) => ({ ...s, connected: connected.has(s.playerId) })),
		rounds: historyRounds
	};
}
