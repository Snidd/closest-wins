/**
 * The game state machine.
 *
 * - Postgres is the source of truth. Every transition runs in a transaction that first locks
 *   the game row (`SELECT … FOR UPDATE`), re-checks the phase and then writes, so concurrent
 *   commands, timers and presence checks serialise and each transition happens exactly once
 *   (the loser sees the new phase and becomes a no-op or a `WRONG_PHASE`). Guess writes take a
 *   `FOR SHARE` lock on the game row, so they never interleave with a round ending.
 *   After commit, `notifyGame(gameId)` wakes the live queries.
 * - `ends_at` is server-authoritative. One timer per running round (fires `ROUND_END_GRACE_MS`
 *   after `ends_at` so a last debounced cross position can still land); `initEngine()` re-arms
 *   timers at boot and ends rounds whose deadline already passed.
 * - A round also ends early when every eligible, connected, non-kicked player has locked in
 *   (checked after each lock-in, kick and, debounced, presence change).
 * - Callers are authenticated by the remote functions before calling in here.
 * - Expected failures throw `GameError`; remote functions map them to HTTP errors.
 */
import { randomInt } from 'node:crypto';
import { and, count, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db, type Transaction } from '#lib/server/db/index.ts';
import {
	game,
	gameRound,
	guess,
	player,
	tvScreen,
	type Game,
	type GameRound,
	type Player,
	type TvScreen
} from '#lib/server/db/schema.ts';
import {
	JOIN_CODE_ALPHABET,
	JOIN_CODE_LENGTH,
	MAX_PLAYERS,
	PAIRING_CODE_LENGTH,
	PAIRING_CODE_TTL_MS,
	type CreateGameInput,
	type CreateGameResult,
	type JoinGameInput,
	type JoinGameResult,
	type LockInInput,
	type UpdateGuessInput
} from '#lib/game/types.ts';
import { normalizeLatLng } from '#lib/geo.ts';
import { nextPlayerColor } from '#lib/ui/colors.ts';
import { hashToken, isPlausibleToken, mintToken } from '#lib/server/auth/crypto.ts';
import { notifyGame } from './events.ts';
import { connectedPlayerIds, onPresenceChange } from './presence.ts';
import { currentWinners, pickRandom, pickRoundLocations, scoreRound } from './rules.ts';
import { deps, type TimerHandle } from './deps.ts';
import { playlistLocationIds, targets } from './library.ts';
import {
	activePlayers,
	eligibleIds,
	isEligible,
	loadPlayers,
	loadRounds,
	nextStepFor,
	roundOutcomes,
	standingsOf,
	unusedLocationIds
} from './state.ts';

export { setEngineDeps, type EngineDeps } from './deps.ts';

/** The round timer fires this long after `ends_at` (in-flight guess updates still count). */
export const ROUND_END_GRACE_MS = 500;
/** A disconnect only counts for the early finish if the player stays away this long. */
export const DISCONNECT_GRACE_MS = 3000;
/** After a restart, give phones this long to reconnect before the early-finish rule applies. */
export const BOOT_PRESENCE_GRACE_MS = 10_000;

export type GameErrorCode =
	| 'NOT_FOUND'
	| 'WRONG_PHASE'
	| 'GAME_FULL'
	| 'NICKNAME_TAKEN'
	| 'KICKED'
	| 'NOT_ELIGIBLE'
	| 'ALREADY_LOCKED'
	| 'STALE_ROUND'
	| 'PLAYLIST_EMPTY'
	| 'INVALID_PAIRING_CODE';

export class GameError extends Error {
	constructor(
		readonly code: GameErrorCode,
		message: string = code
	) {
		super(message);
		this.name = 'GameError';
	}
}

/** HTTP status a remote function should use for a `GameError`. */
export function gameErrorStatus(code: GameErrorCode): number {
	switch (code) {
		case 'NOT_FOUND':
			return 404;
		case 'KICKED':
		case 'NOT_ELIGIBLE':
			return 403;
		case 'INVALID_PAIRING_CODE':
			return 400;
		default:
			return 409;
	}
}

// --- In-memory state (timers only; everything else is in Postgres) -----------------------------

const roundTimers = new Map<string, { roundId: string; handle: TimerHandle }>();
const presenceChecks = new Map<string, TimerHandle>();
let bootGraceUntil = 0;

