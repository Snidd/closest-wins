/**
 * Simulated players and TV screens (no UI): they join, keep a live stream open (so they count
 * as connected), guess and pair through the real remote functions over HTTP.
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

	/** Joins through the real `joinGame` form; `connected` then opens the player stream. */
	async join({ connected = true }: { connected?: boolean } = {}): Promise<this> {
		expectRedirect(await this.form('game', 'joinGame', { code: this.code, nickname: this.nickname }), `join ${this.nickname}`);
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
