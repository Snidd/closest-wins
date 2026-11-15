/**
 * In-process change notification per game (single Node process by design). The engine calls
 * `notifyGame(gameId)` after every committed state change; live queries iterate `gameChanges`.
 * Implemented in Wave 0; the engine owner may extend it.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeGame(gameId: string, listener: Listener): () => void {
	let set = listeners.get(gameId);
	if (!set) listeners.set(gameId, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0 && listeners.get(gameId) === set) listeners.delete(gameId);
	};
}

/** Wake every subscriber of the game. Cheap; call after each committed change. */
export function notifyGame(gameId: string): void {
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

export function subscriberCount(gameId: string): number {
	return listeners.get(gameId)?.size ?? 0;
}

/**
 * Yields once immediately, then once per change (bursts are coalesced: if several changes
 * happen while the consumer is busy, it wakes once). Ends when `signal` aborts or the consumer
 * stops iterating (`return()` from `for await` / client disconnect).
 *
 * ```ts
 * export const hostState = query.live(HostStateArgSchema, async function* (gameId) {
 * 	for await (const _ of gameChanges(gameId)) yield await buildHostSnapshot(gameId);
 * });
 * ```
 */
export async function* gameChanges(gameId: string, signal?: AbortSignal): AsyncGenerator<void> {
	let dirty = true;
	let wake: (() => void) | null = null;
	const unsubscribe = subscribeGame(gameId, () => {
		dirty = true;
		wake?.();
	});
	const onAbort = () => wake?.();
	signal?.addEventListener('abort', onAbort);
	try {
		while (!signal?.aborted) {
			if (!dirty) {
				await new Promise<void>((resolve) => (wake = resolve));
				wake = null;
				if (signal?.aborted) break;
			}
			dirty = false;
			yield;
		}
	} finally {
		unsubscribe();
		signal?.removeEventListener('abort', onAbort);
	}
}