/** Lifecycle events, for logs and tests. */
export type EngineEvent =
	| { type: 'roundStarted'; gameId: string; roundId: string; index: number }
	| { type: 'roundEnded'; gameId: string; roundId: string; reason: RoundEndReason }
	| { type: 'phase'; gameId: string; phase: Game['phase'] };
export type RoundEndReason = 'timer' | 'host' | 'allLocked' | 'gameEnded';

const engineListeners = new Set<(e: EngineEvent) => void>();
export function onEngineEvent(listener: (e: EngineEvent) => void): () => void {
	engineListeners.add(listener);
	return () => engineListeners.delete(listener);
}

interface Effects {
	notify: Set<string>;
	events: EngineEvent[];
	disarm: boolean;
	arm: { roundId: string; endsAt: number } | null;
}

function applyEffects(gameId: string, fx: Effects) {
	if (fx.disarm) disarmRoundTimer(gameId);
	if (fx.arm) armRoundTimer(gameId, fx.arm.roundId, fx.arm.endsAt);
	for (const key of fx.notify) notifyGame(key);
	for (const e of fx.events) {
		for (const l of [...engineListeners]) {
			try {
				l(e);
			} catch (err) {
				console.error('[engine] event listener failed', err);
			}
		}
	}
}

function armRoundTimer(gameId: string, roundId: string, endsAt: number) {
	disarmRoundTimer(gameId);
	const delay = endsAt - deps.now() + ROUND_END_GRACE_MS;
	const handle = deps.setTimer(async () => {
		if (roundTimers.get(gameId)?.handle === handle) roundTimers.delete(gameId);
		await endRoundIfDue(gameId, roundId);
	}, delay);
	roundTimers.set(gameId, { roundId, handle });
}

function disarmRoundTimer(gameId: string) {
	const t = roundTimers.get(gameId);
	if (t) {
		deps.clearTimer(t.handle);
		roundTimers.delete(gameId);
	}
	const p = presenceChecks.get(gameId);
	if (p !== undefined) {
		deps.clearTimer(p);
		presenceChecks.delete(gameId);
	}
}

function schedulePresenceCheck(gameId: string, delayMs: number) {
	const existing = presenceChecks.get(gameId);
	if (existing !== undefined) deps.clearTimer(existing);
	const handle = deps.setTimer(async () => {
		if (presenceChecks.get(gameId) === handle) presenceChecks.delete(gameId);
		await finishIfAllLocked(gameId);
	}, delayMs);
	presenceChecks.set(gameId, handle);
}

// A player's stream opened or closed: re-check the early finish once things settle.
onPresenceChange((gameId, key) => {
	if (key.startsWith('player:') && roundTimers.has(gameId)) {
		schedulePresenceCheck(gameId, DISCONNECT_GRACE_MS);
	}
});

/**
 * Runs `fn` in a transaction holding the game row lock, then applies timer changes and
 * notifications after commit.
 */
