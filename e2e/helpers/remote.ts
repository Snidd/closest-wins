/**
 * Node client for SvelteKit remote functions, for tests that simulate devices (an admin, a
 * phone, a TV) without their UIs. It speaks the same wire format as Kit's browser runtime
 * (`@sveltejs/kit/src/runtime/{client,server}/remote-functions*`) and works against both
 * `vite dev` and the production build:
 *
 * - id:         `<djb2 hash of the module path>/<export name>` (Kit's `hash()` of e.g.
 *               `src/lib/remote/game.remote.ts`), identical in dev and in a build;
 * - command:    `POST /_app/remote/<id>` JSON `{ payload, refreshes: [] }`,
 *               payload = base64url(devalue.stringify(arg));
 * - form:       `POST /_app/remote/<id>` multipart, field names carry the form id as a suffix
 *               (`name/<id>`, numbers `n:name/<id>`, booleans `b:name/<id>` = 'on');
 * - query.live: `GET /_app/remote/<id>?payload=…` with `accept: text/event-stream`; each event
 *               is `data: {"type":"result","result":"<devalue>"}`. An open stream is what makes
 *               a player or TV count as connected; aborting it disconnects them;
 * - responses:  `{ type: 'result', data: devalue({ _: value, redirect?, issues? }) }` or
 *               `{ type: 'error', error: { status?, message } }`.
 *
 * Production builds refuse remote requests without a same-origin `Origin` header (403
 * "Cross-site remote requests are forbidden"), so every request sends one, and every non-2xx
 * answer throws `RemoteError` (a silently ignored 403 looks exactly like a lost update).
 *
 * Each `Device` has its own cookie jar, i.e. it is one browser.
 */
import { createRequire } from 'node:module';
import { BASE_URL } from './env.ts';

const kitRequire = createRequire(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
/** devalue is a dependency of Kit (not of the app); use Kit's copy so the format always matches. */
const devalue = kitRequire('devalue') as { stringify(v: unknown): string; parse(s: string): unknown };

/** Kit's djb2 `hash` (src/utils/hash.js), used for remote module ids. */
function djb2(value: string): string {
	let hash = 5381;
	let i = value.length;
	while (i) hash = (hash * 33) ^ value.charCodeAt(--i);
	return (hash >>> 0).toString(36);
}

export type RemoteModule = 'game' | 'auth' | 'content';

/** Remote id of an export, e.g. `remoteId('game', 'lockIn')`. */
export function remoteId(module: RemoteModule, name: string): string {
	return `${djb2(`src/lib/remote/${module}.remote.ts`)}/${name}`;
}

function encodeArg(value: unknown): string {
	if (value === undefined) return '';
	return Buffer.from(devalue.stringify(value), 'utf8').toString('base64url');
}

/**
 * `vite dev` only registers a remote module once its client module has been requested (a
 * fresh dev server answers 404 until then). Against a production build this is a harmless 404.
 */
const warmed = new Map<string, Promise<void>>();
function warmUp(baseURL: string, module: RemoteModule): Promise<void> {
	const key = `${baseURL}|${module}`;
	let p = warmed.get(key);
	if (!p) {
		p = fetch(`${baseURL}/src/lib/remote/${module}.remote.ts`).then(
			(r) => void r.body?.cancel(),
			() => {}
		);
		warmed.set(key, p);
	}
	return p;
}

export class RemoteError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(`${status} ${message}`);
		this.status = status;
	}
}

export type FormValue = string | number | boolean | Blob | undefined;

export interface FormResult<T = unknown> {
	redirect?: string;
	result?: T;
	issues?: Array<{ message: string; path?: unknown[] }>;
}

export interface LiveStream<T> {
	/** Resolves once the response headers arrived (the stream is open). */
	opened: Promise<void>;
	latest(): T | undefined;
	/** The latest value if it matches `pred`, otherwise the next one that does. */
	next(pred?: (v: T) => boolean, timeoutMs?: number): Promise<T>;
	close(): void;
}

/** One simulated browser: a base URL and a cookie jar. */
export class Device {
	readonly baseURL: string;
	readonly origin: string;
	readonly cookies = new Map<string, string>();
	private streams = new Set<AbortController>();

	constructor(baseURL: string = BASE_URL) {
		this.baseURL = baseURL.replace(/\/$/, '');
		this.origin = new URL(this.baseURL).origin;
	}

