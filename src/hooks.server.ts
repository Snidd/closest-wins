import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { isAdminSession } from '#lib/server/auth/index.ts';
import { detectLocale } from '#lib/i18n/locale.ts';
import { initEngine } from '#lib/server/game/engine.ts';

/**
 * Surfaces get different page chrome: `tv` scales type for a room, `play` locks page zoom and
 * overscroll so the map owns every gesture.
 */
type Surface = 'tv' | 'play' | 'host' | 'admin' | 'default';

function surfaceFor(routeId: string | null): Surface {
	if (!routeId) return 'default';
	if (routeId === '/tv' || routeId.startsWith('/tv/')) return 'tv';
	if (routeId.startsWith('/play/') || routeId.startsWith('/dev/map')) return 'play';
	if (routeId === '/host' || routeId.startsWith('/host/')) return 'host';
	if (routeId === '/admin' || routeId.startsWith('/admin/')) return 'admin';
	return 'default';
}

const BASE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const LOCKED_VIEWPORT = `${BASE_VIEWPORT}, maximum-scale=1, user-scalable=no`;

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
	const viewport = surface === 'play' || surface === 'tv' ? LOCKED_VIEWPORT : BASE_VIEWPORT;

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace('%cw.lang%', event.locals.locale)
				.replace('%cw.surface%', surface)
				.replace('%cw.viewport%', viewport)
	});
};