async function transition<T>(
	gameId: string,
	fn: (tx: Transaction, g: Game, fx: Effects) => Promise<T>
): Promise<T> {
	if (!isUuid(gameId)) throw new GameError('NOT_FOUND', 'Game not found');
	const fx: Effects = { notify: new Set(), events: [], disarm: false, arm: null };
	const result = await db.transaction(async (tx) => {
		const [g] = await tx.select().from(game).where(eq(game.id, gameId)).for('update');
		if (!g) throw new GameError('NOT_FOUND', 'Game not found');
		return fn(tx, g, fx);
	});
	applyEffects(gameId, fx);
	return result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_RE.test(s);

/** postgres.js error code (drizzle wraps driver errors in `cause`). */
function pgCode(e: unknown): string | undefined {
	const err = e as { code?: string; cause?: { code?: string } };
	return err?.cause?.code ?? err?.code;
}
function pgConstraint(e: unknown): string | undefined {
	const err = e as { constraint_name?: string; cause?: { constraint_name?: string } };
	return err?.cause?.constraint_name ?? err?.constraint_name;
}

// --- Boot ----------------------------------------------------------------------------------------

/**
 * Called once at server start (hooks.server.ts `init`). Re-arms timers of running rounds and
 * ends rounds whose deadline passed while the process was down. `gameIds` limits the scan
 * (tests).
 */
export async function initEngine(options: { gameIds?: string[] } = {}): Promise<void> {
	const now = deps.now();
	bootGraceUntil = now + BOOT_PRESENCE_GRACE_MS;
	const conditions = [
		isNotNull(gameRound.startedAt),
		isNull(gameRound.endedAt),
		eq(game.phase, 'round'),
		eq(game.currentRound, gameRound.index)
	];
	if (options.gameIds) {
		if (options.gameIds.length === 0) return;
		conditions.push(inArray(game.id, options.gameIds));
	}
	const running = await db
		.select({ gameId: game.id, roundId: gameRound.id, endsAt: gameRound.endsAt })
		.from(gameRound)
		.innerJoin(game, eq(game.id, gameRound.gameId))
		.where(and(...conditions));

	for (const r of running) {
		const endsAt = r.endsAt?.getTime() ?? now;
		if (endsAt <= now) {
			try {
				await endRoundIfDue(r.gameId, r.roundId);
			} catch (e) {
				console.error('[engine] could not end overdue round', r.roundId, e);
			}
		} else {
			armRoundTimer(r.gameId, r.roundId, endsAt);
			schedulePresenceCheck(r.gameId, BOOT_PRESENCE_GRACE_MS);
		}
	}
}

// --- Lookup ------------------------------------------------------------------------------------

export async function getGame(gameId: string): Promise<Game | null> {
	if (!isUuid(gameId)) return null;
	const [g] = await db.select().from(game).where(eq(game.id, gameId));
	return g ?? null;
}

/** The unfinished game with this join code (codes are reused after a game finishes). */
export async function findGameByCode(code: string): Promise<Game | null> {
	const canonical = code.trim().toUpperCase();
	const [g] = await db
		.select()
		.from(game)
		.where(and(eq(game.joinCode, canonical), ne(game.phase, 'finished')))
		.limit(1);
	return g ?? null;
}

/** The player of `gameId` owning `token`, kicked or not, or null. */
export async function findPlayerByToken(gameId: string, token: string | null): Promise<Player | null> {
	if (!isPlausibleToken(token) || !isUuid(gameId)) return null;
	const [p] = await db
		.select()
		.from(player)
		.where(and(eq(player.gameId, gameId), eq(player.tokenHash, hashToken(token))));
	return p ?? null;
}

/** The non-kicked player of `gameId` owning `token`, or null. */
export async function resolvePlayer(gameId: string, token: string | null): Promise<Player | null> {
	const p = await findPlayerByToken(gameId, token);
	return p && !p.kicked ? p : null;
}

/** Non-kicked players in the game (what `MAX_PLAYERS` limits). */
export async function activePlayerCount(gameId: string): Promise<number> {
	if (!isUuid(gameId)) return 0;
	const [row] = await db
		.select({ n: count() })
		.from(player)
		.where(and(eq(player.gameId, gameId), eq(player.kicked, false)));
	return row?.n ?? 0;
}

/** May another player join? (The `joinGame` transaction re-checks under the game lock.) */
export async function isGameFull(gameId: string): Promise<boolean> {
	return (await activePlayerCount(gameId)) >= MAX_PLAYERS;
}

/** The TV owning `token`, or null. */
export async function resolveTv(token: string | null): Promise<TvScreen | null> {
	if (!isPlausibleToken(token)) return null;
	const [tv] = await db.select().from(tvScreen).where(eq(tvScreen.tokenHash, hashToken(token)));
	return tv ?? null;
}

// --- Round mechanics (inside a transition) -------------------------------------------------------

async function lockCurrentRound(tx: Transaction, g: Game): Promise<GameRound | null> {
	if (g.currentRound === null) return null;
	const [r] = await tx
		.select()
		.from(gameRound)
		.where(and(eq(gameRound.gameId, g.id), eq(gameRound.index, g.currentRound)))
		.for('update');
	return r ?? null;
}

async function startRoundTx(tx: Transaction, g: Game, round: GameRound, fx: Effects) {
	const now = deps.now();
	const endsAt = now + g.timerSeconds * 1000;
	await tx
		.update(gameRound)
		.set({ startedAt: new Date(now), endsAt: new Date(endsAt), endedAt: null })
		.where(eq(gameRound.id, round.id));
	await tx
		.update(game)
		.set({
			phase: 'round',
			currentRound: round.index,
			startedAt: g.startedAt ?? new Date(now),
			revealStartedAt: null,
			revealSkippedAt: null
		})
		.where(eq(game.id, g.id));
	fx.arm = { roundId: round.id, endsAt };
	fx.notify.add(g.id);
	fx.events.push({ type: 'roundStarted', gameId: g.id, roundId: round.id, index: round.index });
	fx.events.push({ type: 'phase', gameId: g.id, phase: 'round' });
}

/** Scores the running round (distances + winners) and moves the game to `reveal`. */
async function endRoundTx(
	tx: Transaction,
	g: Game,
	round: GameRound,
	reason: RoundEndReason,
	fx: Effects
) {
	const now = deps.now();
	const players = await loadPlayers(tx, g.id);
	const eligible = eligibleIds(round, players);
	const guesses = await tx.select().from(guess).where(eq(guess.roundId, round.id));
	// The round is over: reading the answer is allowed from here on.
	const target = (await targets([round.locationId], tx)).get(round.locationId);
	if (!target) throw new Error(`Location ${round.locationId} of round ${round.id} is missing`);
	const score = scoreRound(
		target,
		guesses,
		activePlayers(players).map((p) => p.id),
		eligible
	);

	if (score.scored.length > 0) {
		const values = sql.join(
			score.scored.map((s) => sql`(${s.playerId}::uuid, ${s.distanceKm}::double precision)`),
			sql`, `
		);
		await tx.execute(sql`
			UPDATE ${guess} SET distance_km = v.d
			FROM (VALUES ${values}) AS v(pid, d)
			WHERE ${guess.roundId} = ${round.id} AND ${guess.playerId} = v.pid`);
	}
	await tx
		.update(gameRound)
		.set({ endedAt: new Date(now), winnerPlayerIds: score.winnerPlayerIds })
		.where(eq(gameRound.id, round.id));
	await tx
		.update(game)
		.set({ phase: 'reveal', revealStartedAt: new Date(now), revealSkippedAt: null })
		.where(eq(game.id, g.id));
	fx.disarm = true;
	fx.notify.add(g.id);
	fx.events.push({ type: 'roundEnded', gameId: g.id, roundId: round.id, reason });
	fx.events.push({ type: 'phase', gameId: g.id, phase: 'reveal' });
}

/** In a transition: ends the round if every eligible connected player has locked in. */
async function finishIfAllLockedTx(tx: Transaction, g: Game, fx: Effects): Promise<boolean> {
	if (g.phase !== 'round') return false;
	if (deps.now() < bootGraceUntil) return false;
	const round = await lockCurrentRound(tx, g);
	if (!round || round.endedAt || !round.startedAt) return false;
	const players = await loadPlayers(tx, g.id);
	const connected = connectedPlayerIds(g.id);
	const waitingOn = eligibleIds(round, players).filter((id) => connected.has(id));
	if (waitingOn.length === 0) return false;
	const locked = await tx
		.select({ playerId: guess.playerId })
		.from(guess)
		.where(and(eq(guess.roundId, round.id), isNotNull(guess.lockedAt)));
	const lockedIds = new Set(locked.map((l) => l.playerId));
	if (!waitingOn.every((id) => lockedIds.has(id))) return false;
	await endRoundTx(tx, g, round, 'allLocked', fx);
	return true;
}

async function finishIfAllLocked(gameId: string): Promise<void> {
	const now = deps.now();
	if (now < bootGraceUntil) {
		schedulePresenceCheck(gameId, bootGraceUntil - now);
		return;
	}
	try {
		await transition(gameId, (tx, g, fx) => finishIfAllLockedTx(tx, g, fx));
	} catch (e) {
		if (!(e instanceof GameError && e.code === 'NOT_FOUND')) throw e;
	}
}

/** Timer callback: ends the round if it is still running and its deadline has passed. */
async function endRoundIfDue(gameId: string, roundId: string): Promise<void> {
	try {
		await transition(gameId, async (tx, g, fx) => {
			if (g.phase !== 'round') return;
			const round = await lockCurrentRound(tx, g);
			if (!round || round.id !== roundId || round.endedAt) return;
			const endsAt = round.endsAt?.getTime() ?? 0;
			if (endsAt > deps.now()) {
				// Fired early (clock drift): try again at the deadline.
				fx.arm = { roundId, endsAt };
				return;
			}
			await endRoundTx(tx, g, round, 'timer', fx);
		});
	} catch (e) {
		if (!(e instanceof GameError && e.code === 'NOT_FOUND')) throw e;
	}
}

// --- Host (admin) ------------------------------------------------------------------------------

function randomJoinCode(): string {
	let code = '';
	for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
	return code;
}

function randomPairingCode(): string {
	return String(randomInt(10 ** PAIRING_CODE_LENGTH)).padStart(PAIRING_CODE_LENGTH, '0');
}

/** Creates a game in `lobby` with a fresh join code and its planned rounds. */
export async function createGame(input: CreateGameInput): Promise<CreateGameResult> {
	const ids = await playlistLocationIds(input.playlistId);
	if (ids === null) throw new GameError('NOT_FOUND', 'Playlist not found');
	const picked = pickRoundLocations(ids, input.roundCount, input.selection, input.shuffle, deps.random);
	if (picked.length === 0) throw new GameError('PLAYLIST_EMPTY', 'The playlist has no locations');

	for (let attempt = 0; ; attempt++) {
		const joinCode = randomJoinCode();
		try {
			const gameId = await db.transaction(async (tx) => {
				const [row] = await tx
					.insert(game)
					.values({
						joinCode,
						playlistId: input.playlistId,
						language: input.language,
						timerSeconds: input.timerSeconds,
						roundCount: picked.length,
						selection: input.selection,
						shuffle: input.shuffle
					})
					.returning({ id: game.id });
				await tx
					.insert(gameRound)
					.values(picked.map((locationId, index) => ({ gameId: row!.id, index, locationId })));
				return row!.id;
			});
			notifyGame(`code:${joinCode}`);
			return { gameId, joinCode };
		} catch (e) {
			if (pgCode(e) === '23505' && pgConstraint(e) === 'game_join_code_active_uq' && attempt < 50) {
				continue;
			}
			throw e;
		}
	}
}

/** Pairs the TV currently showing `pairingCode` with the game. */
export async function pairTv(gameId: string, pairingCode: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase === 'finished') throw new GameError('WRONG_PHASE', 'The game has finished');
		const now = new Date(deps.now());
		const [tv] = await tx
			.select()
			.from(tvScreen)
			.where(and(eq(tvScreen.pairingCode, pairingCode.trim()), gt(tvScreen.codeExpiresAt, now)))
			.for('update');
		if (!tv) throw new GameError('INVALID_PAIRING_CODE', 'No screen is showing that code');
		await tx
			.update(tvScreen)
			.set({ gameId: g.id, pairedAt: now, pairingCode: null, codeExpiresAt: null })
			.where(eq(tvScreen.id, tv.id));
		fx.notify.add(g.id);
		fx.notify.add(`tv:${tv.id}`);
		if (tv.gameId && tv.gameId !== g.id) fx.notify.add(tv.gameId);
	});
}

