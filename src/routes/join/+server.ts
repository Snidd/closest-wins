/**
 * No-JavaScript fallback for the landing page's code form (`GET /join?code=ab cd`): normalises
 * the code and redirects to `/join/ABCD`, or back to the landing page if it cannot be a code.
 */
import { redirect } from '@sveltejs/kit';
import { normalizeJoinCode } from './join-code.ts';
import { JOIN_CODE_LENGTH } from '#lib/game/types.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const raw = url.searchParams.get('code') ?? '';
	const code = normalizeJoinCode(raw);
	if (code.length === JOIN_CODE_LENGTH) redirect(303, `/join/${code}`);
	redirect(303, `/?code=${encodeURIComponent(raw.slice(0, 20))}`);
};
