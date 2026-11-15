/**
 * The game state machine. STUB (Wave 0): signatures are final, bodies are filled in Wave 1.
 *
 * Rules for the implementation:
 * - Postgres is the source of truth. Every transition runs in a transaction, then calls
 *   `notifyGame(gameId)` (events.ts) so live queries rebuild their snapshots.
 * - `ends_at` is server-authoritative. Keep one `setTimeout` per running round; `initEngine()`
 *   re-arms timers for rounds with `started_at` set and `ended_at` null (restart resumes).
 * - A round also ends early when every eligible *connected* player has locked in
 *   (`connectedPlayerIds` in presence.ts); re-check when presence changes.
 * - Callers are authenticated by the remote functions before calling in here: admin commands
 *   use `requireAdmin()`, player commands resolve the player with `resolvePlayer`.
 * - Throw `GameError` for expected failures; remote functions map them to HTTP errors.
 */
import type { Game, Player, TvScreen } from '#lib/server/db/schema.ts';
import type {
	CreateGameInput,
	CreateGameResult,
	JoinGameInput,
	JoinGameResult,
	LockInInput,
	UpdateGuessInput
} from '#lib/game/types.ts';
import { notImplemented } from '../not-implemented.ts';

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

/** Called once at server start (hooks.server.ts `init`). Re-arms timers of running rounds. */
export async function initEngine(): Promise<void> {
	// Wave 0: nothing to re-arm yet. Wave 1 replaces this body.
}

// --- Lookup ------------------------------------------------------------------------------------

export async function getGame(gameId: string): Promise<Game | null> {
	return notImplemented('getGame');
}

/** The unfinished game with this join code (codes are reused after a game finishes). */
export async function findGameByCode(code: string): Promise<Game | null> {
	return notImplemented('findGameByCode');
}

/** The non-kicked player of `gameId` owning `token`, or null. */
export async function resolvePlayer(gameId: string, token: string | null): Promise<Player | null> {
	return notImplemented('resolvePlayer');
}

/** The TV owning `token`, or null. */
export async function resolveTv(token: string | null): Promise<TvScreen | null> {
	return notImplemented('resolveTv');
}

// --- Host (admin) ------------------------------------------------------------------------------

/** Creates a game in `lobby` with a fresh join code and its planned rounds. */
export async function createGame(input: CreateGameInput): Promise<CreateGameResult> {
	return notImplemented('createGame');
}

/** Pairs the TV currently showing `pairingCode` with the game. */
export async function pairTv(gameId: string, pairingCode: string): Promise<void> {
	return notImplemented('pairTv');
}

/** `lobby` → `round` (first round). */
export async function startRound(gameId: string): Promise<void> {
	return notImplemented('startRound');
}

/** `round` → `reveal`, scoring the round now. */
export async function endRoundNow(gameId: string): Promise<void> {
	return notImplemented('endRoundNow');
}

/** In `reveal`: mark the choreography as skipped (`answerVisibleAt` becomes now). */
export async function skipReveal(gameId: string): Promise<void> {
	return notImplemented('skipReveal');
}

/** `reveal` → `standings`; `standings` → next round, sudden-death round, or `finished`. */
export async function nextRound(gameId: string): Promise<void> {
	return notImplemented('nextRound');
}

export async function kickPlayer(gameId: string, playerId: string): Promise<void> {
	return notImplemented('kickPlayer');
}

/** Any phase → `finished` (`endedEarly` if rounds remain). */
export async function endGame(gameId: string): Promise<void> {
	return notImplemented('endGame');
}

// --- Players -----------------------------------------------------------------------------------

/**
 * Joins (or re-joins) a game. If `existingToken` belongs to a non-kicked player of this game,
 * that player is returned and `token` is null; otherwise a new player is created with a colour
 * from `PLAYER_COLORS` and the newly minted token is returned (the caller sets the cookie).
 * Late joining is allowed between rounds; max `MAX_PLAYERS`.
 */
export async function joinGame(
	input: JoinGameInput,
	existingToken: string | null
): Promise<JoinGameResult & { token: string | null }> {
	return notImplemented('joinGame');
}

/** Debounced cross position while panning. Ignored after lock-in. */
export async function updateGuess(player: Player, input: UpdateGuessInput): Promise<void> {
	return notImplemented('updateGuess');
}

/** Final position; the guess cannot change afterwards. */
export async function lockIn(player: Player, input: LockInInput): Promise<void> {
	return notImplemented('lockIn');
}

// --- TVs ---------------------------------------------------------------------------------------

/**
 * Registers a TV (or returns the existing one for `existingToken`) and makes sure it has a
 * valid pairing code. `token` is non-null only when newly minted (the caller sets the cookie).
 */
export async function registerTv(
	existingToken: string | null
): Promise<{ tvId: string; token: string | null }> {
	return notImplemented('registerTv');
}
