/**
 * Game remote functions.
 *
 * Realtime: the three `query.live` streams yield a snapshot immediately and a fresh one after
 * every change (`watchChannels` / `gameChanges` in `#lib/server/game/events.ts`), and register
 * presence while open (`enterPresence`) so "connected" is accurate for everyone. Each stream
 * passes the request's abort signal down, so an idle stream ends (and leaves presence) as soon
 * as the client disconnects.
 *
 * Auth (every function checks its caller itself; never trust `url`/`params`):
 * - admin: `requireAdmin()` from `#lib/server/auth/index.ts`
 * - player: cookie `playerCookieName(gameId)` → `findPlayerByToken`
 * - TV: cookie `cw_tv` → `resolveTv`
 * Queries cannot set cookies: `joinGame` (form) sets the player cookie, `registerTv` sets the TV
 * cookie. A stream reads cookies once when it opens, so after either of those the client
 * reconnects its stream (`/play` is a fresh page after the join redirect; the TV calls
 * `tvState().reconnect()` after `registerTv()`).
 *
 * `GameError`s become `error(gameErrorStatus(code), message)`, or `invalid(...)` in forms.
 */
import { error, invalid, redirect } from '@sveltejs/kit';
import { command, form, getRequestEvent, query } from '$app/server';
import {
	CreateGameSchema,
	EndGameSchema,
	EndRoundNowSchema,
	HostStateArgSchema,
	JoinGameSchema,
	KickPlayerSchema,
	ListGamesSchema,
	LockInSchema,
	MAX_PLAYERS,
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
import {
	getPlayerToken,
	getTvToken,
	requireAdmin,
	setPlayerToken,
	setTvToken
} from '#lib/server/auth/index.ts';
import * as engine from '#lib/server/game/engine.ts';
import { GameError, gameErrorStatus } from '#lib/server/game/engine.ts';
import { hostStream, playerStream, tvStream } from '#lib/server/game/streams.ts';
import * as history from '#lib/server/game/history.ts';
import { translate } from '#lib/i18n/dict.ts';
import { common } from '#lib/i18n/common.ts';
import { host } from '#lib/i18n/host.ts';

/** Maps a `GameError` to an HTTP error; rethrows anything else (including Kit redirects/errors). */
async function run<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof GameError) error(gameErrorStatus(e.code), e.message);
		throw e;
	}
}

// --- Live state ----------------------------------------------------------------------------------

/**
 * Player phone state for the game with this join code (identified by the player cookie).
 * Gates: `noGame` (waits for a game with this code to appear), `notJoined` (go to
 * `/join/[code]`; after joining the stream must be reopened), `kicked` (final: the stream ends).
 */
export const playerState = query.live(
	PlayerStateArgSchema,
	(code): AsyncGenerator<PlayerStateValue> => {
		const { cookies, request } = getRequestEvent();
		return playerStream(code, (gameId) => getPlayerToken(cookies, gameId), request.signal);
	}
);

/** Host controller state (admin only). */
export const hostState = query.live(
	HostStateArgSchema,
	async function* (gameId): AsyncGenerator<HostSnapshot> {
		requireAdmin();
		const { request } = getRequestEvent();
		if (!(await engine.getGame(gameId))) error(404, 'Game not found');
		try {
			yield* hostStream(gameId, request.signal);
		} catch (e) {
			// E.g. the game was deleted while the controller was open.
			if (e instanceof GameError) error(gameErrorStatus(e.code), e.message);
			throw e;
		}
	}
);

/**
 * Big screen state (identified by the TV cookie). Without a cookie it yields `unregistered`
 * and ends: call `registerTv()` then `tvState().reconnect()`. Otherwise it stays open across
 * pairing: pairing gate → paired game snapshot → (game finished, `nextPairing`) → next game.
 * Expired pairing codes are rotated in place.
 */
export const tvState = query.live((): AsyncGenerator<TvStateValue> => {
	const { cookies, request } = getRequestEvent();
	return tvStream(getTvToken(cookies), request.signal);
});

// --- Players -------------------------------------------------------------------------------------

/**
 * Join with a nickname. On success sets the player cookie and redirects (303) to
 * `/play/{code}`. Nickname taken / game full → `invalid(issue.nickname(...))`; unknown code →
 * `invalid(issue.code(...))`; removed by the host → form-level `invalid(...)`.
 */
