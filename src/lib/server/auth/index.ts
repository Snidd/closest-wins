/**
 * Authentication for the three kinds of callers:
 * - admin (host + admin UI): one shared password → HMAC-signed session cookie;
 * - players: opaque per-game token in a cookie, only its hash is stored (`player.token_hash`);
 * - TVs: opaque token in a cookie, only its hash is stored (`tv_screen.token_hash`).
 *
 * Remote functions can be called from any page, so every remote function checks its caller
 * itself (`requireAdmin()`, or a token lookup in the game engine).
 */
import { error, redirect, type Cookies } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { ADMIN_PASSWORD, SESSION_SECRET } from '$app/env/private';
import { constantTimeEqual, createSessionValue, verifySessionValue } from './crypto.ts';

export { mintToken, hashToken, isPlausibleToken, constantTimeEqual } from './crypto.ts';
export { joinLimiter, loginLimiter, RateLimiter, tvRegisterLimiter } from './rate-limit.ts';
export { safeNext } from './redirect.ts';

export const ADMIN_COOKIE = 'cw_admin';
export const TV_COOKIE = 'cw_tv';
const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

/**
 * Cookies are `Secure` whenever the app is served over HTTPS. Plain-HTTP deployments on a home
 * LAN would otherwise be unable to log in at all.
 */
function cookieOptions(url: URL, maxAgeSeconds: number) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge: maxAgeSeconds
	};
}

// --- Admin -------------------------------------------------------------------------------------

export function checkAdminPassword(input: string): boolean {
	return constantTimeEqual(input, ADMIN_PASSWORD);
}

export function isAdminSession(cookies: Cookies): boolean {
	return verifySessionValue(SESSION_SECRET, cookies.get(ADMIN_COOKIE));
}

export function startAdminSession(cookies: Cookies, url: URL): void {
	cookies.set(
		ADMIN_COOKIE,
		createSessionValue(SESSION_SECRET, ADMIN_SESSION_TTL_MS),
		cookieOptions(url, ADMIN_SESSION_TTL_MS / 1000)
	);
}

export function endAdminSession(cookies: Cookies): void {
	cookies.delete(ADMIN_COOKIE, { path: '/' });
}

/** For remote functions and endpoints: throws 401 unless the caller is the admin. */
export function requireAdmin(): void {
	const { locals } = getRequestEvent();
	if (!locals.admin) error(401, 'Admin login required');
}

/** For server `load` functions of protected pages: redirects to `/login?next=…`. */
export function requireAdminPage(url: URL, locals: App.Locals): void {
	if (!locals.admin) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}

// --- Players -----------------------------------------------------------------------------------

/** One cookie per game, so a phone can be in several games' history without clashes. */
export function playerCookieName(gameId: string): string {
	return `cw_p_${gameId.replaceAll('-', '')}`;
}

export function getPlayerToken(cookies: Cookies, gameId: string): string | null {
	return cookies.get(playerCookieName(gameId)) ?? null;
}

/** Only callable from `form`/`command` remote functions or endpoints (queries cannot set cookies). */
export function setPlayerToken(cookies: Cookies, url: URL, gameId: string, token: string): void {
	cookies.set(playerCookieName(gameId), token, cookieOptions(url, TOKEN_COOKIE_MAX_AGE_S));
}

export function clearPlayerToken(cookies: Cookies, gameId: string): void {
	cookies.delete(playerCookieName(gameId), { path: '/' });
}

// --- TVs ---------------------------------------------------------------------------------------

export function getTvToken(cookies: Cookies): string | null {
	return cookies.get(TV_COOKIE) ?? null;
}

/** Only callable from `form`/`command` remote functions or endpoints. */
export function setTvToken(cookies: Cookies, url: URL, token: string): void {
	cookies.set(TV_COOKIE, token, cookieOptions(url, 365 * 24 * 60 * 60));
}

export function clearTvToken(cookies: Cookies): void {
	cookies.delete(TV_COOKIE, { path: '/' });
}
