/**
 * Drives a real game without the host / player UIs: an admin creates a playlist and a game,
 * pairs a TV, players join and guess, phases advance, all through the remote functions. Used by
 * the big-screen tests. Everything a driver creates is removed by `cleanup()`.
 */
import { Admin, expectRedirect } from './admin.ts';
import { BASE_URL } from './env.ts';
import { db, deleteGames, deleteTvs, expectedState, loadLocation, SEED, type LocationRow } from './db.ts';
import { SimPlayer } from './sim.ts';

export interface CreateOptions {
	/** Location ids in round order (default: Eiffel, Liberty, Sydney). */
	locations?: string[];
	rounds?: number;
	timerSeconds?: number;
	language?: 'sv' | 'en';
	playlistName?: { en: string; sv: string };
}

export class GameDriver {
	readonly admin: Admin;
	readonly gameId: string;
	readonly joinCode: string;
	readonly playlistId: string;
	readonly locations: string[];
	readonly players = new Map<string, SimPlayer>();
	/** Other games / TVs to remove in cleanup. */
	readonly extraGames: string[] = [];
	readonly tvIds = new Set<string>();

	private constructor(admin: Admin, gameId: string, joinCode: string, playlistId: string, locations: string[]) {
		this.admin = admin;
		this.gameId = gameId;
		this.joinCode = joinCode;
		this.playlistId = playlistId;
		this.locations = locations;
	}

	/** Creates a playlist from `locations` and a game on it (selection "first", no shuffle). */
	static async create(baseURL: string = BASE_URL, opts: CreateOptions = {}, admin?: Admin): Promise<GameDriver> {
		admin ??= await Admin.login(baseURL);
		const locations = opts.locations ?? [SEED.eiffel, SEED.liberty, SEED.sydney];
		const playlistId = await admin.createPlaylist(locations, {
			en: opts.playlistName?.en,
			sv: opts.playlistName?.sv,
			timerSeconds: opts.timerSeconds ?? 30
		});
		return GameDriver.createGameOn(admin, playlistId, locations, opts);
	}

	private static async createGameOn(admin: Admin, playlistId: string, locations: string[], opts: CreateOptions) {
		const r = await admin.form('game', 'createGame', {
			playlistId,
			roundCount: opts.rounds ?? Math.min(locations.length, 3),
			selection: 'first',
			shuffle: false,
			timerSeconds: opts.timerSeconds ?? 30,
			language: opts.language ?? 'en'
		});
		const gameId = expectRedirect(r, 'createGame').split('/').pop()!;
		const [row] = await db()<{ joinCode: string }[]>`select join_code as "joinCode" from game where id = ${gameId}`;
		return new GameDriver(admin, gameId, row!.joinCode, playlistId, locations);
	}

	/** Another game by the same admin on the same playlist (for re-pairing a finished TV). */
	async createAnother(opts: CreateOptions = {}): Promise<GameDriver> {
		const g = await GameDriver.createGameOn(this.admin, this.playlistId, this.locations, opts);
		this.extraGames.push(g.gameId);
		return g;
	}

	cmd(name: string, arg: unknown = { gameId: this.gameId }) {
		return this.admin.game(name, arg);
	}

	/** Pairs the TV showing `code` with this game; remembers the TV row for cleanup. */
	async pairTv(code: string) {
		const [tv] = await db()<{ id: string }[]>`select id from tv_screen where pairing_code = ${code}`;
		if (tv) this.tvIds.add(tv.id);
		const r = await this.admin.form('game', 'pairTv', { gameId: this.gameId, pairingCode: code });
		if (r.issues?.length) throw new Error(`pairTv: ${r.issues.map((i) => i.message).join(', ')}`);
	}

	/** Remember a TV for cleanup (e.g. one that never got paired). */
	trackTv(id: string | undefined) {
		if (id) this.tvIds.add(id);
	}

	/** Joins a player. `connected` keeps a live player stream open (shown as online on the TV). */
	async join(nickname: string, { connected = true }: { connected?: boolean } = {}): Promise<SimPlayer> {
		const p = new SimPlayer(this.joinCode, nickname, this.admin.baseURL);
		await p.join({ connected: false });
		const [row] = await db()<{ id: string; color: string }[]>`
			select id, color from player where game_id = ${this.gameId} and nickname = ${nickname}`;
		p.gameId = this.gameId;
		p.playerId = row!.id;
		p.color = row!.color;
		this.players.set(nickname, p);
		if (connected) await p.connect();
		return p;
	}

	async joinMany(names: string[], opts?: { connected?: boolean }) {
		const out: SimPlayer[] = [];
		// One at a time: keeps colour assignment in join order.
		for (const n of names) out.push(await this.join(n, opts));
		return out;
	}

	async connect(nickname: string) {
		await this.players.get(nickname)!.connect();
	}

	disconnect(nickname: string) {
		this.players.get(nickname)!.disconnect();
	}

	async currentRoundIndex(): Promise<number> {
		const [row] = await db()<{ currentRound: number | null }[]>`
			select current_round as "currentRound" from game where id = ${this.gameId}`;
		if (row?.currentRound == null) throw new Error('no current round');
		return row.currentRound;
	}

	/** The answer of the current round (test-side only, for "does not leak" assertions). */
	async currentTarget(): Promise<LocationRow> {
		const idx = await this.currentRoundIndex();
		const [row] = await db()<{ locationId: string }[]>`
			select location_id as "locationId" from game_round where game_id = ${this.gameId} and index = ${idx}`;
		return loadLocation(row!.locationId);
	}

	async phase(): Promise<string> {
		const [row] = await db()<{ phase: string }[]>`select phase from game where id = ${this.gameId}`;
		return row!.phase;
	}

	/** Places a player's cross; `lock` locks it in (otherwise it counts as a touched cross). */
	async guess(nickname: string, lat: number, lng: number, { lock = true }: { lock?: boolean } = {}) {
		const p = this.players.get(nickname)!;
		const input = { gameId: this.gameId, roundIndex: await this.currentRoundIndex(), lat, lng, touched: true };
		await p.command('game', lock ? 'lockIn' : 'updateGuess', input);
	}

	/** A command that moves the game on, sent from the state the game is in now. */
	private advance = async (name: string) =>
		this.cmd(name, { gameId: this.gameId, expected: await expectedState(this.gameId) });

	startRound = () => this.advance('startRound');
	endRoundNow = () => this.advance('endRoundNow');
	skipReveal = () => this.advance('skipReveal');
	nextRound = () => this.advance('nextRound');
	endGame = () => this.cmd('endGame');

	/** Removes everything this driver created. Safe to call more than once. */
	async cleanup() {
		for (const p of this.players.values()) p.disconnect();
		await deleteGames([this.gameId, ...this.extraGames]);
		await deleteTvs(this.tvIds);
		await this.admin.cleanupContent();
	}
}
