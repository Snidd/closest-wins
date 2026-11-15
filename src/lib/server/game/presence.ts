/**
 * Who is connected: counts open live streams per (game, client). A player/TV is "connected"
 * while at least one of its streams is open. Implemented in Wave 0; used by views and by the
 * engine's "everyone connected has locked in" rule.
 *
 * Usage inside a live query generator:
 * ```ts
 * const leave = enterPresence(gameId, `player:${playerId}`);
 * try { ... yield ... } finally { leave(); }
 * ```
 */
import { notifyGame } from './events.ts';

export type PresenceKey = `player:${string}` | `tv:${string}` | `host:${string}`;

const counts = new Map<string, Map<PresenceKey, number>>();

/** Marks a stream as open; returns a function that marks it closed (idempotent). */
export function enterPresence(gameId: string, key: PresenceKey): () => void {
	let game = counts.get(gameId);
	if (!game) counts.set(gameId, (game = new Map()));
	const before = game.get(key) ?? 0;
	game.set(key, before + 1);
	if (before === 0) notifyGame(gameId);

	let left = false;
	return () => {
		if (left) return;
		left = true;
		const g = counts.get(gameId);
		const n = (g?.get(key) ?? 1) - 1;
		if (!g) return;
		if (n <= 0) {
			g.delete(key);
			if (g.size === 0) counts.delete(gameId);
			notifyGame(gameId);
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
