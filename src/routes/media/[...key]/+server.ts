import type { RequestHandler } from './$types';
import { mediaDir } from '#lib/server/files/paths.ts';
import { serveFile } from '#lib/server/files/serve.ts';

/** Photo variants. Keys are random and files never change, so cache forever. */
export const GET: RequestHandler = ({ request, params }) =>
	serveFile(request, mediaDir(), params.key, {
		cacheControl: 'public, max-age=31536000, immutable'
	});