/** `lobby` → `round` (first round). */
export async function startRound(gameId: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase !== 'lobby') throw new GameError('WRONG_PHASE', 'The game has already started');
		const rounds = await loadRounds(tx, g.id);
		const first = rounds.find((r) => !r.isSuddenDeath && r.startedAt === null);
		if (!first) throw new GameError('PLAYLIST_EMPTY', 'The game has no rounds');
		await startRoundTx(tx, g, first, fx);
	});
}

/** `round` → `reveal`, scoring the round now. A no-op if the round already ended (race). */
export async function endRoundNow(gameId: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase === 'reveal') return;
		if (g.phase !== 'round') throw new GameError('WRONG_PHASE', 'No round is running');
		const round = await lockCurrentRound(tx, g);
		if (!round || round.endedAt) return;
		await endRoundTx(tx, g, round, 'host', fx);
	});
}

/** In `reveal`: mark the choreography as skipped (`answerVisibleAt` becomes now). */
export async function skipReveal(gameId: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase === 'standings') return;
		if (g.phase !== 'reveal') throw new GameError('WRONG_PHASE', 'Nothing is being revealed');
		if (g.revealSkippedAt) return;
		await tx.update(game).set({ revealSkippedAt: new Date(deps.now()) }).where(eq(game.id, g.id));
		fx.notify.add(g.id);
	});
}

