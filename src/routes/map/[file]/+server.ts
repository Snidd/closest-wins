import type { RequestHandler } from './$types';
import { mapDir } from '#lib/server/files/paths.ts';
import { serveFile } from '#lib/server/files/serve.ts';

/** Map tiles (world.pmtiles), read by PMTiles with Range requests. May be replaced on disk. */
export const GET: RequestHandler = ({ request, params }) =>
	serveFile(request, mapDir(), params.file, {
		cacheControl: 'public, max-age=3600, must-revalidate'
	});
