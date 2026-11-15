/**
 * Client clock helpers. Snapshots carry `serverNow`; compute the offset when a snapshot arrives
 * and use it for every countdown until the next snapshot.
 */

/** `serverNow - clientNow`, in ms. Add it to `Date.now()` to get the server's time. */
export function clockOffset(serverNow: number, clientNow: number = Date.now()): number {
	return serverNow - clientNow;
}

/** Milliseconds left until `endsAt` (server clock), never negative. */
export function remainingMs(endsAt: number, offsetMs: number, clientNow: number = Date.now()): number {
	return Math.max(0, endsAt - (clientNow + offsetMs));
}