/** `reveal` → `standings`; `standings` → next round, sudden-death round, or `finished`. */
export async function nextRound(gameId: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase === 'reveal') {
			await tx.update(game).set({ phase: 'standings' }).where(eq(game.id, g.id));
			fx.notify.add(g.id);
			fx.events.push({ type: 'phase', gameId: g.id, phase: 'standings' });
			return;
		}
		if (g.phase !== 'standings') throw new GameError('WRONG_PHASE', 'Not between rounds');

		const [players, rounds] = await Promise.all([loadPlayers(tx, g.id), loadRounds(tx, g.id)]);
		const standings = standingsOf(players, await roundOutcomes(tx, rounds));
		const next = await nextStepFor(g, rounds, standings);

		if (next.kind === 'round') {
			const round = rounds.find((r) => !r.isSuddenDeath && r.startedAt === null);
			if (round) return startRoundTx(tx, g, round, fx);
		} else if (next.kind === 'suddenDeath') {
			const locationId = pickRandom(await unusedLocationIds(rounds), deps.random);
			if (locationId) {
				const index = Math.max(...rounds.map((r) => r.index)) + 1;
				const [round] = await tx
					.insert(gameRound)
					.values({
						gameId: g.id,
						index,
						locationId,
						isSuddenDeath: true,
						eligiblePlayerIds: next.eligiblePlayerIds
					})
					.returning();
				return startRoundTx(tx, g, round!, fx);
			}
		}
		// Finish (also the fallback when no round/location is left after all).
		await finishTx(tx, g, next.kind === 'finish' ? next.winnerPlayerIds : currentWinners(standings), false, fx);
	});
}

