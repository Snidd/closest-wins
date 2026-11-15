/**
 * Join page state. The QR code on the TV points here, so keep this cheap: one game lookup, one
 * player-token check, one player count.
 *
 * - `notFound`  no unfinished game with this code (or the code is not a valid code at all)
 * - `full`      `MAX_PLAYERS` non-kicked players already joined
 * - `open`      show the nickname form
 * - `unchecked` the engine lookup is not available (still a stub): show the form and let the
 *               `joinGame` form's issues / errors be the source of truth
 * A phone that already has a valid player token for this game is redirected to `/play/CODE`.
 */
import { redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, count, eq } from 'drizzle-orm';
import { JoinCodeSchema, MAX_PLAYERS } from '#lib/game/types.ts';
import { findGameByCode, resolvePlayer } from '#lib/server/game/engine.ts';
import { getPlayerToken } from '#lib/server/auth/index.ts';
import { db, schema } from '#lib/server/db/index.ts';
import type { Game } from '#lib/server/db/schema.ts';
import type { PageServerLoad } from './$types';

export type JoinState = 'open' | 'unchecked' | 'notFound' | 'full';

const isNotImplemented = (e: unknown) =>
	e instanceof Error && e.message.startsWith('Not implemented');

export const load: PageServerLoad = async ({ params, cookies }) => {
	const parsed = v.safeParse(JoinCodeSchema, params.code);
	if (!parsed.success) {
		return { code: params.code.trim().toUpperCase().slice(0, 12), state: 'notFound' as JoinState };
	}
	const code = parsed.output;
	// QR codes and people may use lower case; keep one canonical URL.
	if (code !== params.code) redirect(308, `/join/${code}`);

	let game: Game | null;
	try {
		game = await findGameByCode(code);
	} catch (e) {
		if (isNotImplemented(e)) return { code, state: 'unchecked' as JoinState };
		throw e;
	}
	if (!game || game.phase === 'finished') return { code, state: 'notFound' as JoinState };

	// Already in this game on this phone (refresh, rescanned QR, back button).
	let alreadyJoined = false;
	try {
		alreadyJoined = !!(await resolvePlayer(game.id, getPlayerToken(cookies, game.id)));
	} catch (e) {
		if (!isNotImplemented(e)) throw e;
	}
	if (alreadyJoined) redirect(303, `/play/${code}`);

	const [row] = await db
		.select({ n: count() })
		.from(schema.player)
		.where(and(eq(schema.player.gameId, game.id), eq(schema.player.kicked, false)));
	if ((row?.n ?? 0) >= MAX_PLAYERS) return { code, state: 'full' as JoinState };

	return { code, state: 'open' as JoinState };
};
