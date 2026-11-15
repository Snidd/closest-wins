/**
 * Download an image by URL for import (admin UI and MCP), with an SSRF guard:
 *
 * - http/https only, no credentials in the URL;
 * - the host is resolved and EVERY resolved address must be public (see `isForbiddenAddress`:
 *   private, loopback, link-local incl. 169.254.169.254, CGNAT, multicast, reserved,
 *   documentation, and the IPv6 equivalents incl. IPv4-mapped / NAT64 / 6to4 embeddings);
 * - the socket connects to exactly the address that was validated (custom `lookup`), so a DNS
 *   answer that changes between check and connect (rebinding) cannot redirect us;
 * - redirects are followed manually (max `MAX_REDIRECTS`) and every hop is validated again;
 * - `FETCH_TIMEOUT_MS` covers the whole download, `MAX_IMAGE_BYTES` is enforced while streaming,
 *   the Content-Type must be an allowed image type and the bytes are sniffed as well.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { ContentError } from '../content/errors.ts';
import { ALLOWED_IMAGE_TYPES, FETCH_TIMEOUT_MS, MAX_IMAGE_BYTES, MAX_REDIRECTS } from './limits.ts';

export interface FetchedImage {
	bytes: Uint8Array;
	contentType: string;
	/** URL after redirects. */
	finalUrl: string;
}

export interface ResolvedAddress {
	address: string;
	family: 4 | 6;
}

/** Overrides for tests. Production callers pass nothing. */
export interface FetchImageOptions {
	resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
	isForbidden?: (ip: string) => boolean;
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
}

const fail = (message: string): never => {
	throw new ContentError('IMPORT_FAILED', message);
};

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return null;
		const v = Number(p);
		if (v > 255) return null;
		n = n * 256 + v;
	}
	return n;
}