async function finishTx(tx: Transaction, g: Game, winners: string[], endedEarly: boolean, fx: Effects) {
	await tx
		.update(game)
		.set({
			phase: 'finished',
			winnerPlayerIds: winners,
			endedEarly,
			finishedAt: new Date(deps.now()),
			revealStartedAt: null,
			revealSkippedAt: null
		})
		.where(eq(game.id, g.id));
	fx.disarm = true;
	fx.notify.add(g.id);
	fx.events.push({ type: 'phase', gameId: g.id, phase: 'finished' });
}

export async function kickPlayer(gameId: string, playerId: string): Promise<void> {
	if (!isUuid(playerId)) throw new GameError('NOT_FOUND', 'Player not found');
	await transition(gameId, async (tx, g, fx) => {
		const [p] = await tx
			.update(player)
			.set({ kicked: true })
			.where(and(eq(player.id, playerId), eq(player.gameId, g.id)))
			.returning({ id: player.id });
		if (!p) throw new GameError('NOT_FOUND', 'Player not found');
		fx.notify.add(g.id);
		// The kicked player may have been the last one we were waiting for.
		await finishIfAllLockedTx(tx, g, fx);
	});
}

/** Any phase → `finished` (`endedEarly` if rounds remain). A running round ends unscored. */
export async function endGame(gameId: string): Promise<void> {
	await transition(gameId, async (tx, g, fx) => {
		if (g.phase === 'finished') return;
		const now = new Date(deps.now());
		let endedEarly = g.phase === 'lobby' || g.phase === 'round';
		if (g.phase === 'round') {
			const round = await lockCurrentRound(tx, g);
			if (round && !round.endedAt) {
				await tx.update(gameRound).set({ endedAt: now }).where(eq(gameRound.id, round.id));
				fx.events.push({ type: 'roundEnded', gameId: g.id, roundId: round.id, reason: 'gameEnded' });
			}
		}
		const [players, rounds] = await Promise.all([loadPlayers(tx, g.id), loadRounds(tx, g.id)]);
		const standings = standingsOf(players, await roundOutcomes(tx, rounds));
		let winners = currentWinners(standings);
		if (!endedEarly) {
			const next = await nextStepFor(g, rounds, standings);
			if (next.kind === 'finish') winners = next.winnerPlayerIds;
			else endedEarly = true;
		}
		await finishTx(tx, g, winners, endedEarly, fx);
	});
}

// --- Players -----------------------------------------------------------------------------------

/**
 * Joins (or re-joins) a game. If `existingToken` belongs to a non-kicked player of this game,
 * that player is returned and `token` is null; otherwise a new player is created with a colour
 * from `PLAYER_COLORS` and the newly minted token is returned (the caller sets the cookie).
 * Late joining is allowed in any phase before `finished`; a player joining while a round runs
 * spectates that round. Max `MAX_PLAYERS` non-kicked players; nicknames are unique per game
 * (case-insensitive, kicked players' names stay taken).
 */
