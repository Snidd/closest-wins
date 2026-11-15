/**
 * Fast path before the live query opens: canonical upper-case URL, and a phone that has not
 * joined this game goes straight to `/join/CODE` (no flash of the player screen). Everything
 * else (including a token that stops being valid later) is decided by `playerState(code)`.
 */
import { redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { JoinCodeSchema } from '#lib/game/types.ts';
import { getPlayerToken } from '#lib/server/auth/index.ts';
import { findPlayerByToken } from '#lib/server/game/engine.ts';
import { resolvePlayerGame } from '#lib/server/game/views.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const parsed = v.safeParse(JoinCodeSchema, params.code);
	if (!parsed.success) {
		return { code: params.code.trim().toUpperCase().slice(0, 12), valid: false };
	}
	const code = parsed.output;
	if (code !== params.code) redirect(308, `/play/${code}`);

	const tokenFor = (gameId: string) => getPlayerToken(cookies, gameId);
	const game = await resolvePlayerGame(code, tokenFor);
	if (game && game.phase !== 'finished' && !(await findPlayerByToken(game.id, tokenFor(game.id)))) {
		redirect(303, `/join/${code}`);
	}
	return { code, valid: true };
};
