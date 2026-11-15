import http from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentError } from '../content/errors.ts';
import { fetchRemoteImage, isForbiddenAddress, sniffImageType, type FetchImageOptions } from './import.ts';

describe('isForbiddenAddress', () => {
	it.each([
		// IPv4
		'0.0.0.0',
		'10.0.0.1',
		'10.255.255.255',
		'100.64.0.1',
		'100.127.255.254',
		'127.0.0.1',
		'127.8.9.10',
		'169.254.169.254',
		'169.254.0.1',
		'172.16.0.1',
		'172.31.255.255',
		'192.0.0.8',
		'192.0.2.1',
		'192.168.1.1',
		'198.18.0.1',
		'198.51.100.7',
		'203.0.113.9',
		'224.0.0.1',
		'239.255.255.250',
		'240.0.0.1',
		'255.255.255.255',
		// IPv6
		'::',
		'::1',
		'[::1]',
		'fe80::1',
		'fe80::1%eth0',
		'febf::1',
		'fec0::1',
		'fc00::1',
		'fd12:3456:789a::1',
		'ff02::1',
		'ff0e::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:169.254.169.254',
		'::ffff:a9fe:a9fe',
		'::ffff:10.0.0.1',
		'::ffff:0:192.168.0.1',
		'::127.0.0.1',
		'64:ff9b::127.0.0.1',
		'64:ff9b::a9fe:a9fe',
		'64:ff9b:1::1',
		'2002:7f00:1::1',
		'2002:c0a8:101::1',
		'2001::1',
		'2001:db8::1',
		'3fff::1',
		'100::1',
		// Garbage
		'',
		'localhost',
		'example.com',
		'1.2.3',
		'256.1.1.1',
		'::ffff:999.0.0.1'
	])('forbids %s', (ip) => {
		expect(isForbiddenAddress(ip)).toBe(true);
	});

	it.each([
		'1.1.1.1',
		'8.8.8.8',
		'93.184.216.34',
		'172.15.255.255',
		'172.32.0.1',
		'100.63.255.255',
		'100.128.0.1',
		'169.253.255.255',
		'192.169.0.1',
		'223.255.255.255',
		'2606:4700:4700::1111',
		'2a00:1450:4001:80b::200e',
		'2620:0:862:ed1a::1',
		'::ffff:8.8.8.8',
		'64:ff9b::808:808',
		'2002:808:808::1'
	])('allows %s', (ip) => {
		expect(isForbiddenAddress(ip)).toBe(false);
	});
});

describe('sniffImageType', () => {
	it('recognises real images and refuses others', async () => {
		const img = sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } });
		expect(sniffImageType(await img.clone().jpeg().toBuffer())).toBe('image/jpeg');
		expect(sniffImageType(await img.clone().png().toBuffer())).toBe('image/png');
		expect(sniffImageType(await img.clone().webp().toBuffer())).toBe('image/webp');
		expect(sniffImageType(await img.clone().gif().toBuffer())).toBe('image/gif');
		expect(sniffImageType(await img.clone().tiff().toBuffer())).toBe('image/tiff');
		expect(sniffImageType(await img.clone().avif().toBuffer())).toBe('image/avif');
		expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
		expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull();
		expect(sniffImageType(new Uint8Array())).toBeNull();
	});
});

