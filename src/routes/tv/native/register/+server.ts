import { isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bearerToken, registerTvScreen } from '#lib/server/game/tv-register.ts';

/**
 * Registers a native TV app (Apple TV), the plain-JSON twin of the `registerTv` remote command.
 *
 * `POST /tv/native/register`, optional `Authorization: Bearer <token>`. Send
 * `Content-Type: application/json` (body `{}` or empty): Kit rejects a POST without an `Origin`
 * header whose content type is missing or form-like as cross-site (403).
 *
 * 200 `{ tvId, token }`: `token` is a newly minted token (store it, send it as the bearer from
 * now on) or `null` when the sent token is still valid (keep using it). A screen gets a pairing
 * code either way. 429 `{ message }` after too many new screens from this address.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		const { tvId, token } = await registerTvScreen(bearerToken(request), getClientAddress());
		return Response.json({ tvId, token }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		if (isHttpError(e)) return Response.json({ message: e.body.message }, { status: e.status });
		throw e;
	}
};