	cookieHeader(): string {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	private storeCookies(res: Response) {
		for (const line of res.headers.getSetCookie()) {
			const [pair = ''] = line.split(';');
			const eq = pair.indexOf('=');
			if (eq <= 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			if (!value || /max-age=0/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		return {
			origin: this.origin,
			'x-sveltekit-pathname': '/',
			'x-sveltekit-search': '',
			...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
			...extra
		};
	}

	private async read(res: Response): Promise<{ _?: unknown; redirect?: string }> {
		this.storeCookies(res);
		const text = await res.text();
		let body: { type?: string; data?: string; error?: { message?: string; status?: number }; message?: string } | null =
			null;
		try {
			body = JSON.parse(text);
		} catch {
			// not JSON (e.g. an HTML error page)
		}
		if (body?.type === 'error') throw new RemoteError(body.error?.status ?? res.status, body.error?.message ?? 'error');
		if (!res.ok || body?.type !== 'result') {
			throw new RemoteError(res.status, body?.message ?? (text.slice(0, 200) || res.statusText));
		}
		return body.data ? (devalue.parse(body.data) as { _?: unknown; redirect?: string }) : {};
	}

	async command<T = void>(module: RemoteModule, name: string, arg?: unknown): Promise<T> {
		await warmUp(this.baseURL, module);
		const res = await fetch(`${this.baseURL}/_app/remote/${remoteId(module, name)}`, {
			method: 'POST',
			headers: this.headers({ 'content-type': 'application/json' }),
			body: JSON.stringify({ payload: encodeArg(arg), refreshes: [] })
		});
		return (await this.read(res))._ as T;
	}

	async form<T = unknown>(module: RemoteModule, name: string, fields: Record<string, FormValue>): Promise<FormResult<T>> {
		await warmUp(this.baseURL, module);
		const id = remoteId(module, name);
		const fd = new FormData();
		for (const [field, value] of Object.entries(fields)) {
			if (value === undefined) continue;
			if (typeof value === 'number') fd.append(`n:${field}/${id}`, String(value));
			else if (typeof value === 'boolean') {
				if (value) fd.append(`b:${field}/${id}`, 'on');
			} else if (value instanceof Blob) fd.append(`${field}/${id}`, value, (value as File).name ?? 'file');
			else fd.append(`${field}/${id}`, value);
		}
		const res = await fetch(`${this.baseURL}/_app/remote/${id}`, { method: 'POST', headers: this.headers(), body: fd });
		const data = await this.read(res);
		const out = (data._ ?? {}) as FormResult<T>;
		if (data.redirect) out.redirect = data.redirect;
		return out;
	}

	/** Opens a live query and keeps reading it until `close()` / `disconnect()`. */
	stream<T>(module: RemoteModule, name: string, arg?: unknown): LiveStream<T> {
		const controller = new AbortController();
		this.streams.add(controller);
		let latest: T | undefined;
		let failure: unknown = null;
		const waiters = new Set<{ pred: (v: T) => boolean; resolve: (v: T) => void; reject: (e: unknown) => void }>();
		const payload = encodeArg(arg);
		const url = `${this.baseURL}/_app/remote/${remoteId(module, name)}${payload ? `?payload=${payload}` : ''}`;
		const fail = (e: unknown) => {
			failure = e;
			for (const w of waiters) w.reject(e);
			waiters.clear();
		};

		const opened = (async () => {
			await warmUp(this.baseURL, module);
			const res = await fetch(url, {
				headers: { accept: 'text/event-stream', ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}) },
				signal: controller.signal
			});
			if (!res.ok || !res.body) throw new RemoteError(res.status, `stream ${name} failed`);
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			void (async () => {
				let buffer = '';
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
							if (!data) continue; // keep-alive comment
							const msg = JSON.parse(data) as { type: string; result?: string; error?: { message?: string } };
							if (msg.type === 'error') {
								fail(new RemoteError(500, `stream ${name}: ${msg.error?.message ?? 'error'}`));
								return;
							}
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
					// aborted (close / disconnect)
				}
			})();
		})();
		opened.catch(fail);

		return {
			opened,
			latest: () => latest,
			next: (pred: (v: T) => boolean = () => true, timeoutMs = 15_000): Promise<T> => {
				if (latest !== undefined && pred(latest)) return Promise.resolve(latest);
				if (failure) return Promise.reject(failure);
				return new Promise<T>((resolve, reject) => {
					const w = { pred, resolve, reject };
					waiters.add(w);
					setTimeout(() => {
						if (waiters.delete(w)) {
							reject(new Error(`timed out waiting on stream ${name}; latest: ${JSON.stringify(latest)?.slice(0, 300)}`));
						}
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
