/** Pure crypto helpers (no env access), unit tested in auth.test.ts. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Constant-time string comparison. Both sides are hashed first so the comparison time does not
 * depend on the input length either.
 */
export function constantTimeEqual(a: string, b: string): boolean {
	return timingSafeEqual(sha256(a), sha256(b));
}

// --- Opaque tokens (players, TVs) ---------------------------------------------------------------

/** A new random token for the client and the hash to store. Never store the token itself. */
export function mintToken(): { token: string; hash: string } {
	const token = randomBytes(32).toString('base64url');
	return { token, hash: hashToken(token) };
}

/** SHA-256 hex of a token, as stored in `player.token_hash` / `tv_screen.token_hash`. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Rough shape check before touching the database. */
export function isPlausibleToken(token: string | undefined | null): token is string {
	return typeof token === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

// --- Signed admin session ------------------------------------------------------------------------

const SESSION_VERSION = 'v1';

function sign(secret: string, payload: string): string {
	return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/** `v1.<expiresAtMs>.<nonce>.<hmac>` */
export function createSessionValue(secret: string, ttlMs: number, now: number = Date.now()): string {
	const payload = `${SESSION_VERSION}.${now + ttlMs}.${randomBytes(12).toString('base64url')}`;
	return `${payload}.${sign(secret, payload)}`;
}

export function verifySessionValue(
	secret: string,
	value: string | undefined | null,
	now: number = Date.now()
): boolean {
	if (!value) return false;
	const parts = value.split('.');
	if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return false;
	const payload = parts.slice(0, 3).join('.');
	if (!constantTimeEqual(sign(secret, payload), parts[3]!)) return false;
	const expiresAt = Number(parts[1]);
	return Number.isFinite(expiresAt) && expiresAt > now;
}
