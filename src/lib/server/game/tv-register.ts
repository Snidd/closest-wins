/**
 * TV registration shared by the web TV (`registerTv` remote command, cookie) and the native
 * TV app (`/tv/native/register`, bearer token): an already registered screen keeps its id; new
 * screens are rate limited per client address, since each one creates a `tv_screen` row.
 */
import { error } from '@sveltejs/kit';
import { tvRegisterLimiter } from '#lib/server/auth/index.ts';
import { registerTv, resolveTv } from './engine.ts';

/**
 * `engine.registerTv` behind the new-screen limit. Throws `error(429)` when this address made
 * too many new screens. `token` is non-null only when a new screen was created.
 */
export async function registerTvScreen(
	existingToken: string | null,
	clientAddress: string
): Promise<{ tvId: string; token: string | null }> {
	if (!existingToken || !(await resolveTv(existingToken))) {
		const key = `tv:${clientAddress}`;
		const limit = tvRegisterLimiter.check(key);
		if (!limit.allowed) error(429, 'Too many new screens from this address; try again later');
		tvRegisterLimiter.fail(key);
	}
	return registerTv(existingToken);
}

/** The token of `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: Request): string | null {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
	return match?.[1] ?? null;
}
