/**
 * `pnpm dev:lan`: the dev server on every interface, with ORIGIN set to this machine's LAN
 * address so the join URL and the TV's QR code point somewhere phones can reach.
 *
 *   pnpm dev:lan                 # picks the first private IPv4 address
 *   LAN_IP=192.168.1.20 pnpm dev:lan
 *   PORT=5180 pnpm dev:lan
 *
 * Phones must be on the same network (and the host firewall must allow the port).
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const port = process.env.PORT ?? '5173';

function lanAddress(): string | undefined {
	const candidates: string[] = [];
	for (const addrs of Object.values(networkInterfaces())) {
		for (const a of addrs ?? []) {
			if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
		}
	}
	// Prefer the usual home/office ranges over VPN/container bridges.
	const score = (ip: string) =>
		ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
	return candidates.sort((a, b) => score(a) - score(b))[0];
}

const ip = process.env.LAN_IP ?? lanAddress();
if (!ip) {
	console.error('No LAN address found; set LAN_IP=…');
	process.exit(1);
}
const origin = `http://${ip}:${port}`;
console.log(`\n  Closest Wins on your network: ${origin}`);
console.log(`  Big screen: ${origin}/tv   Host: ${origin}/host   (phones join via the QR code)\n`);

const child = spawn('pnpm', ['exec', 'vite', 'dev', '--host', '0.0.0.0', '--port', port, '--strictPort'], {
	stdio: 'inherit',
	env: { ...process.env, ORIGIN: origin }
});
const forward = (sig: NodeJS.Signals) => child.kill(sig);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
child.on('exit', (code) => process.exit(code ?? 0));