export async function joinGame(
	input: JoinGameInput,
	existingToken: string | null
): Promise<JoinGameResult & { token: string | null }> {
	const found = await findGameByCode(input.code);
	if (!found) throw new GameError('NOT_FOUND', 'No game with that code');

	const existing = await findPlayerByToken(found.id, existingToken);
	if (existing) {
		if (existing.kicked) throw new GameError('KICKED', 'Removed from this game');
		return { gameId: found.id, playerId: existing.id, joinCode: found.joinCode, token: null };
	}

	const nickname = input.nickname.trim();
	return transition(found.id, async (tx, g, fx) => {
		if (g.phase === 'finished') throw new GameError('NOT_FOUND', 'No game with that code');
		const players = await loadPlayers(tx, g.id);
		const active = activePlayers(players);
		if (active.length >= MAX_PLAYERS) throw new GameError('GAME_FULL', 'The game is full');
		const lower = nickname.toLowerCase();
		if (players.some((p) => p.nickname.toLowerCase() === lower)) {
			throw new GameError('NICKNAME_TAKEN', 'Nickname taken');
		}

		let joinedAt = deps.now();
		if (g.phase === 'round') {
			// Strictly after the round's start, so this player spectates the running round.
			const round = await lockCurrentRound(tx, g);
			const startedAt = round?.startedAt?.getTime();
			if (startedAt !== undefined && joinedAt <= startedAt) joinedAt = startedAt + 1;
		}
		const { token, hash } = mintToken();
		let row: { id: string } | undefined;
		try {
			[row] = await tx
				.insert(player)
				.values({
					gameId: g.id,
					nickname,
					color: nextPlayerColor(active.map((p) => p.color)),
					tokenHash: hash,
					joinedAt: new Date(joinedAt)
				})
				.returning({ id: player.id });
		} catch (e) {
			if (pgCode(e) === '23505' && pgConstraint(e) === 'player_game_nickname_uq') {
				throw new GameError('NICKNAME_TAKEN', 'Nickname taken');
			}
			throw e;
		}
		fx.notify.add(g.id);
		return { gameId: g.id, playerId: row!.id, joinCode: g.joinCode, token };
	});
}

type GuessCheck = { ok: true; round: GameRound } | { ok: false; reason: 'stale' };

/** Inside a guess transaction: game row FOR SHARE (serialises with round end), checks. */
async function checkGuess(
	tx: Transaction,
	p: Player,
	input: UpdateGuessInput
): Promise<GuessCheck> {
	if (p.gameId !== input.gameId) throw new GameError('NOT_FOUND', 'Game not found');
	const [g] = await tx.select().from(game).where(eq(game.id, input.gameId)).for('share');
	if (!g) throw new GameError('NOT_FOUND', 'Game not found');
	if (g.phase !== 'round' || g.currentRound !== input.roundIndex) return { ok: false, reason: 'stale' };
	const [round] = await tx
		.select()
		.from(gameRound)
		.where(and(eq(gameRound.gameId, g.id), eq(gameRound.index, input.roundIndex)));
	if (!round || !round.startedAt || round.endedAt) return { ok: false, reason: 'stale' };
	const [fresh] = await tx.select().from(player).where(eq(player.id, p.id));
	if (!fresh || fresh.kicked) throw new GameError('KICKED', 'Removed from this game');
	if (!isEligible(round, fresh)) throw new GameError('NOT_ELIGIBLE', 'You are not playing this round');
	return { ok: true, round };
}

/** Debounced cross position while panning. Ignored after lock-in and for stale rounds. */
export async function updateGuess(p: Player, input: UpdateGuessInput): Promise<void> {
	const pos = normalizeLatLng(input);
	await db.transaction(async (tx) => {
		const check = await checkGuess(tx, p, input);
		if (!check.ok) return;
		await tx
			.insert(guess)
			.values({ roundId: check.round.id, playerId: p.id, lat: pos.lat, lng: pos.lng, touched: input.touched })
			.onConflictDoUpdate({
				target: [guess.roundId, guess.playerId],
				set: { lat: pos.lat, lng: pos.lng, touched: sql`${guess.touched} OR excluded.touched` },
				setWhere: isNull(guess.lockedAt)
			});
	});
	// No notification: positions are not part of anyone's snapshot until reveal.
}