/** [network, prefix length] blocks an import must never reach. */
const IPV4_BLOCKS: Array<[string, number]> = [
	['0.0.0.0', 8], // "this" network
	['10.0.0.0', 8], // private
	['100.64.0.0', 10], // CGNAT
	['127.0.0.0', 8], // loopback
	['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
	['172.16.0.0', 12], // private
	['192.0.0.0', 24], // IETF protocol assignments
	['192.0.2.0', 24], // TEST-NET-1
	['192.88.99.0', 24], // 6to4 relay anycast
	['192.168.0.0', 16], // private
	['198.18.0.0', 15], // benchmarking
	['198.51.100.0', 24], // TEST-NET-2
	['203.0.113.0', 24], // TEST-NET-3
	['224.0.0.0', 4], // multicast
	['240.0.0.0', 4] // reserved + broadcast
];

const IPV4_BLOCK_RANGES = IPV4_BLOCKS.map(([net, bits]) => {
	const base = ipv4ToInt(net)!;
	const size = 2 ** (32 - bits);
	return [base, base + size - 1] as const;
});

function isForbiddenIpv4(ip: string): boolean {
	const n = ipv4ToInt(ip);
	if (n === null) return true;
	return IPV4_BLOCK_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Parses an IPv6 address (with optional embedded dotted IPv4) into 8 16-bit groups. */
function parseIpv6(ip: string): number[] | null {
	let s = ip;
	let tail: number[] = [];
	if (s.includes('.')) {
		const idx = s.lastIndexOf(':');
		const n = ipv4ToInt(s.slice(idx + 1));
		if (n === null) return null;
		tail = [Math.floor(n / 65536), n % 65536];
		const prefix = s.slice(0, idx + 1);
		s = prefix.endsWith('::') ? prefix : s.slice(0, idx);
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const toGroups = (part: string): number[] | null => {
		if (part === '') return [];
		const out: number[] = [];
		for (const g of part.split(':')) {
			if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
			out.push(parseInt(g, 16));
		}
		return out;
	};
	const head = toGroups(halves[0]!);
	const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
	if (!head || !rest) return null;
	const total = 8 - tail.length;
	if (halves.length === 2) {
		const fill = total - head.length - rest.length;
		if (fill < 1) return null;
		return [...head, ...Array<number>(fill).fill(0), ...rest, ...tail];
	}
	if (head.length !== total) return null;
	return [...head, ...tail];
}

const groupsToIpv4 = (hi: number, lo: number) =>
	`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

function isForbiddenIpv6(ip: string): boolean {
	const g = parseIpv6(ip);
	if (!g) return true;
	const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number
	];
	const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

	// ::ffff:a.b.c.d (IPv4-mapped) and ::ffff:0:a.b.c.d (IPv4-translated): judge the IPv4.
	if (zeroPrefix(5) && g5 === 0xffff) return isForbiddenIpv4(groupsToIpv4(g6, g7));
	if (zeroPrefix(4) && g4 === 0xffff && g5 === 0) return isForbiddenIpv4(groupsToIpv4(g6, g7));
	// ::/96 covers ::, ::1 and the deprecated IPv4-compatible addresses.
	if (zeroPrefix(6)) return true;
	// 64:ff9b::/96 NAT64 well-known prefix: judge the embedded IPv4.
	if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
		return isForbiddenIpv4(groupsToIpv4(g6, g7));
	}
	// 2002::/16 6to4: the IPv4 is in groups 1-2.
	if (g0 === 0x2002) return isForbiddenIpv4(groupsToIpv4(g1, g2));
	// Only global unicast (2000::/3) is allowed at all; this excludes fc00::/7 (ULA),
	// fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast), 64:ff9b:1::/48, 100::/64 …
	if ((g0 & 0xe000) !== 0x2000) return true;
	// 2001::/23 IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID …).
	if (g0 === 0x2001 && g1 < 0x0200) return true;
	// 2001:db8::/32 and 3fff::/20 documentation.
	if (g0 === 0x2001 && g1 === 0x0db8) return true;
	if ((g0 & 0xfff0) === 0x3ff0) return true;
	return false;
}

/** True for addresses an import must never reach. Anything that does not parse is forbidden. */
export function isForbiddenAddress(ip: string): boolean {
	let s = ip.trim();
	if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
	// Zone ids (fe80::1%eth0) only exist for link-local scopes.
	if (s.includes('%')) return true;
	const kind = isIP(s);
	if (kind === 4) return isForbiddenIpv4(s);
	if (kind === 6) return isForbiddenIpv6(s.toLowerCase());
	return true;
}

// ---------------------------------------------------------------------------------------------
// Content sniffing
// ---------------------------------------------------------------------------------------------

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
	b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Detects the image type from magic bytes; null when it is none of `ALLOWED_IMAGE_TYPES`. */
export function sniffImageType(b: Uint8Array): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
	if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))) return 'image/gif';
	if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp';
	if (startsWith(b, ascii('ftyp'), 4) && (startsWith(b, ascii('avif'), 8) || startsWith(b, ascii('avis'), 8))) {
		return 'image/avif';
	}
	if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
	return null;
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
	const results = await dnsLookup(hostname, { all: true, verbatim: true });
	return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

/** Validates the URL and resolves its host to one public address to connect to. */
async function checkTarget(
	url: URL,
	resolveHost: NonNullable<FetchImageOptions['resolveHost']>,
	isForbidden: (ip: string) => boolean
): Promise<ResolvedAddress> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('Only http and https URLs can be imported');
	if (url.username || url.password) fail('URLs with credentials are not allowed');

	const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
	if (!host) fail('The URL has no host');

	let addresses: ResolvedAddress[];
	const literal = isIP(host);
	if (literal) {
		addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
	} else {
		try {
			addresses = await resolveHost(host);
		} catch {
			return fail(`Could not resolve ${host}`);
		}
	}
	if (addresses.length === 0) fail(`Could not resolve ${host}`);
	// All answers must be public, otherwise a mixed answer could still be steered.
	if (addresses.some((a) => isForbidden(a.address))) fail('That address is not allowed');
	return addresses[0]!;
}

interface HopResult {
	status: number;
	headers: http.IncomingHttpHeaders;
	response: http.IncomingMessage;
}

function requestOnce(url: URL, pinned: ResolvedAddress, signal: AbortSignal): Promise<HopResult> {
	// Connect to the validated address no matter what DNS says now (rebinding guard). Node may call
	// lookup with `all: true` (autoSelectFamily), so answer in both shapes.
	const lookup = ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
		else callback(null, pinned.address, pinned.family);
	}) as unknown as LookupFunction;

	const mod = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const req = mod.request(
			url,
			{
				method: 'GET',
				lookup,
				// No pooled sockets: every connection goes through the pinned lookup above.
				agent: false,
				signal,
				headers: {
					'user-agent': 'ClosestWins-ImageImport/1.0',
					accept: ALLOWED_IMAGE_TYPES.join(', '),
					'accept-encoding': 'identity'
				}
			},
			(response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, response })
		);
		req.on('error', reject);
		req.end();
	});
}

async function readBody(response: http.IncomingMessage, maxBytes: number): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of response as AsyncIterable<Buffer>) {
		total += chunk.length;
		if (total > maxBytes) {
			response.destroy();
			fail(`The image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
		}
		chunks.push(chunk);
	}
	const buf = Buffer.concat(chunks, total);
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function fetchRemoteImage(url: string, options: FetchImageOptions = {}): Promise<FetchedImage> {
	const resolveHost = options.resolveHost ?? defaultResolveHost;
	const isForbidden = options.isForbidden ?? isForbiddenAddress;
	const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
	const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
	const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

	let current: URL;
	try {
		current = new URL(url);
	} catch {
		return fail('Invalid URL');
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		for (let hop = 0; ; hop++) {
			const pinned = await checkTarget(current, resolveHost, isForbidden);
			let result: HopResult;
			try {
				result = await requestOnce(current, pinned, controller.signal);
			} catch (e) {
				if (controller.signal.aborted) return fail('The download timed out');
				return fail(`Could not download the image (${e instanceof Error ? e.message : 'network error'})`);
			}
			const { status, headers, response } = result;

			if ([301, 302, 303, 307, 308].includes(status)) {
				response.resume();
				const location = headers.location;
				if (!location) fail(`Redirect without a location (${status})`);
				if (hop >= maxRedirects) fail('Too many redirects');
				try {
					current = new URL(location!, current);
				} catch {
					return fail('Invalid redirect location');
				}
				continue;
			}

			if (status !== 200) {
				response.resume();
				fail(`The server answered ${status}`);
			}

			const contentType = (headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
			if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
				response.resume();
				fail(`Not an image (${contentType || 'no content type'})`);
			}
			const declared = Number(headers['content-length']);
			if (Number.isFinite(declared) && declared > maxBytes) {
				response.destroy();
				fail(`The image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
			}

			let bytes: Uint8Array;
			try {
				bytes = await readBody(response, maxBytes);
			} catch (e) {
				if (e instanceof ContentError) throw e;
				if (controller.signal.aborted) return fail('The download timed out');
				return fail('The download was interrupted');
			}

			const sniffed = sniffImageType(bytes);
			if (!sniffed) fail('The downloaded file is not a supported image');
			return { bytes, contentType: sniffed!, finalUrl: current.href };
		}
	} finally {
		clearTimeout(timer);
	}
}
