/**
 * Simulated players and TV screens (no UI): they join, keep a live stream open (so they count
 * as connected), guess and pair through the real remote functions over HTTP. `NativeTv` is the
 * Apple TV app's client instead: plain JSON endpoints and a bearer token.
 */
import type { PlayerStateValue, TvStateValue } from '../../src/lib/game/types.ts';
import { expectRedirect, tokenHash } from './admin.ts';
import { BASE_URL } from './env.ts';
import { currentRoundIndex } from './db.ts';
import { Device, type LiveStream } from './remote.ts';

export class SimPlayer extends Device {
	gameId = '';
	playerId = '';
	color = '';
	private live: LiveStream<PlayerStateValue> | null = null;

	readonly code: string;
	readonly nickname: string;

	constructor(code: string, nickname: string, baseURL: string = BASE_URL) {
		super(baseURL);
		this.code = code;
		this.nickname = nickname;
	}

	/** The player id (known after joining). */
	get id(): string {
		return this.playerId;
	}

	/**
	 * Joins through the real `joinGame` form; `connected` then opens the player stream. `team`
	 * is the picked team (teams games where players pick their team).
	 */
	async join({ connected = true, team }: { connected?: boolean; team?: number } = {}): Promise<this> {
		expectRedirect(
			await this.form('game', 'joinGame', { code: this.code, nickname: this.nickname, team }),
			`join ${this.nickname}`
		);
		if (connected) await this.connect();
		return this;
	}

	/** (Re)opens the player stream and waits for the first `playing` snapshot. */
	async connect() {
		this.live?.close();
		this.live = this.stream<PlayerStateValue>('game', 'playerState', this.code);
		await this.live.opened;
		const s = await this.live.next((v) => v.status === 'playing');
		if (s.status === 'playing') {
			this.gameId = s.game.id;
			this.playerId = s.me.id;
			this.color = s.me.color;
		}
	}

	/** Latest snapshot once it satisfies `pred`. */
	state(pred: (v: PlayerStateValue) => boolean = () => true, timeoutMs?: number) {
		if (!this.live) throw new Error(`${this.nickname} has no open stream`);
		return this.live.next(pred, timeoutMs);
	}

	private async round(): Promise<number> {
		if (this.live) {
			const s = await this.state((v) => v.status === 'playing' && v.phase === 'round');
			if (s.status === 'playing' && s.phase === 'round') return s.round.index;
		}
		return currentRoundIndex(this.gameId);
	}

	async lockIn(lat: number, lng: number) {
		await this.command('game', 'lockIn', { gameId: this.gameId, roundIndex: await this.round(), lat, lng, touched: true });
	}

	/** A touched cross that is not locked in (counts when the timer runs out). */
	async updateGuess(lat: number, lng: number, touched = true) {
		await this.command('game', 'updateGuess', { gameId: this.gameId, roundIndex: await this.round(), lat, lng, touched });
	}

	override disconnect() {
		super.disconnect();
		this.live = null;
	}
}

export class SimTv extends Device {
	pairingCode = '';
	private live: LiveStream<TvStateValue> | null = null;

	/** Registers the screen (sets the TV cookie) and reads its pairing code from `tvState`. */
	async register(): Promise<this> {
		await this.command('game', 'registerTv');
		await this.connect();
		return this;
	}

	async connect() {
		this.live?.close();
		this.live = this.stream<TvStateValue>('game', 'tvState');
		await this.live.opened;
		const s = await this.live.next((v) => v.status === 'pairing' || v.status === 'paired');
		if (s.status === 'pairing') this.pairingCode = s.pairingCode;
	}

	state(pred: (v: TvStateValue) => boolean = () => true, timeoutMs?: number) {
		if (!this.live) throw new Error('the TV has no open stream');
		return this.live.next(pred, timeoutMs);
	}

	/** `tv_screen.token_hash` of this screen (for cleanup). */
	tokenHash(): string | null {
		const token = this.cookies.get('cw_tv');
		return token ? tokenHash(token) : null;
	}

