/**
 * Simulated players and TV screens for host controller tests, without their UIs.
 *
 * Everything goes through the real remote functions over HTTP, the way the browser runtime
 * talks to them (see @sveltejs/kit/src/runtime/client/remote-functions):
 * - id:       `<djb2 hash of the module path>/<export name>`, served at `/_app/remote/<id>`;
 * - command:  POST JSON `{ payload, refreshes: [] }`, payload = base64url(devalue.stringify(arg));
 *             answer `{ type: 'result', data: devalue({ _: value }) }` or `{ type: 'error', error }`;
 * - query.live: GET `/_app/remote/<id>?payload=…` with `accept: text/event-stream`; each event is
 *             `data: {"type":"result","result":"<devalue>"}`. An open stream is what makes a
 *             player or TV count as "connected"; aborting it disconnects them;
 * - form:     the no-JS path: POST urlencoded to `<page>?/remote=<id>` with field names
 *             `<field>/<id>` (and an Origin header for Kit's CSRF check). Success is a 303 that
 *             sets the cookie.
 * Cookies (player token, TV token) are kept per simulated device in a small jar.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { PlayerStateValue, TvStateValue } from '../../../src/lib/game/types.ts';

const kitRequire = createRequire(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
/** devalue is a dependency of Kit (not of the app); load Kit's copy. */
const devalue = kitRequire('devalue') as { stringify(v: unknown): string; parse(s: string): unknown };

/** Kit's djb2 `hash` (src/utils/hash.js), used for remote module ids. */
function djb2(value: string): string {
	let hash = 5381;
	let i = value.length;
	while (i) hash = (hash * 33) ^ value.charCodeAt(--i);
	return (hash >>> 0).toString(36);
}

const GAME_REMOTE = djb2('src/lib/remote/game.remote.ts');
const remoteId = (name: string) => `${GAME_REMOTE}/${name}`;

function encodeArg(value: unknown): string {
	if (value === undefined) return '';
	return Buffer.from(devalue.stringify(value), 'utf8')
		.toString('base64')
		.replaceAll('=', '')
		.replaceAll('+', '-')
		.replaceAll('/', '_');
}

/**
 * The dev server only registers a remote module's live queries once its client module has been
 * requested (a fresh server answers 404 until then). Harmless against a production build.
 */
const warmed = new Map<string, Promise<void>>();
function warmUp(baseURL: string): Promise<void> {
	let p = warmed.get(baseURL);
	if (!p) {
		p = fetch(`${baseURL}/src/lib/remote/game.remote.ts`).then(
			(r) => void r.body?.cancel(),
			() => {}
		);
		warmed.set(baseURL, p);
	}
	return p;
}

export class RemoteError extends Error {
	readonly status: number | undefined;
	constructor(status: number | undefined, message: string) {
		super(`${status ?? '?'} ${message}`);
		this.status = status;
	}
}

export interface LiveStream<T> {
	opened: Promise<void>;
	latest(): T | undefined;
	next(pred?: (v: T) => boolean, timeoutMs?: number): Promise<T>;
	close(): void;
}

/** A simulated device: a base URL and a cookie jar. */
class Device {
	readonly cookies = new Map<string, string>();
	readonly baseURL: string;
	private streams = new Set<AbortController>();

	constructor(baseURL: string) {
		this.baseURL = baseURL;
	}