describe('fetchRemoteImage', () => {
	let server: http.Server;
	let port: number;
	let png: Buffer;
	const seenHosts: string[] = [];

	beforeAll(async () => {
		png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0a0' } }).png().toBuffer();
		server = http.createServer((req, res) => {
			seenHosts.push(req.headers.host ?? '');
			const url = new URL(req.url ?? '/', 'http://x');
			switch (url.pathname) {
				case '/img.png':
					res.writeHead(200, { 'content-type': 'image/png' });
					return res.end(png);
				case '/redirect':
					res.writeHead(302, { location: '/img.png' });
					return res.end();
				case '/redirect-metadata':
					res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
					return res.end();
				case '/redirect-mapped':
					res.writeHead(301, { location: 'http://[::ffff:7f00:1]/img.png' });
					return res.end();
				case '/redirect-file':
					res.writeHead(302, { location: 'file:///etc/passwd' });
					return res.end();
				case '/loop':
					res.writeHead(302, { location: '/loop' });
					return res.end();
				case '/html':
					res.writeHead(200, { 'content-type': 'text/html' });
					return res.end('<html></html>');
				case '/lying':
					res.writeHead(200, { 'content-type': 'image/png' });
					return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
				case '/big-declared':
					res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(10_000_000) });
					return res.end();
				case '/big-streamed': {
					res.writeHead(200, { 'content-type': 'image/png' });
					const chunk = Buffer.alloc(64 * 1024, 1);
					let sent = 0;
					const pump = () => {
						while (sent < 2_000_000) {
							sent += chunk.length;
							if (!res.write(chunk)) return res.once('drain', pump);
						}
						res.end();
					};
					return pump();
				}
				case '/slow':
					res.writeHead(200, { 'content-type': 'image/png' });
					res.write(png.subarray(0, 10));
					return; // never ends
				case '/404':
					res.writeHead(404);
					return res.end();
				default:
					res.writeHead(500);
					return res.end();
			}
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		server.closeAllConnections();
		await new Promise((r) => server.close(r));
	});

	/**
	 * Test policy: "images.test" resolves to 127.0.0.1 and only that exact address is allowed;
	 * everything else goes through the real guard.
	 */
	const opts = (extra: FetchImageOptions = {}): FetchImageOptions => ({
		resolveHost: async (host) => {
			if (host === 'images.test') return [{ address: '127.0.0.1', family: 4 }];
			throw new Error('NXDOMAIN');
		},
		isForbidden: (ip) => ip !== '127.0.0.1' && isForbiddenAddress(ip),
		...extra
	});
	const base = () => `http://images.test:${port}`;

	const failsWith = async (p: Promise<unknown>, pattern: RegExp) => {
		const err = await p.then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(ContentError);
		expect((err as ContentError).code).toBe('IMPORT_FAILED');
		expect((err as ContentError).message).toMatch(pattern);
	};

	it('downloads an image, connecting to the validated address with the original Host', async () => {
		const res = await fetchRemoteImage(`${base()}/img.png`, opts());
		expect(res.contentType).toBe('image/png');
		expect(Buffer.from(res.bytes).equals(png)).toBe(true);
		expect(seenHosts.at(-1)).toBe(`images.test:${port}`);
	});

	it('follows same-origin redirects and reports the final URL', async () => {
		const res = await fetchRemoteImage(`${base()}/redirect`, opts());
		expect(res.finalUrl).toBe(`${base()}/img.png`);
	});

	it('refuses loopback / private targets with the default guard', async () => {
		await failsWith(fetchRemoteImage(`http://127.0.0.1:${port}/img.png`), /not allowed/);
		await failsWith(fetchRemoteImage(`http://[::1]:${port}/img.png`), /not allowed/);
		await failsWith(fetchRemoteImage('http://169.254.169.254/latest/meta-data/'), /not allowed/);
		await failsWith(fetchRemoteImage('http://[::ffff:127.0.0.1]/'), /not allowed/);
		await failsWith(fetchRemoteImage('http://0x7f.1/'), /not allowed/); // WHATWG URL → 127.0.0.1
		await failsWith(fetchRemoteImage('http://2130706433/'), /not allowed/); // → 127.0.0.1
	});

	it('refuses hosts whose DNS answer contains a private address', async () => {
		await failsWith(
			fetchRemoteImage(`http://mixed.test:${port}/img.png`, {
				resolveHost: async () => [
					{ address: '93.184.216.34', family: 4 },
					{ address: '10.0.0.5', family: 4 }
				]
			}),
			/not allowed/
		);
	});

	it('re-validates every redirect hop', async () => {
		await failsWith(fetchRemoteImage(`${base()}/redirect-metadata`, opts()), /not allowed/);
		await failsWith(fetchRemoteImage(`${base()}/redirect-mapped`, opts()), /not allowed/);
		await failsWith(fetchRemoteImage(`${base()}/redirect-file`, opts()), /http and https/);
		await failsWith(fetchRemoteImage(`${base()}/loop`, opts()), /Too many redirects/);
	});

	it('refuses other schemes and credentials', async () => {
		await failsWith(fetchRemoteImage('file:///etc/passwd'), /http and https/);
		await failsWith(fetchRemoteImage('ftp://example.com/a.png'), /http and https/);
		await failsWith(fetchRemoteImage('http://user:pw@example.com/a.png'), /credentials/);
		await failsWith(fetchRemoteImage('not a url'), /Invalid URL/);
	});

	it('checks the content type and sniffs the bytes', async () => {
		await failsWith(fetchRemoteImage(`${base()}/html`, opts()), /Not an image/);
		await failsWith(fetchRemoteImage(`${base()}/lying`, opts()), /not a supported image/);
		await failsWith(fetchRemoteImage(`${base()}/404`, opts()), /404/);
	});

	it('enforces the size cap from the header and while streaming', async () => {
		await failsWith(fetchRemoteImage(`${base()}/big-declared`, opts({ maxBytes: 1_000_000 })), /larger than/);
		await failsWith(fetchRemoteImage(`${base()}/big-streamed`, opts({ maxBytes: 1_000_000 })), /larger than/);
	});

	it('times out', async () => {
		await failsWith(fetchRemoteImage(`${base()}/slow`, opts({ timeoutMs: 300 })), /timed out/);
	});
});
