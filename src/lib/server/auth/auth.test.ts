import { describe, expect, it } from 'vitest';
import {
	constantTimeEqual,
	createSessionValue,
	hashToken,
	isPlausibleToken,
	mintToken,
	verifySessionValue
} from './crypto.ts';
import { RateLimiter } from './rate-limit.ts';
import { safeNext } from './redirect.ts';

const SECRET = 'x'.repeat(64);

describe('constantTimeEqual', () => {
	it('compares strings of any length', () => {
		expect(constantTimeEqual('hunter2', 'hunter2')).toBe(true);
		expect(constantTimeEqual('hunter2', 'hunter3')).toBe(false);
		expect(constantTimeEqual('short', 'a much longer string')).toBe(false);
		expect(constantTimeEqual('', '')).toBe(true);
	});
});

describe('admin session', () => {
	it('verifies a fresh session', () => {
		expect(verifySessionValue(SECRET, createSessionValue(SECRET, 60_000))).toBe(true);
	});

	it('rejects expired, tampered, foreign and malformed values', () => {
		const now = 1_000_000;
		const value = createSessionValue(SECRET, 1000, now);
		expect(verifySessionValue(SECRET, value, now + 999)).toBe(true);
		expect(verifySessionValue(SECRET, value, now + 1000)).toBe(false);

		const parts = value.split('.');
		const extended = [parts[0], String(now + 10_000_000), parts[2], parts[3]].join('.');
		expect(verifySessionValue(SECRET, extended, now)).toBe(false);
		expect(verifySessionValue('y'.repeat(64), value, now)).toBe(false);
		for (const bad of [undefined, null, '', 'v1', 'v1.a.b', 'v2.1.2.3', `${value}.x`]) {
			expect(verifySessionValue(SECRET, bad, now)).toBe(false);
		}
	});
});

describe('tokens', () => {
	it('mints random tokens with a matching sha256 hash', () => {
		const a = mintToken();
		const b = mintToken();
		expect(a.token).not.toBe(b.token);
		expect(a.hash).toBe(hashToken(a.token));
		expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(a.hash).not.toContain(a.token);
		expect(isPlausibleToken(a.token)).toBe(true);
		expect(isPlausibleToken('nope')).toBe(false);
		expect(isPlausibleToken(null)).toBe(false);
	});
});

describe('RateLimiter', () => {
	it('blocks after max failures within the window and recovers', () => {
		const rl = new RateLimiter(3, 10_000);
		const t = 5_000;
		rl.fail('ip', t);
		rl.fail('ip', t);
		expect(rl.check('ip', t).allowed).toBe(true);
		rl.fail('ip', t);
		const blocked = rl.check('ip', t + 1000);
		expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 9 });
		expect(rl.check('other', t).allowed).toBe(true);
		expect(rl.check('ip', t + 10_000).allowed).toBe(true);
	});

	it('reset clears the counter', () => {
		const rl = new RateLimiter(1, 10_000);
		rl.fail('ip', 0);
		expect(rl.check('ip', 1).allowed).toBe(false);
		rl.reset('ip');
		expect(rl.check('ip', 1).allowed).toBe(true);
	});
});

describe('safeNext', () => {
	it('keeps same-site paths with query and hash', () => {
		expect(safeNext('/host')).toBe('/host');
		expect(safeNext('/admin/locations?q=paris&page=2#list')).toBe('/admin/locations?q=paris&page=2#list');
		expect(safeNext('/host/abc?next=//evil.example')).toBe('/host/abc?next=//evil.example');
		expect(safeNext('/a/../admin')).toBe('/admin');
		expect(safeNext('/%2F/evil.example')).toBe('/%2F/evil.example'); // an encoded slash stays a path
	});

	it.each([
		null,
		undefined,
		'',
		'host',
		'https://evil.example',
		'javascript:alert(1)',
		'//evil.example',
		'///evil.example',
		'/\\evil.example',
		'\\\\evil.example',
		'/\t/evil.example',
		'/\n/evil.example',
		'/\r/evil.example',
		'/\t\t/evil.example',
		'/\u0000/evil.example',
		'/\u007f/evil.example',
		'/\u0085/evil.example',
		'/..//evil.example',
		'/.//evil.example',
		'/a/../..//evil.example',
		' //evil.example',
		'\t//evil.example'
	])('refuses %j', (next) => {
		expect(safeNext(next)).toBe('/host');
		expect(safeNext(next, '/admin')).toBe('/admin');
	});
});
