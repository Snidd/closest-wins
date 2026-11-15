/**
 * In-process change notification (single Node process by design). The engine calls
 * `notifyGame(key)` after every committed state change; live queries iterate `gameChanges` /
 * `watchChannels`.
 *
 * Channels are plain strings. Game channels are the game id; the engine also uses
 * `tv:<tvId>` (a TV's pairing changed) and `code:<JOINCODE>` (a game with that join code was
 * created) so streams that are not yet attached to a game can follow along.
 */

type Listener = () => void;

/** Aborted when the process starts shutting down: every live stream ends (see `endAllStreams`). */
const shutdown = new AbortController();

/**
 * Ends every open live stream (server shutdown). Clients see their stream end and reconnect to
 * the next process; without this, open event streams keep the HTTP server from closing until
 * adapter-node's SHUTDOWN_TIMEOUT.
 */
export function endAllStreams(): void {
	shutdown.abort();
}

export function isShuttingDown(): boolean {
	return shutdown.signal.aborted;
}

const listeners = new Map<string, Set<Listener>>();
const versions = new Map<string, number>();

export function subscribeGame(gameId: string, listener: Listener): () => void {
	let set = listeners.get(gameId);
	if (!set) listeners.set(gameId, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0 && listeners.get(gameId) === set) listeners.delete(gameId);
	};
}

/** Wake every subscriber of the channel. Cheap; call after each committed change. */
export function notifyGame(gameId: string): void {
	versions.set(gameId, (versions.get(gameId) ?? 0) + 1);
	const set = listeners.get(gameId);
	if (!set) return;
	for (const l of [...set]) {
		try {
			l();
		} catch (e) {
			console.error('[events] listener failed', e);
		}
	}
}

/**
 * Marks the game's shared snapshot model stale without waking any stream: for state that is in
 * no live snapshot but is read when a stream (re)opens (a player's own cross position, which
 * restores the map after a refresh). The next snapshot built, by a new stream or after the next
 * `notifyGame`, reads it fresh.
 */
export function invalidateGame(gameId: string): void {
	versions.set(gameId, (versions.get(gameId) ?? 0) + 1);
}

/**
 * Monotonic per-channel change counter for the process lifetime (snapshot caching: equal
 * versions mean nothing was notified in between). One number per channel ever notified.
 */
export function gameVersion(gameId: string): number {
	return versions.get(gameId) ?? 0;
}

export function subscriberCount(gameId: string): number {
	return listeners.get(gameId)?.size ?? 0;
}

/** Total number of subscriptions over all channels (leak checks in tests). */
export function totalSubscriberCount(): number {
	let n = 0;
	for (const set of listeners.values()) n += set.size;
	return n;
}

/**
 * Like `gameChanges`, but over a set of channels that may change between iterations:
 * `getKeys()` is re-read every time the consumer asks for the next change. A newly added
 * channel forces one extra wake-up, because a change on it may have happened while the consumer
 * was building its last value.
 */
export async function* watchChannels(
	getKeys: () => readonly string[],
	requestSignal?: AbortSignal
): AsyncGenerator<void> {
	const signal = requestSignal ? AbortSignal.any([requestSignal, shutdown.signal]) : shutdown.signal;
	let dirty = true;
	let wake: (() => void) | null = null;
	const subs = new Map<string, () => void>();
	const listener = () => {
		dirty = true;
		wake?.();
	};
	const sync = (initial: boolean) => {
		const keys = new Set(getKeys());
		for (const [key, unsubscribe] of subs) {
			if (!keys.has(key)) {
				unsubscribe();
				subs.delete(key);
			}
		}
		for (const key of keys) {
			if (!subs.has(key)) {
				subs.set(key, subscribeGame(key, listener));
				if (!initial) dirty = true;
			}
		}
	};
	const onAbort = () => wake?.();
	signal?.addEventListener('abort', onAbort);
	try {
		sync(true);
		while (!signal?.aborted) {
			if (!dirty) {
				await new Promise<void>((resolve) => (wake = resolve));
				wake = null;
				if (signal?.aborted) break;
			}
			dirty = false;
			yield;
			sync(false);
		}
	} finally {
		for (const unsubscribe of subs.values()) unsubscribe();
		subs.clear();
		signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * Yields once immediately, then once per change (bursts are coalesced: if several changes
 * happen while the consumer is busy, it wakes once). Ends when `signal` aborts or the consumer
 * stops iterating (`return()` from `for await` / client disconnect).
 *
 * Pass the request's abort signal from live queries: Kit's `generator.return()` cannot
 * interrupt a pending `await`, so the signal is what wakes and ends an idle stream.
 */
export function gameChanges(gameId: string, signal?: AbortSignal): AsyncGenerator<void> {
	return watchChannels(() => [gameId], signal);
}
