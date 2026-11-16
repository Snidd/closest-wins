import { describe, expect, it } from 'vitest';
import { advertisement } from './discovery.ts';

describe('advertisement', () => {
	it('uses the explicit port of ORIGIN (pnpm dev:lan, node build)', () => {
		const ad = advertisement('http://192.168.1.20:5173', 'omarchy');
		expect(ad.type).toBe('closestwins');
		expect(ad.port).toBe(5173);
		expect(ad.txt).toEqual({ v: '1', origin: 'http://192.168.1.20:5173' });
		expect(advertisement('http://192.168.1.20:3000', 'omarchy').port).toBe(3000);
	});

	it('falls back to the scheme default port', () => {
		expect(advertisement('http://game.lan', 'h').port).toBe(80);
		const ad = advertisement('https://game.example.com', 'h');
		expect(ad.port).toBe(443);
		expect(ad.txt.origin).toBe('https://game.example.com');
	});

	it('advertises the bare origin, without path or trailing slash', () => {
		expect(advertisement('http://10.0.0.5:5173/some/path/', 'h').txt.origin).toBe(
			'http://10.0.0.5:5173'
		);
	});

	it('omits origin when ORIGIN is a loopback address', () => {
		for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:5173']) {
			expect(advertisement(origin, 'h').txt).toEqual({ v: '1' });
		}
	});

	it('names the instance and SRV target after the machine', () => {
		const ad = advertisement('http://localhost:5173', 'omarchy');
		expect(ad.name).toBe('Closest Wins (omarchy)');
		// Never the machine's own <hostname>.local (owned by avahi / mDNSResponder).
		expect(ad.host).toBe('closestwins-omarchy.local');
		const mac = advertisement('http://localhost:5173', 'Magnus’s Mac mini.local');
		expect(mac.name).toBe('Closest Wins (Magnus’s Mac mini)');
		expect(mac.host).toBe('closestwins-magnus-s-mac-mini.local');
	});

	it('resolves only to ORIGIN when it is one of our addresses', () => {
		const iface = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4') => ({
			address,
			family,
			internal: false,
			netmask: '',
			mac: '02:00:00:00:00:01',
			cidr: null,
			...(family === 'IPv6' ? { scopeid: 0 } : {})
		});
		const interfaces = {
			enp12s0: [iface('192.168.2.92'), iface('fd95::1', 'IPv6')],
			docker0: [iface('172.17.0.1')]
		} as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>;
		expect(advertisement('http://192.168.2.92:5173', 'h', interfaces).addresses).toEqual([
			'192.168.2.92'
		]);
		expect(advertisement('http://[fd95::1]:5173', 'h', interfaces).addresses).toEqual(['fd95::1']);
		// A name, or an IP of another machine (reverse proxy): leave the library's default.
		expect(advertisement('https://game.example.com', 'h', interfaces).addresses).toBeUndefined();
		expect(advertisement('http://192.168.2.50:3000', 'h', interfaces).addresses).toBeUndefined();
	});
});