	protected cookieHeader(): string {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	protected storeCookies(res: Response) {
		for (const line of res.headers.getSetCookie()) {
			const [pair = ''] = line.split(';');
			const eq = pair.indexOf('=');
			if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
		}
	}

	async command<T = void>(name: string, arg?: unknown): Promise<T> {
		await warmUp(this.baseURL);
		const res = await fetch(`${this.baseURL}/_app/remote/${remoteId(name)}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				cookie: this.cookieHeader(),
				'x-sveltekit-pathname': '/',
				'x-sveltekit-search': ''
			},
			body: JSON.stringify({ payload: encodeArg(arg), refreshes: [] })
		});
		this.storeCookies(res);
		const body = (await res.json().catch(() => null)) as
			| { type: 'result'; data?: string }
			| { type: 'error'; error: { status?: number; message: string } }
			| null;
		if (!body) throw new RemoteError(res.status, res.statusText);
		if (body.type === 'error') throw new RemoteError(body.error.status ?? res.status, body.error.message);
		return (body.data ? (devalue.parse(body.data) as { _: T })._ : undefined) as T;
	}

	/**
	 * Opens a live stream and keeps it open (the device is "connected") until `close()`.
	 * `latest()` is the most recent value; `next(pred)` waits for a value matching `pred`.
	 */
	stream<T>(name: string, arg?: unknown): LiveStream<T> {
		const controller = new AbortController();
		this.streams.add(controller);
		let latest: T | undefined;
		const waiters = new Set<{ pred: (v: T) => boolean; resolve: (v: T) => void }>();
		const payload = encodeArg(arg);
		const url = `${this.baseURL}/_app/remote/${remoteId(name)}${payload ? `?payload=${payload}` : ''}`;

		const opened = (async () => {
			await warmUp(this.baseURL);
			const res = await fetch(url, {
				headers: { accept: 'text/event-stream', cookie: this.cookieHeader() },
				signal: controller.signal
			});
			if (!res.ok || !res.body) throw new RemoteError(res.status, `stream ${name} failed`);
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';
			(async () => {
				try {
					for (;;) {
						const { value, done } = await reader.read();
						if (done) return;
						buffer += value;
						let idx: number;
						while ((idx = buffer.indexOf('\n\n')) >= 0) {
							const chunk = buffer.slice(0, idx);
							buffer = buffer.slice(idx + 2);
							const data = chunk
								.split('\n')
								.filter((l) => l.startsWith('data: '))
								.map((l) => l.slice(6))
								.join('\n');
							if (!data) continue;
							const msg = JSON.parse(data) as { type: string; result?: string };
							if (msg.type !== 'result' || !msg.result) continue;
							latest = devalue.parse(msg.result) as T;
							for (const w of [...waiters]) {
								if (w.pred(latest)) {
									waiters.delete(w);
									w.resolve(latest);
								}
							}
						}
					}
				} catch {
					// aborted
				}
			})();
		})();

		return {
			opened,
			latest: () => latest,
			next: (pred: (v: T) => boolean = () => true, timeoutMs = 10_000): Promise<T> => {
				if (latest !== undefined && pred(latest)) return Promise.resolve(latest);
				return new Promise<T>((resolve, reject) => {
					const w = { pred, resolve };
					waiters.add(w);
					setTimeout(() => {
						if (waiters.delete(w)) reject(new Error(`timed out waiting on stream ${name}`));
					}, timeoutMs);
				});
			},
			close: () => {
				controller.abort();
				this.streams.delete(controller);
			}
		};
	}

	/** Closes every open stream (the device goes "disconnected"). */
	disconnect() {
		for (const c of this.streams) c.abort();
		this.streams.clear();
	}
}

export class SimPlayer extends Device {
	gameId = '';
	playerId = '';
	private live: LiveStream<PlayerStateValue> | null = null;

	readonly code: string;
	readonly nickname: string;

	constructor(baseURL: string, code: string, nickname: string) {
		super(baseURL);
		this.code = code;
		this.nickname = nickname;
	}

	/** Joins through the real `joinGame` form (no-JS path), then opens the player stream. */
	async join(): Promise<this> {
		const id = remoteId('joinGame');
		const body = new URLSearchParams({ [`code/${id}`]: this.code, [`nickname/${id}`]: this.nickname });
		const res = await fetch(`${this.baseURL}/join/${this.code}?/remote=${encodeURIComponent(id)}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				origin: this.baseURL,
				accept: 'text/html',
				cookie: this.cookieHeader()
			},
			body,
			redirect: 'manual'
		});
		this.storeCookies(res);
		if (res.status !== 303) throw new RemoteError(res.status, `join failed for ${this.nickname}`);
		await this.connect();
		return this;
	}

	/** (Re)opens the player stream and waits for the first `playing` snapshot. */
	async connect() {
		this.live = this.stream<PlayerStateValue>('playerState', this.code);
		await this.live.opened;
		const s = await this.live.next((v) => v.status === 'playing');
		if (s.status === 'playing') {
			this.gameId = s.game.id;
			this.playerId = s.me.id;
		}
	}

	/** Latest snapshot once it satisfies `pred`. */
	state(pred: (v: PlayerStateValue) => boolean = () => true, timeoutMs?: number) {
		return this.live!.next(pred, timeoutMs);
	}

	/** Waits for the given round to be running and returns its index. */
	async roundIndex(timeoutMs = 10_000): Promise<number> {
		const s = await this.state((v) => v.status === 'playing' && v.phase === 'round', timeoutMs);
		if (s.status !== 'playing' || s.phase !== 'round') throw new Error('no round');
		return s.round.index;
	}

	async lockIn(lat: number, lng: number) {
		const roundIndex = await this.roundIndex();
		await this.command('lockIn', { gameId: this.gameId, roundIndex, lat, lng, touched: true });
	}
}

export class SimTv extends Device {
	pairingCode = '';
	private live: LiveStream<TvStateValue> | null = null;

	/** Registers the screen (sets the TV cookie) and reads its pairing code from `tvState`. */
	async register(): Promise<this> {
		await this.command('registerTv');
		await this.connect();
		return this;
	}

	async connect() {
		this.live = this.stream<TvStateValue>('tvState');
		await this.live.opened;
		const s = await this.live.next((v) => v.status === 'pairing' || v.status === 'paired');
		if (s.status === 'pairing') this.pairingCode = s.pairingCode;
	}

	state(pred: (v: TvStateValue) => boolean = () => true, timeoutMs?: number) {
		return this.live!.next(pred, timeoutMs);
	}

	/** SHA-256 hex of the TV token, as stored in `tv_screen.token_hash` (for cleanup). */
	tokenHash(): string | null {
		const token = this.cookies.get('cw_tv');
		return token ? createHash('sha256').update(decodeURIComponent(token), 'utf8').digest('hex') : null;
	}
}