	override disconnect() {
		super.disconnect();
		this.live = null;
	}
}

/** One event of the native TV stream: the raw JSON line and its parsed value. */
export interface NativeEvent {
	raw: string;
	value: TvStateValue;
}

/** An open `/tv/native/stream`: every event in order, and when the server ended it. */
export interface NativeStream {
	response: Response;
	events: NativeEvent[];
	/** Resolves when the server closes the stream (not on `close()`). */
	ended: Promise<void>;
	/** The latest event if it matches `pred`, otherwise the next one that does. */
	next(pred?: (v: TvStateValue) => boolean, timeoutMs?: number): Promise<NativeEvent>;
	close(): void;
}

/**
 * The Apple TV app's side of the server, as plain HTTP + JSON (`/tv/native/register`,
 * `/tv/native/stream`): no cookies, no `Origin` header, no remote-function protocol.
 */
export class NativeTv {
	readonly baseURL: string;
	token: string | null = null;
	tvId = '';
	private streams = new Set<AbortController>();

	constructor(baseURL: string = BASE_URL) {
		this.baseURL = baseURL.replace(/\/$/, '');
	}

	private auth(token = this.token): Record<string, string> {
		return token ? { authorization: `Bearer ${token}` } : {};
	}

	/** POST /tv/native/register (with the stored bearer token, if any); keeps a newly minted token. */
	async register(): Promise<{ tvId: string; token: string | null }> {
		const res = await fetch(`${this.baseURL}/tv/native/register`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...this.auth() },
			body: '{}'
		});
		if (!res.ok) throw new Error(`register: ${res.status} ${await res.text()}`);
		const body = (await res.json()) as { tvId: string; token: string | null };
		this.tvId = body.tvId;
		if (body.token) this.token = body.token;
		return body;
	}

	/** GET /tv/native/stream with `token` (default: the stored one; `null` sends no header). */
	async stream(token: string | null = this.token): Promise<NativeStream> {
		const controller = new AbortController();
		this.streams.add(controller);
		const response = await fetch(`${this.baseURL}/tv/native/stream`, {
			headers: { accept: 'text/event-stream', ...this.auth(token) },
			signal: controller.signal
		});
		if (!response.ok || !response.body) throw new Error(`stream: ${response.status}`);
		const events: NativeEvent[] = [];
		const waiters = new Set<{ pred: (v: TvStateValue) => boolean; resolve: (e: NativeEvent) => void }>();
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		const ended = (async () => {
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buffer += value;
				let idx: number;
				while ((idx = buffer.indexOf('\n\n')) >= 0) {
					const chunk = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const raw = chunk
						.split('\n')
						.filter((l) => l.startsWith('data: '))
						.map((l) => l.slice(6))
						.join('\n');
					if (!raw) continue; // keep-alive comment
					const event = { raw, value: JSON.parse(raw) as TvStateValue };
					events.push(event);
					for (const w of [...waiters]) {
						if (w.pred(event.value)) {
							waiters.delete(w);
							w.resolve(event);
						}
					}
				}
			}
		})();
		ended.catch(() => {}); // aborted by close()

		return {
			response,
			events,
			ended,
			next: (pred = () => true, timeoutMs = 15_000) => {
				const latest = events.at(-1);
				if (latest && pred(latest.value)) return Promise.resolve(latest);
				return new Promise<NativeEvent>((resolve, reject) => {
					const w = { pred, resolve };
					waiters.add(w);
					setTimeout(() => {
						if (waiters.delete(w)) {
							reject(new Error(`timed out waiting on the native stream; latest: ${events.at(-1)?.raw.slice(0, 300)}`));
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

	/** `tv_screen.token_hash` of this screen (for cleanup). */
	tokenHash(): string | null {
		return this.token ? tokenHash(this.token) : null;
	}

	disconnect() {
		for (const c of this.streams) c.abort();
		this.streams.clear();
	}
}