/** Final position; the guess cannot change afterwards. */
export async function lockIn(p: Player, input: LockInInput): Promise<void> {
	const pos = normalizeLatLng(input);
	const now = new Date(deps.now());
	await db.transaction(async (tx) => {
		const check = await checkGuess(tx, p, input);
		if (!check.ok) throw new GameError('STALE_ROUND', 'The round is over');
		const rows = await tx
			.insert(guess)
			.values({
				roundId: check.round.id,
				playerId: p.id,
				lat: pos.lat,
				lng: pos.lng,
				touched: input.touched,
				lockedAt: now
			})
			.onConflictDoUpdate({
				target: [guess.roundId, guess.playerId],
				set: {
					lat: pos.lat,
					lng: pos.lng,
					touched: sql`${guess.touched} OR excluded.touched`,
					lockedAt: now
				},
				setWhere: isNull(guess.lockedAt)
			})
			.returning({ playerId: guess.playerId });
		if (rows.length === 0) throw new GameError('ALREADY_LOCKED', 'Already locked in');
	});
	notifyGame(input.gameId);
	try {
		await finishIfAllLocked(input.gameId);
	} catch (e) {
		// The lock-in itself succeeded; the timer still ends the round.
		console.error('[engine] early-finish check failed', e);
	}
}

// --- TVs ---------------------------------------------------------------------------------------

/** Is this TV free to pair (never paired, or its game has finished)? */
async function tvIsFree(tv: TvScreen): Promise<boolean> {
	if (!tv.gameId) return true;
	const [g] = await db.select({ phase: game.phase }).from(game).where(eq(game.id, tv.gameId));
	return !g || g.phase === 'finished';
}

/**
 * Makes sure a free TV has a valid pairing code, rotating an expired one. Returns the current
 * row. Paired TVs (game not finished) are returned unchanged.
 */
export async function ensurePairingCode(tv: TvScreen): Promise<TvScreen> {
	if (!(await tvIsFree(tv))) return tv;
	const now = deps.now();
	if (tv.pairingCode && tv.codeExpiresAt && tv.codeExpiresAt.getTime() > now) return tv;
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			const [row] = await db
				.update(tvScreen)
				.set({ pairingCode: randomPairingCode(), codeExpiresAt: new Date(now + PAIRING_CODE_TTL_MS) })
				.where(
					and(
						eq(tvScreen.id, tv.id),
						or(
							isNull(tvScreen.pairingCode),
							isNull(tvScreen.codeExpiresAt),
							lte(tvScreen.codeExpiresAt, new Date(now))
						)
					)
				)
				.returning();
			if (row) {
				notifyGame(`tv:${tv.id}`);
				return row;
			}
			// Someone else rotated it (another tab of the same TV) or it was paired meanwhile.
			const [current] = await db.select().from(tvScreen).where(eq(tvScreen.id, tv.id));
			return current ?? tv;
		} catch (e) {
			if (pgCode(e) !== '23505') throw e;
		}
	}
	throw new Error('Could not allocate a pairing code');
}

/**
 * Registers a TV (or returns the existing one for `existingToken`) and makes sure it has a
 * valid pairing code. `token` is non-null only when newly minted (the caller sets the cookie).
 */
export async function registerTv(
	existingToken: string | null
): Promise<{ tvId: string; token: string | null }> {
	const existing = await resolveTv(existingToken);
	if (existing) {
		await ensurePairingCode(existing);
		return { tvId: existing.id, token: null };
	}
	const { token, hash } = mintToken();
	const [row] = await db
		.insert(tvScreen)
		.values({ tokenHash: hash })
		.returning();
	await ensurePairingCode(row!);
	return { tvId: row!.id, token };
}

// --- Test support ------------------------------------------------------------------------------

/** Forgets all in-memory timers (simulates a process restart in tests). */
export function resetEngineMemory(): void {
	for (const t of roundTimers.values()) deps.clearTimer(t.handle);
	for (const h of presenceChecks.values()) deps.clearTimer(h);
	roundTimers.clear();
	presenceChecks.clear();
	bootGraceUntil = 0;
}

/** Game ids with an armed round timer (tests, diagnostics). */
export function armedRoundTimers(): Map<string, string> {
	return new Map([...roundTimers].map(([gameId, t]) => [gameId, t.roundId]));
}
