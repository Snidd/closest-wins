/**
 * Game remote functions. STUB (Wave 0): exported names, input schemas and output types are
 * final; bodies are implemented in Wave 1 (game engine agent).
 *
 * Realtime: the three `query.live` streams yield a fresh snapshot after every change
 * (`gameChanges` in `#lib/server/game/events.ts`) and register presence while open
 * (`enterPresence` in presence.ts) so "connected" is accurate.
 *
 * Auth (every function checks its caller itself; never trust `url`/`params`):
 * - admin: `requireAdmin()` from `#lib/server/auth/index.ts`
 * - player: cookie `playerCookieName(gameId)` → `engine.resolvePlayer`
 * - TV: cookie `cw_tv` → `engine.resolveTv`
 * Queries cannot set cookies: `joinGame` (form) sets the player cookie, `registerTv` sets the TV
 * cookie; after `registerTv` the client calls `tvState().reconnect()`.
 *
 * Map `GameError` to `error(gameErrorStatus(e.code), e.message)` (or `invalid(...)` in forms).
 */
import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import {
	CreateGameSchema,
	EndGameSchema,
	EndRoundNowSchema,
	HostStateArgSchema,
	JoinGameSchema,
	KickPlayerSchema,
	ListGamesSchema,
	LockInSchema,
	NextRoundSchema,
	PairTvSchema,
	PlayerStateArgSchema,
	SkipRevealSchema,
	StartRoundSchema,
	UpdateGuessSchema,
	UuidSchema,
	type GameHistoryDetail,
	type GameHistoryItem,
	type HostSnapshot,
	type PlayerStateValue,
	type RegisterTvResult,
	type TvStateValue
} from '#lib/game/types.ts';

function notImplemented(name: string): never {
	error(501, `Not implemented: ${name}`);
}

// --- Live state ----------------------------------------------------------------------------------

/** Player phone state for the game with this join code (identified by the player cookie). */
export const playerState = query.live(
	PlayerStateArgSchema,
	async function* (code): AsyncGenerator<PlayerStateValue> {
		notImplemented(`playerState(${code})`);
	}
);

/** Host controller state (admin only). */
export const hostState = query.live(
	HostStateArgSchema,
	async function* (gameId): AsyncGenerator<HostSnapshot> {
		notImplemented(`hostState(${gameId})`);
	}
);

/** Big screen state (identified by the TV cookie; pairing screen until paired). */
export const tvState = query.live(async function* (): AsyncGenerator<TvStateValue> {
	notImplemented('tvState');
});

// --- Players -------------------------------------------------------------------------------------

/**
 * Join with a nickname. On success sets the player cookie and redirects (303) to
 * `/play/{code}`. Nickname taken / game full → `invalid(issue.nickname(...))`.
 */
export const joinGame = form(JoinGameSchema, async (data) => {
	notImplemented(`joinGame(${data.code})`);
});

/** Debounced cross position while panning (player cookie). */
export const updateGuess = command(UpdateGuessSchema, async (input): Promise<void> => {
	notImplemented(`updateGuess(${input.gameId})`);
});

/** Lock in the final position (player cookie). */
export const lockIn = command(LockInSchema, async (input): Promise<void> => {
	notImplemented(`lockIn(${input.gameId})`);
});

// --- TV ------------------------------------------------------------------------------------------

/** Registers this browser as a TV (sets the `cw_tv` cookie) and ensures a pairing code. */
export const registerTv = command(async (): Promise<RegisterTvResult> => {
	notImplemented('registerTv');
});

// --- Host (admin) --------------------------------------------------------------------------------

/** Create a game (admin). On success redirects (303) to `/host/{gameId}`. */
export const createGame = form(CreateGameSchema, async (data) => {
	notImplemented(`createGame(${data.playlistId})`);
});

/** Pair the TV showing `pairingCode` (admin). Wrong code → `invalid(issue.pairingCode(...))`. */
export const pairTv = form(PairTvSchema, async (data): Promise<{ paired: true }> => {
	notImplemented(`pairTv(${data.gameId})`);
});

export const startRound = command(StartRoundSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`startRound(${gameId})`);
});

export const endRoundNow = command(EndRoundNowSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`endRoundNow(${gameId})`);
});

export const skipReveal = command(SkipRevealSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`skipReveal(${gameId})`);
});

export const nextRound = command(NextRoundSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`nextRound(${gameId})`);
});

export const kickPlayer = command(KickPlayerSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`kickPlayer(${gameId})`);
});

export const endGame = command(EndGameSchema, async ({ gameId }): Promise<void> => {
	notImplemented(`endGame(${gameId})`);
});

// --- History (admin) -----------------------------------------------------------------------------

export const listGames = query(ListGamesSchema, async (input): Promise<GameHistoryItem[]> => {
	notImplemented(`listGames(${input.limit})`);
});

export const getGameHistory = query(UuidSchema, async (gameId): Promise<GameHistoryDetail> => {
	notImplemented(`getGameHistory(${gameId})`);
});
