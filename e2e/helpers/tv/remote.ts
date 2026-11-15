/**
 * Minimal Node client for SvelteKit remote functions, speaking the same wire format as Kit's
 * browser runtime (`@sveltejs/kit/src/runtime/client/remote-functions/*`):
 *
 * - command: `POST /_app/remote/<id>` JSON `{ payload: base64url(devalue(arg)), refreshes: [] }`
 * - form:    `POST /_app/remote/<id>` multipart; field names carry the form id as a suffix
 *            (`name/<id>`, numbers `n:name/<id>`, booleans `b:name/<id>` = 'on')
 * - query.live: `GET /_app/remote/<id>?payload=…` with `accept: text/event-stream` (SSE)
 * - responses: `{ type: 'result', data: devalue({ _: value, redirect? }) }` or
 *   `{ type: 'error', error: { message } }`
 *
 * Remote ids look like `<fileHash>/<exportName>`. In dev they are read from the client stub
 * Vite serves for the remote module (`/src/lib/remote/<file>.remote.ts`).
 *
 * Each `RemoteClient` has its own cookie jar, i.e. it is one "device" (admin, a phone, …).
 */

// --- devalue (subset: objects, arrays, primitives) --------------------------------------------

/** `devalue.stringify` for plain JSON-like values. */
export function devalueStringify(value: unknown): string {
	const out: unknown[] = [];
	const add = (v: unknown): number => {
		if (v === undefined) return -1;
		const i = out.length;
		out.push(null);
		if (Array.isArray(v)) {
			out[i] = v.map(add);
		} else if (v !== null && typeof v === 'object') {
			const o: Record<string, number> = {};
			for (const [k, val] of Object.entries(v)) if (val !== undefined) o[k] = add(val);
			out[i] = o;
		} else if (typeof v === 'number' && !Number.isFinite(v)) {
			throw new Error('non-finite numbers are not supported');
		} else {
			out[i] = v;
		}
		return i;
	};
	add(value);
	return JSON.stringify(out);
}

/** `devalue.parse` for plain JSON-like values (enough for our command/form results). */
export function devalueParse(text: string): unknown {
	const table = JSON.parse(text) as unknown;
	if (typeof table === 'number') return table === -1 ? undefined : null;
	const arr = table as unknown[];
	const memo = new Map<number, unknown>();
	const hydrate = (i: number): unknown => {
		if (i === -1) return undefined;
		if (i === -3) return NaN;
		if (i === -4) return Infinity;
		if (i === -5) return -Infinity;
		if (i === -6) return -0;
		if (memo.has(i)) return memo.get(i);
		const v = arr[i];
		if (Array.isArray(v)) {
			if (typeof v[0] === 'string') {
				// Typed value (Date, Map, …).
				const [type, ...rest] = v as [string, ...unknown[]];
				if (type === 'Date') return new Date(rest[0] as string);
				throw new Error(`devalue type ${type} not supported`);
			}
			const a: unknown[] = [];
			memo.set(i, a);
			for (const j of v as number[]) a.push(hydrate(j));
			return a;
		}
		if (v !== null && typeof v === 'object') {
			const o: Record<string, unknown> = {};
			memo.set(i, o);
			for (const [k, j] of Object.entries(v as Record<string, number>)) o[k] = hydrate(j);
			return o;
		}
		return v;
	};
	return hydrate(0);
}

