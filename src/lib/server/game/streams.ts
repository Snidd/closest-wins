/**
 * The live-query generators behind `playerState`, `hostState` and `tvState`
 * (`#lib/remote/game.remote.ts` only adds auth and the request context), kept here so they can
 * be tested without Kit.
 *
 * Cancellation: Kit calls `generator.return()` when the client disconnects, but that cannot
 * interrupt a pending `await` (a stream idling between changes). The request's abort signal is
 * what wakes `watchChannels`, which then ends the loop and runs the `finally` blocks (leave
 * presence, clear timers, unsubscribe). Both paths are covered by streams.test.ts.
 */
import type { HostSnapshot, PlayerStateValue, TvStateValue } from '#lib/game/types.ts';
import { gameChanges, notifyGame, watchChannels } from './events.ts';
import { enterPresence } from './presence.ts';
import { resolveTv } from './engine.ts';
import { buildHostSnapshot, buildPlayerStateForGame, buildTvStateFor, resolvePlayerGame } from './views.ts';

export async function* playerStream(
	code: string,
	tokenFor: (gameId: string) => string | null,
	signal?: AbortSignal
): AsyncGenerator<PlayerStateValue> {
	let gameId: string | null = null;
	let leave: (() => void) | null = null;
	try {
		for await (const _ of watchChannels(() => (gameId ? [gameId] : [`code:${code}`]), signal)) {
			if (!gameId) gameId = (await resolvePlayerGame(code, tokenFor))?.id ?? null;
			if (!gameId) {
				yield { role: 'player', status: 'noGame' };
				continue;
			}
			const state = await buildPlayerStateForGame(gameId, tokenFor(gameId));
			if (state.status === 'playing') {
				leave ??= enterPresence(gameId, `player:${state.me.id}`);
			} else {
				leave?.();
				leave = null;
			}
			yield state;
			if (state.status === 'kicked') return;
		}
	} finally {
		leave?.();
	}
}

export async function* hostStream(gameId: string, signal?: AbortSignal): AsyncGenerator<HostSnapshot> {
	const leave = enterPresence(gameId, 'host:admin');
	try {
		for await (const _ of gameChanges(gameId, signal)) yield await buildHostSnapshot(gameId);
	} finally {
		leave();
	}
}

export async function* tvStream(token: string | null, signal?: AbortSignal): AsyncGenerator<TvStateValue> {
	const first = await resolveTv(token);
	if (!first) {
		yield { role: 'tv', status: 'unregistered' };
		return;
	}
	const tvId = first.id;
	let gameId: string | null = first.gameId;
	let presence: { gameId: string; leave: () => void } | null = null;
	let wake: ReturnType<typeof setTimeout> | null = null;
	try {
		for await (const _ of watchChannels(
			() => (gameId ? [`tv:${tvId}`, gameId] : [`tv:${tvId}`]),
			signal
		)) {
			const tv = await resolveTv(token);
			if (!tv) {
				yield { role: 'tv', status: 'unregistered' };
				return;
			}
			const state = await buildTvStateFor(tv);
			gameId = state.status === 'paired' ? state.game.id : null;

			if (presence && presence.gameId !== gameId) {
				presence.leave();
				presence = null;
			}
			if (gameId && !presence) presence = { gameId, leave: enterPresence(gameId, `tv:${tvId}`) };

			// Wake up when the shown pairing code expires, so a fresh one is shown.
			if (wake) clearTimeout(wake);
			wake = null;
			const expiresAt =
				state.status === 'pairing'
					? state.codeExpiresAt
					: state.status === 'paired'
						? state.nextPairing?.codeExpiresAt
						: undefined;
			if (expiresAt !== undefined) {
				wake = setTimeout(() => notifyGame(`tv:${tvId}`), Math.max(0, expiresAt - Date.now()) + 100);
				wake.unref?.();
			}
			yield state;
		}
	} finally {
		presence?.leave();
		if (wake) clearTimeout(wake);
	}
}
