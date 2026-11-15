import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { client } from '#lib/server/db/index.ts';
import { isAdminSession } from '#lib/server/auth/index.ts';
import { detectLocale } from '#lib/i18n/locale.ts';
import { initEngine, resetEngineMemory } from '#lib/server/game/engine.ts';
import { endAllStreams } from '#lib/server/game/events.ts';
import { surfaceFor, viewportFor } from '#lib/surface.ts';

/**
 * Production shutdown (adapter-node): on SIGTERM/SIGINT adapter-node stops accepting
 * connections and waits for open requests, but live event streams never finish by themselves,
 * so end them at once (clients reconnect to the next process). Once the HTTP server has closed
 * (`sveltekit:shutdown`), drop the round timers (the next process re-arms them from Postgres)
 * and close the database pool so the process exits.
 */
function handleShutdown() {
	const end = () => {
		console.log('[shutdown] ending live streams');
		endAllStreams();
	};
	process.once('SIGTERM', end);
	process.once('SIGINT', end);
	// adapter-node emits this custom event after the HTTP server closed.
	(process as NodeJS.EventEmitter).once('sveltekit:shutdown', () => {
		resetEngineMemory();
		void client.end({ timeout: 5 }).then(() => console.log('[shutdown] done'));
	});
}

export const init: ServerInit = async () => {
	if (building) return;
	if (!dev) handleShutdown();
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
