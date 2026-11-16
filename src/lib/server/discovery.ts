/**
 * Bonjour / mDNS advertisement so the Apple TV app can find the server on the LAN without
 * typing an address. Opt-in with MDNS_ADVERTISE=1 (`pnpm dev:lan` sets it).
 *
 * Contract for clients (tvOS app):
 * - service type `_closestwins._tcp`, instance name `Closest Wins (<hostname>)`;
 * - SRV port = the port of ORIGIN (explicit, else 443 for https / 80 for http); SRV target
 *   `closestwins-<hostname>.local`, resolving only to ORIGIN's address when that is an IP of
 *   this machine (otherwise to all its non-loopback addresses);
 * - TXT `v=1` (protocol version) and `origin=<ORIGIN>` unless ORIGIN is a loopback address.
 *   Clients should use `origin` when present (it is the URL the server builds its links and CSRF
 *   check from, and it works behind a reverse proxy) and fall back to SRV host + port.
 *
 * Advertising is best effort: it never throws or delays startup; failures log one warning.
 */
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { Bonjour } from 'bonjour-service';
import { MDNS_ADVERTISE, ORIGIN } from '$app/env/private';

export const SERVICE_TYPE = 'closestwins';
export const PROTOCOL_VERSION = '1';

export interface Advertisement {
	name: string;
	type: string;
	port: number;
	host: string;
	txt: Record<string, string>;
	/** Addresses the SRV target resolves to; undefined = every non-loopback address. */
	addresses?: string[];
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

/** What to advertise for a given ORIGIN, machine hostname and interfaces (pure; unit tested). */
export function advertisement(
	origin: string,
	machineHostname: string,
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {}
): Advertisement {
	const url = new URL(origin);
	const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
	const shortHost = machineHostname.replace(/\.local\.?$/i, '');
	const label =
		shortHost
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'server';
	const txt: Record<string, string> = { v: PROTOCOL_VERSION };
	if (!LOOPBACK.test(url.hostname)) txt.origin = url.origin;
	// ORIGIN is one of our IPs (pnpm dev:lan, a LAN `node build`): resolve only to it, never to
	// Docker/VPN bridge addresses a TV cannot reach.
	const originIp = url.hostname.replace(/^\[|\]$/g, '');
	const own = Object.values(interfaces)
		.flat()
		.some((a) => a && !a.internal && a.address === originIp);
	return {
		name: `Closest Wins (${shortHost})`,
		type: SERVICE_TYPE,
		port,
		// SRV target. bonjour-service also answers A/AAAA records for it, so it must not be the
		// machine's own `<hostname>.local`: the system responder (avahi, mDNSResponder) owns that
		// name and treats our records as a conflict (avahi then renames the host to `<name>-2`).
		// The bare os.hostname() (the library default) is not resolvable over mDNS either.
		host: `closestwins-${label}.local`,
		txt,
		addresses: own ? [originIp] : undefined
	};
}

// Survives dev-server module reloads, so `init` running again never publishes twice.
const STARTED = Symbol.for('closest-wins.discovery');
type GlobalWithFlag = typeof globalThis & { [STARTED]?: boolean };

/** Start advertising if MDNS_ADVERTISE is on. Synchronous, never throws, runs at most once. */
export function startDiscovery(): void {
	const g = globalThis as GlobalWithFlag;
	if (!MDNS_ADVERTISE || g[STARTED]) return;
	g[STARTED] = true;

	let warned = false;
	const warn = (err: unknown) => {
		if (warned) return;
		warned = true;
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[discovery] mDNS advertisement unavailable: ${message}`);
	};

	try {
		const { addresses, ...ad } = advertisement(ORIGIN, hostname(), networkInterfaces());
		const bonjour = new Bonjour({}, warn);
		// Socket errors (e.g. EACCES on 5353) are emitted on the internal multicast-dns emitter;
		// unhandled they would crash the process.
		(bonjour as unknown as { server?: { mdns?: NodeJS.EventEmitter } }).server?.mdns?.on(
			'error',
			warn
		);
		const service = bonjour.publish(ad);
		if (addresses) {
			// bonjour-service adds an A/AAAA record for every interface and has no option to limit
			// them. records() is first called after probing (async), so replacing it here is in time.
			const all = service.records.bind(service);
			service.records = () =>
				all().filter(
					(r) => (r.type !== 'A' && r.type !== 'AAAA') || addresses.includes(String(r.data))
				);
		}
		service.on('error', warn);
		service.once('up', () =>
			console.log(`[discovery] advertising "${ad.name}" _${ad.type}._tcp port ${ad.port}`)
		);
		unpublishOnShutdown(bonjour);
	} catch (err) {
		warn(err);
	}
}

function unpublishOnShutdown(bonjour: Bonjour) {
	let stopping = false;
	const stop = (done?: () => void) => {
		if (stopping) return done?.();
		stopping = true;
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			try {
				bonjour.destroy();
			} catch {
				// ignore
			}
			done?.();
		};
		// Goodbye packets (TTL 0) go out asynchronously; never wait for them long.
		setTimeout(finish, 500).unref();
		try {
			bonjour.unpublishAll(finish);
		} catch {
			finish();
		}
	};

	const onSignal = (signal: NodeJS.Signals) => {
		stop(() => {
			// In production the shutdown hook and adapter-node also listen and end the process.
			// Under `vite dev` nobody else handles SIGINT, and our listener suppressed Node's
			// default exit, so raise it again now that ours is gone.
			if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
		});
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	(process as NodeJS.EventEmitter).once('sveltekit:shutdown', () => stop());
}
