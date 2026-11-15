/**
 * Static file responses from a root directory with HTTP Range (single range), ETag /
 * If-None-Match, If-Range, HEAD and path-traversal protection. PMTiles depends on Range.
 * No `$app/*` imports so it can be unit tested directly.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const CONTENT_TYPES: Record<string, string> = {
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
	'.pmtiles': 'application/vnd.pmtiles',
	'.pbf': 'application/x-protobuf',
	'.mvt': 'application/vnd.mapbox-vector-tile',
	'.json': 'application/json',
	'.bin': 'application/octet-stream'
};

export interface ServeOptions {
	/** Value of the Cache-Control header. */
	cacheControl: string;
}

const SEGMENT_OK = /^[A-Za-z0-9._-]+$/;

/**
 * Resolves `relPath` (URL-decoded, `/`-separated) inside `root`, or null if it is unsafe:
 * empty / dot / dot-dot segments, characters outside `[A-Za-z0-9._-]`, hidden files, or a
 * symlink pointing outside the root.
 */
export async function resolveSafePath(root: string, relPath: string): Promise<string | null> {
	const segments = relPath.split('/');
	if (segments.length === 0 || segments.length > 8) return null;
	for (const s of segments) {
		if (!s || s === '.' || s === '..' || s.startsWith('.') || !SEGMENT_OK.test(s)) return null;
	}
	const absRoot = path.resolve(root);
	const candidate = path.resolve(absRoot, ...segments);
	if (!candidate.startsWith(absRoot + path.sep)) return null;
	try {
		const [realRoot, realFile] = await Promise.all([realpath(absRoot), realpath(candidate)]);
		if (!realFile.startsWith(realRoot + path.sep)) return null;
		return realFile;
	} catch {
		return null;
	}
}

type ByteRange = { start: number; end: number };

/** Parses a single `bytes=` range. Returns 'unsatisfiable', null (ignore → full body) or a range. */
export function parseRange(header: string, size: number): ByteRange | 'unsatisfiable' | null {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null; // multi-range or malformed: serve the full file (allowed by RFC 9110)
	const [, a, b] = m;
	if (a === '' && b === '') return null;
	let start: number;
	let end: number;
	if (a === '') {
		const suffix = Number(b);
		if (suffix === 0) return 'unsatisfiable';
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(a);
		end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
		if (b !== '' && Number(b) < start) return null;
	}
	if (start >= size || size === 0) return 'unsatisfiable';
	return { start, end };
}

function etagMatches(header: string | null, etag: string): boolean {
	if (!header) return false;
	if (header.trim() === '*') return true;
	const weak = (t: string) => t.trim().replace(/^W\//, '');
	return header.split(',').some((t) => weak(t) === weak(etag));
}

const notFound = () => new Response('Not found', { status: 404 });

export async function serveFile(
	request: Request,
	root: string,
	relPath: string,
	options: ServeOptions
): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
	}
	const file = await resolveSafePath(root, relPath);
	if (!file) return notFound();

	let info;
	try {
		info = await stat(file);
	} catch {
		return notFound();
	}
	if (!info.isFile()) return notFound();

	const size = info.size;
	const etag = `W/"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
	const headers = new Headers({
		'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
		'accept-ranges': 'bytes',
		'cache-control': options.cacheControl,
		etag,
		'last-modified': info.mtime.toUTCString(),
		'x-content-type-options': 'nosniff'
	});

	if (etagMatches(request.headers.get('if-none-match'), etag)) {
		return new Response(null, { status: 304, headers });
	}

	let range: ByteRange | 'unsatisfiable' | null = null;
	const rangeHeader = request.headers.get('range');
	const ifRange = request.headers.get('if-range');
	if (rangeHeader && (!ifRange || etagMatches(ifRange, etag))) {
		range = parseRange(rangeHeader, size);
	}

	if (range === 'unsatisfiable') {
		headers.set('content-range', `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}

	const start = range?.start ?? 0;
	const end = range?.end ?? size - 1;
	const length = size === 0 ? 0 : end - start + 1;
	headers.set('content-length', String(length));
	if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);
	const status = range ? 206 : 200;

	if (request.method === 'HEAD' || length === 0) {
		return new Response(null, { status, headers });
	}

	const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
	return new Response(stream, { status, headers });
}
