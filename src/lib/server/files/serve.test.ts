import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRange, resolveSafePath, serveFile } from './serve.ts';

let root: string;
let outside: string;
const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
const opts = { cacheControl: 'public, max-age=60' };
const req = (headers: Record<string, string> = {}, method = 'GET') =>
	new Request('http://localhost/map/x', { method, headers });

beforeAll(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'cw-serve-'));
	outside = await mkdtemp(path.join(tmpdir(), 'cw-outside-'));
	await mkdir(path.join(root, 'sub'));
	await writeFile(path.join(root, 'sub', 'file.bin'), bytes);
	await writeFile(path.join(root, 'empty.bin'), new Uint8Array());
	await writeFile(path.join(outside, 'secret.txt'), 'secret');
	await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

describe('parseRange', () => {
	it('parses single ranges', () => {
		expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
		expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
		expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
	});

	it('flags unsatisfiable and ignores malformed / multi ranges', () => {
		expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
		expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
		expect(parseRange('bytes=5-1', 1000)).toBeNull();
		expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
		expect(parseRange('items=0-1', 1000)).toBeNull();
	});
});

describe('serveFile', () => {
	it('serves the whole file with caching headers', async () => {
		const res = await serveFile(req(), root, 'sub/file.bin', opts);
		expect(res.status).toBe(200);
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('content-length')).toBe('1000');
		expect(res.headers.get('cache-control')).toBe('public, max-age=60');
		expect(res.headers.get('etag')).toMatch(/^W\/".+"$/);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
	});

	it('returns 206 with exactly the requested bytes', async () => {
		const res = await serveFile(req({ range: 'bytes=100-199' }), root, 'sub/file.bin', opts);
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
		expect(res.headers.get('content-length')).toBe('100');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.slice(100, 200));

		const tail = await serveFile(req({ range: 'bytes=-10' }), root, 'sub/file.bin', opts);
		expect(tail.status).toBe(206);
		expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(990));
	});

	it('returns 416 for unsatisfiable ranges', async () => {
		const res = await serveFile(req({ range: 'bytes=5000-' }), root, 'sub/file.bin', opts);
		expect(res.status).toBe(416);
		expect(res.headers.get('content-range')).toBe('bytes */1000');
	});

	it('honours If-None-Match and If-Range', async () => {
		const first = await serveFile(req(), root, 'sub/file.bin', opts);
		const etag = first.headers.get('etag')!;
		await first.arrayBuffer();

		const notModified = await serveFile(req({ 'if-none-match': etag }), root, 'sub/file.bin', opts);
		expect(notModified.status).toBe(304);

		const stale = await serveFile(
			req({ range: 'bytes=0-9', 'if-range': 'W/"other"' }),
			root,
			'sub/file.bin',
			opts
		);
		expect(stale.status).toBe(200);
		await stale.arrayBuffer();

		const fresh = await serveFile(req({ range: 'bytes=0-9', 'if-range': etag }), root, 'sub/file.bin', opts);
		expect(fresh.status).toBe(206);
		await fresh.arrayBuffer();
	});

	it('answers HEAD without a body', async () => {
		const res = await serveFile(req({ range: 'bytes=0-9' }, 'HEAD'), root, 'sub/file.bin', opts);
		expect(res.status).toBe(206);
		expect(res.headers.get('content-length')).toBe('10');
		expect(res.body).toBeNull();
	});

	it('serves empty files', async () => {
		const res = await serveFile(req(), root, 'empty.bin', opts);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-length')).toBe('0');
	});

	it('rejects path traversal, hidden files, directories and escaping symlinks', async () => {
		for (const bad of ['../x', 'sub/../../etc/passwd', '..', '', 'sub', '.env', 'sub//file.bin', 'a\\b', 'link.txt', '%2e%2e/x', 'missing.bin']) {
			const res = await serveFile(req(), root, bad, opts);
			expect(res.status, bad).toBe(404);
		}
		expect(await resolveSafePath(root, '/etc/passwd')).toBeNull();
	});

	it('rejects other methods', async () => {
		const res = await serveFile(req({}, 'POST'), root, 'sub/file.bin', opts);
		expect(res.status).toBe(405);
	});
});
