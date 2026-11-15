/**
 * Who is connected: counts open live streams per (game, client). A player/TV is "connected"
 * while at least one of its streams is open. Used by views and by the engine's "everyone
 * connected has locked in" rule (the engine listens with `onPresenceChange`).
 *
 * Usage inside a live query generator:
 * ```ts
 * const leave = enterPresence(gameId, `player:${playerId}`);
 * try { ... yield ... } finally { leave(); }
 * ```
 */
import { notifyGame } from './events.ts';

export type PresenceKey = `player:${string}` | `tv:${string}` | `host:${string}`;

type PresenceListener = (gameId: string, key: PresenceKey, connected: boolean) => void;

const counts = new Map<string, Map<PresenceKey, number>>();
const presenceListeners = new Set<PresenceListener>();

/** Called after a client's first stream opens or its last stream closes. */
export function onPresenceChange(listener: PresenceListener): () => void {
	presenceListeners.add(listener);
	return () => presenceListeners.delete(listener);
}

function changed(gameId: string, key: PresenceKey, connected: boolean) {
	notifyGame(gameId);
	for (const l of [...presenceListeners]) {
		try {
			l(gameId, key, connected);
		} catch (e) {
			console.error('[presence] listener failed', e);
		}
	}
}

/** Marks a stream as open; returns a function that marks it closed (idempotent). */
export function enterPresence(gameId: string, key: PresenceKey): () => void {
	let game = counts.get(gameId);
	if (!game) counts.set(gameId, (game = new Map()));
	const before = game.get(key) ?? 0;
	game.set(key, before + 1);
	if (before === 0) changed(gameId, key, true);

	let left = false;
	return () => {
		if (left) return;
		left = true;
		const g = counts.get(gameId);
		if (!g) return;
		const n = (g.get(key) ?? 1) - 1;
		if (n <= 0) {
			g.delete(key);
			if (g.size === 0) counts.delete(gameId);
			changed(gameId, key, false);
		} else {
			g.set(key, n);
		}
	};
}

export function isPresent(gameId: string, key: PresenceKey): boolean {
	return (counts.get(gameId)?.get(key) ?? 0) > 0;
}

/** Ids of connected players in a game. */
export function connectedPlayerIds(gameId: string): Set<string> {
	const ids = new Set<string>();
	for (const key of counts.get(gameId)?.keys() ?? []) {
		if (key.startsWith('player:')) ids.add(key.slice('player:'.length));
	}
	return ids;
}

/** Number of open streams over all games (leak checks in tests). */
export function totalPresenceCount(): number {
	let n = 0;
	for (const g of counts.values()) for (const c of g.values()) n += c;
	return n;
}