export const joinGame = form(JoinGameSchema, async (data, issue) => {
	const event = getRequestEvent();
	const t = translate(common, event.locals.locale);
	const found = await engine.findGameByCode(data.code);
	if (!found) invalid(issue.code(t.gameNotFoundTitle));

	let result: Awaited<ReturnType<typeof engine.joinGame>>;
	try {
		result = await engine.joinGame(data, getPlayerToken(event.cookies, found.id));
	} catch (e) {
		if (e instanceof GameError) {
			switch (e.code) {
				case 'NICKNAME_TAKEN':
					invalid(issue.nickname(t.nicknameTaken));
				case 'GAME_FULL':
					invalid(issue.nickname(t.gameFull(MAX_PLAYERS)));
				case 'KICKED':
					invalid(t.kickedFromGame);
				case 'NOT_FOUND':
					invalid(issue.code(t.gameNotFoundTitle));
			}
			error(gameErrorStatus(e.code), e.message);
		}
		throw e;
	}
	if (result.token) setPlayerToken(event.cookies, event.url, result.gameId, result.token);
	redirect(303, `/play/${result.joinCode}`);
});

/** The calling player of `gameId` (player cookie), or 401/403. */
async function requirePlayer(gameId: string) {
	const { cookies } = getRequestEvent();
	const p = await engine.findPlayerByToken(gameId, getPlayerToken(cookies, gameId));
	if (!p) error(401, 'Join the game first');
	if (p.kicked) error(403, 'Removed from this game');
	return p;
}

/** Debounced cross position while panning (player cookie). Stale/after lock-in: ignored. */
export const updateGuess = command(UpdateGuessSchema, async (input): Promise<void> => {
	const p = await requirePlayer(input.gameId);
	await run(() => engine.updateGuess(p, input));
});

/** Lock in the final position (player cookie). 409 if already locked or the round is over. */
export const lockIn = command(LockInSchema, async (input): Promise<void> => {
	const p = await requirePlayer(input.gameId);
	await run(() => engine.lockIn(p, input));
});

// --- TV ------------------------------------------------------------------------------------------

/**
 * Registers this browser as a TV (sets the `cw_tv` cookie) and ensures a pairing code.
 * Idempotent: an already registered TV keeps its id. Follow with `tvState().reconnect()`.
 */
export const registerTv = command(async (): Promise<RegisterTvResult> => {
	const event = getRequestEvent();
	const r = await engine.registerTv(getTvToken(event.cookies));
	if (r.token) setTvToken(event.cookies, event.url, r.token);
	return { tvId: r.tvId };
});

// --- Host (admin) --------------------------------------------------------------------------------

/** Create a game (admin). On success redirects (303) to `/host/{gameId}`. */
export const createGame = form(CreateGameSchema, async (data, issue) => {
	requireAdmin();
	const t = translate(host, getRequestEvent().locals.locale);
	let created: Awaited<ReturnType<typeof engine.createGame>>;
	try {
		created = await engine.createGame(data);
	} catch (e) {
		if (e instanceof GameError && e.code === 'NOT_FOUND') {
			invalid(issue.playlistId(t.errPlaylistNotFound));
		}
		if (e instanceof GameError && e.code === 'PLAYLIST_EMPTY') {
			invalid(issue.playlistId(t.errPlaylistEmpty));
		}
		throw e;
	}
	redirect(303, `/host/${created.gameId}`);
});

/** Pair the TV showing `pairingCode` (admin). Wrong code → `invalid(issue.pairingCode(...))`. */
export const pairTv = form(PairTvSchema, async (data, issue): Promise<{ paired: true }> => {
	requireAdmin();
	const t = translate(host, getRequestEvent().locals.locale);
	try {
		await engine.pairTv(data.gameId, data.pairingCode);
	} catch (e) {
		if (e instanceof GameError && e.code === 'INVALID_PAIRING_CODE') {
			invalid(issue.pairingCode(t.errNoScreenWithCode));
		}
		if (e instanceof GameError && e.code === 'WRONG_PHASE') {
			invalid(t.errGameFinished);
		}
		if (e instanceof GameError) error(gameErrorStatus(e.code), e.message);
		throw e;
	}
	return { paired: true };
});

export const startRound = command(StartRoundSchema, async ({ gameId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.startRound(gameId));
});

/** Ends the running round now. A no-op if it already ended (e.g. the timer won the race). */
export const endRoundNow = command(EndRoundNowSchema, async ({ gameId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.endRoundNow(gameId));
});

export const skipReveal = command(SkipRevealSchema, async ({ gameId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.skipReveal(gameId));
});

export const nextRound = command(NextRoundSchema, async ({ gameId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.nextRound(gameId));
});

export const kickPlayer = command(KickPlayerSchema, async ({ gameId, playerId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.kickPlayer(gameId, playerId));
});

export const endGame = command(EndGameSchema, async ({ gameId }): Promise<void> => {
	requireAdmin();
	await run(() => engine.endGame(gameId));
});

// --- History (admin) -----------------------------------------------------------------------------

export const listGames = query(ListGamesSchema, async (input): Promise<GameHistoryItem[]> => {
	requireAdmin();
	return history.listGames(input);
});

export const getGameHistory = query(UuidSchema, async (gameId): Promise<GameHistoryDetail> => {
	requireAdmin();
	return run(() => history.getGameHistory(gameId));
});
