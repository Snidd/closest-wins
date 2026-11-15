import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { isAdminSession } from '#lib/server/auth/index.ts';
import { detectLocale } from '#lib/i18n/locale.ts';
import { initEngine } from '#lib/server/game/engine.ts';
import { surfaceFor, viewportFor } from '#lib/surface.ts';

export const init: ServerInit = async () => {
	if (building) return;
	// Re-arm timers of rounds that were running when the process stopped.
	try {
		await initEngine();
	} catch (e) {
		console.error('[engine] init failed', e);
	}
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.admin = isAdminSession(event.cookies);
	event.locals.locale = detectLocale(event.request.headers.get('accept-language'));

	const surface = surfaceFor(event.route.id);
	const viewport = viewportFor(surface);

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace('%cw.lang%', event.locals.locale)
				.replace('%cw.surface%', surface)
				.replace('%cw.viewport%', viewport)
	});
};