function base64url(text: string): string {
	return Buffer.from(text, 'utf8').toString('base64').replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

// --- Remote ids --------------------------------------------------------------------------------

const idCache = new Map<string, Promise<Record<string, string>>>();

/** Export name → remote id for a remote module, e.g. `remoteIds(base, 'game')`. */
export function remoteIds(baseURL: string, file: 'game' | 'auth' | 'content'): Promise<Record<string, string>> {
	const key = `${baseURL}|${file}`;
	let p = idCache.get(key);
	if (!p) {
		p = (async () => {
			const res = await fetch(new URL(`/src/lib/remote/${file}.remote.ts`, baseURL));
			const js = await res.text();
			const ids: Record<string, string> = {};
			for (const m of js.matchAll(/export const (\w+) = __remote\.\w+\('([^']+)'\)/g)) ids[m[1]!] = m[2]!;
			if (!Object.keys(ids).length) {
				throw new Error(
					`Could not read remote ids for ${file}.remote.ts from ${baseURL}. These helpers need the dev server (E2E_BASE_URL).`
				);
			}
			return ids;
		})();
		idCache.set(key, p);
		p.catch(() => idCache.delete(key));
	}
	return p;
}

export class RemoteError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export type FormValue = string | number | boolean | Blob | undefined;

export interface FormResult<T = unknown> {
	redirect?: string;
	result?: T;
	issues?: Array<{ message: string; path?: unknown[] }>;
}

// --- Client ------------------------------------------------------------------------------------

export class RemoteClient {
	readonly baseURL: string;
	readonly cookies = new Map<string, string>();
	readonly origin: string;
	private streams = new Set<AbortController>();

	constructor(baseURL: string) {
		this.baseURL = baseURL;
		this.origin = new URL(baseURL).origin;
	}

	private cookieHeader(): string {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	private storeCookies(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair = ''] = c.split(';');
			const eq = pair.indexOf('=');
			if (eq < 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			if (!value || /max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
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
		const body = (await res.json().catch(() => null)) as
			| { type: 'result'; data?: string }
			| { type: 'error'; error: { message?: string; status?: number } }
			| null;
		if (!body) throw new RemoteError(res.status, `HTTP ${res.status} ${res.statusText}`);
		if (body.type === 'error') {
			throw new RemoteError(body.error.status ?? res.status, body.error.message ?? 'error');
		}
		if (!res.ok) throw new RemoteError(res.status, `HTTP ${res.status}`);
		return body.data ? (devalueParse(body.data) as { _?: unknown; redirect?: string }) : {};
	}

	async command<T = unknown>(id: string, arg?: unknown): Promise<T> {
		const res = await fetch(new URL(`/_app/remote/${id}`, this.baseURL), {
			method: 'POST',
			headers: this.headers({ 'content-type': 'application/json' }),
			body: JSON.stringify({ payload: arg === undefined ? '' : base64url(devalueStringify(arg)), refreshes: [] })
		});
		const data = await this.read(res);
		return data._ as T;
	}

	async form<T = unknown>(id: string, fields: Record<string, FormValue>): Promise<FormResult<T>> {
		const fd = new FormData();
		for (const [name, value] of Object.entries(fields)) {
			if (value === undefined) continue;
			if (typeof value === 'number') fd.append(`n:${name}/${id}`, String(value));
			else if (typeof value === 'boolean') {
				if (value) fd.append(`b:${name}/${id}`, 'on');
			} else if (value instanceof Blob) fd.append(`${name}/${id}`, value, (value as File).name ?? 'file');
			else fd.append(`${name}/${id}`, value);
		}
		const res = await fetch(new URL(`/_app/remote/${id}`, this.baseURL), {
			method: 'POST',
			headers: this.headers(),
			body: fd
		});
		const data = await this.read(res);
		const out = (data._ ?? {}) as FormResult<T>;
		if (data.redirect) out.redirect = data.redirect;
		return out;
	}

	/**
	 * Opens a `query.live` stream and keeps reading it (the server counts this client as
	 * connected while it is open). Resolves with the first value. `close()` disconnects.
	 */
	async openLive<T = unknown>(id: string, arg?: unknown): Promise<{ first: T; latest: () => T; close: () => void }> {
		const controller = new AbortController();
		this.streams.add(controller);
		const qs = arg === undefined ? '' : `?payload=${base64url(devalueStringify(arg))}`;
		const res = await fetch(new URL(`/_app/remote/${id}${qs}`, this.baseURL), {
			headers: { accept: 'text/event-stream', ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}) },
			signal: controller.signal
		});
		if (!res.ok || !res.body) throw new RemoteError(res.status, `live query failed: HTTP ${res.status}`);
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let latest: T | undefined;
		let resolveFirst!: (v: T) => void;
		let rejectFirst!: (e: unknown) => void;
		const first = new Promise<T>((res, rej) => ((resolveFirst = res), (rejectFirst = rej)));
		void (async () => {
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let sep: number;
					while ((sep = buffer.indexOf('\n\n')) >= 0) {
						const chunk = buffer.slice(0, sep);
						buffer = buffer.slice(sep + 2);
						const line = chunk.split('\n').find((l) => l.startsWith('data: '));
						if (!line) continue;
						const node = JSON.parse(line.slice(6)) as { type: string; result?: string };
						if (node.type === 'result' && node.result) {
							latest = devalueParse(node.result) as T;
							resolveFirst(latest);
						}
					}
				}
			} catch (e) {
				rejectFirst(e);
			}
		})();
		const close = () => {
			controller.abort();
			this.streams.delete(controller);
		};
		return { first: await first, latest: () => latest as T, close };
	}

	closeStreams() {
		for (const c of this.streams) c.abort();
		this.streams.clear();
	}
}
