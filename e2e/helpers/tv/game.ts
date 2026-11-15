/**
 * Drives a real game for the big-screen tests without the host / player UIs: logs in as admin,
 * creates a playlist + game, pairs a TV, joins players, places guesses and advances phases,
 * all through the app's remote functions over HTTP (see `remote.ts`). Postgres is only used
 * for reads the UI would get elsewhere (join code, player ids, the current round's answer for
 * "must not leak" assertions) and for cleanup of the games and TV rows a test created.
 *
 * Everything a driver creates is removed by `cleanup()`; nothing global is touched, so tests
 * can run next to other agents on the same database.
 */
import postgres from 'postgres';
import { RemoteClient, remoteIds, type FormResult } from './remote.ts';

let sql: postgres.Sql | null = null;
export const db = () => (sql ??= postgres(process.env.DATABASE_URL!, { max: 3, onnotice: () => {} }));
export async function closeDb() {
	await sql?.end();
	sql = null;
}

/** Seeded locations (scripts/seed-data.ts), fixed ids. */
export const SEED = {
	eiffel: 'c0ffee00-0000-4000-8000-000000000001',
	liberty: 'c0ffee00-0000-4000-8000-000000000002',
	sydney: 'c0ffee00-0000-4000-8000-000000000003',
	giza: 'c0ffee00-0000-4000-8000-000000000004',
	machuPicchu: 'c0ffee00-0000-4000-8000-000000000005'
} as const;

export interface LocationRow {
	id: string;
	nameSv: string | null;
	nameEn: string | null;
	factSv: string | null;
	factEn: string | null;
	clueTextSv: string | null;
	clueTextEn: string | null;
	lat: number;
	lng: number;
}

export async function loadLocation(id: string): Promise<LocationRow> {
	const [row] = await db()<LocationRow[]>`
		select id, name_sv as "nameSv", name_en as "nameEn", fact_sv as "factSv", fact_en as "factEn",
			clue_text_sv as "clueTextSv", clue_text_en as "clueTextEn", lat, lng
		from location where id = ${id}`;
	if (!row) throw new Error(`location ${id} not found (run pnpm seed)`);
	return row;
}

function expectRedirect(r: FormResult, what: string): string {
	if (!r.redirect) throw new Error(`${what} did not redirect: ${JSON.stringify(r.issues ?? r)}`);
	return r.redirect;
}

/** An admin session (one cookie jar). */
export class Admin {
	readonly client: RemoteClient;
	readonly baseURL: string;
	private constructor(baseURL: string) {
		this.baseURL = baseURL;
		this.client = new RemoteClient(baseURL);
	}

	static async login(baseURL: string): Promise<Admin> {
		const a = new Admin(baseURL);
		const auth = await remoteIds(baseURL, 'auth');
		const r = await a.client.form(auth.login!, { _password: process.env.ADMIN_PASSWORD!, next: '/' });
		expectRedirect(r, 'login');
		if (![...a.client.cookies.keys()].includes('cw_admin')) throw new Error('login did not set the admin cookie');
		return a;
	}

	async game(name: string) {
		return (await remoteIds(this.baseURL, 'game'))[name]!;
	}
	async content(name: string) {
		return (await remoteIds(this.baseURL, 'content'))[name]!;
	}

	readonly ownLocations: string[] = [];
	readonly ownPhotos: string[] = [];

	/** Uploads a photo and creates a location using it (removed by `cleanupContent`). */
	async createPhotoLocation(opts: {
		image: Buffer;
		attribution?: string;
		nameEn: string;
		nameSv?: string;
		clueTextEn?: string;
		clueTextSv?: string;
		factEn?: string;
		lat: number;
		lng: number;
	}): Promise<{ locationId: string; photoId: string; fileKey: string }> {
		const up = await this.client.form<{ id: string; fileKey: string }>(await this.content('uploadPhoto'), {
			file: new File([new Uint8Array(opts.image)], 'clue.jpg', { type: 'image/jpeg' }),
			attribution: opts.attribution ?? ''
		});
		const photo = up.result;
		if (!photo?.id) throw new Error(`uploadPhoto failed: ${JSON.stringify(up)}`);
		this.ownPhotos.push(photo.id);
		const loc = await this.client.form<{ id: string }>(await this.content('createLocation'), {
			nameEn: opts.nameEn,
			nameSv: opts.nameSv ?? '',
			clueTextEn: opts.clueTextEn ?? '',
			clueTextSv: opts.clueTextSv ?? '',
			factEn: opts.factEn ?? '',
			factSv: '',
			lat: opts.lat,
			lng: opts.lng,
			photoId: photo.id
		});
		const id = loc.result?.id;
		if (!id) throw new Error(`createLocation failed: ${JSON.stringify(loc)}`);
		this.ownLocations.push(id);
		return { locationId: id, photoId: photo.id, fileKey: photo.fileKey };
	}

	/** Deletes the locations and photos this admin created (after the games using them). */
	async cleanupContent() {
		for (const id of this.ownLocations.splice(0)) {
			await this.client.command(await this.content('deleteLocation'), { id }).catch(() => {});
		}
		for (const id of this.ownPhotos.splice(0)) {
			await this.client.command(await this.content('deletePhoto'), { id }).catch(() => {});
		}
	}
}

export interface CreateOptions {
	/** Location ids in round order (default: Eiffel, Liberty, Sydney). */
	locations?: string[];
	rounds?: number;
	timerSeconds?: number;
	language?: 'sv' | 'en';
	playlistName?: { en: string; sv: string };
}

export interface DriverPlayer {
	id: string;
	nickname: string;
	client: RemoteClient;
	color: string;
}

export class GameDriver {
	readonly admin: Admin;
	readonly gameId: string;
	readonly joinCode: string;
	readonly playlistId: string;
	readonly locations: string[];
	readonly players = new Map<string, DriverPlayer>();
	/** Other games/TVs/photos/locations to remove in cleanup. */
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
	static async create(baseURL: string, opts: CreateOptions = {}, admin?: Admin): Promise<GameDriver> {
		admin ??= await Admin.login(baseURL);
		const locations = opts.locations ?? [SEED.eiffel, SEED.liberty, SEED.sydney];
		const tag = Math.random().toString(36).slice(2, 7);
		const name = opts.playlistName ?? { en: `TV test ${tag}`, sv: `TV-test ${tag}` };
		const pl = await admin.client.form<{ id: string }>(await admin.content('createPlaylist'), {
			nameEn: name.en,
			nameSv: name.sv,
			defaultTimerSeconds: opts.timerSeconds ?? 30
		});
		const playlistId = pl.result?.id;
		if (!playlistId) throw new Error(`createPlaylist failed: ${JSON.stringify(pl)}`);
		await admin.client.command(await admin.content('setPlaylistItems'), { playlistId, locationIds: locations });
		return GameDriver.createGameOn(admin, playlistId, locations, opts);
	}

	private static async createGameOn(admin: Admin, playlistId: string, locations: string[], opts: CreateOptions) {
		const r = await admin.client.form(await admin.game('createGame'), {
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

	async cmd(name: string, arg: unknown = { gameId: this.gameId }) {
		return this.admin.client.command(await this.admin.game(name), arg);
	}

	/** Pairs the TV showing `code` with this game; remembers the TV row for cleanup. */
	async pairTv(code: string) {
		const [tv] = await db()<{ id: string }[]>`select id from tv_screen where pairing_code = ${code}`;
		if (tv) this.tvIds.add(tv.id);
		const r = await this.admin.client.form(await this.admin.game('pairTv'), { gameId: this.gameId, pairingCode: code });
		if (r.issues?.length) throw new Error(`pairTv: ${r.issues.map((i) => i.message).join(', ')}`);
	}

	/** Remember a TV for cleanup (e.g. one that never got paired). */
	trackTv(id: string | undefined) {
		if (id) this.tvIds.add(id);
	}

	/** Joins a player. `connected` keeps a live player stream open (shown as online on the TV). */
	async join(nickname: string, { connected = true }: { connected?: boolean } = {}): Promise<DriverPlayer> {
		const client = new RemoteClient(this.admin.baseURL);
		const r = await client.form(await this.admin.game('joinGame'), { code: this.joinCode, nickname });
		expectRedirect(r, `join ${nickname}`);
		const [row] = await db()<{ id: string; color: string }[]>`
			select id, color from player where game_id = ${this.gameId} and nickname = ${nickname}`;
		const p: DriverPlayer = { id: row!.id, nickname, client, color: row!.color };
		this.players.set(nickname, p);
		if (connected) await this.connect(nickname);
		return p;
	}

	async joinMany(names: string[], opts?: { connected?: boolean }) {
		const out: DriverPlayer[] = [];
		// A few at a time: keeps colour assignment in join order and the server relaxed.
		for (let i = 0; i < names.length; i += 5) {
			const batch = names.slice(i, i + 5);
			for (const n of batch) out.push(await this.join(n, opts));
		}
		return out;
	}

	async connect(nickname: string) {
		const p = this.players.get(nickname)!;
		await p.client.openLive(await this.admin.game('playerState'), this.joinCode);
	}

	disconnect(nickname: string) {
		this.players.get(nickname)!.client.closeStreams();
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
		await p.client.command(await this.admin.game(lock ? 'lockIn' : 'updateGuess'), input);
	}

	startRound = () => this.cmd('startRound');
	endRoundNow = () => this.cmd('endRoundNow');
	skipReveal = () => this.cmd('skipReveal');
	nextRound = () => this.cmd('nextRound');
	endGame = () => this.cmd('endGame');

	/** Removes everything this driver created. Safe to call more than once. */
	async cleanup() {
		for (const p of this.players.values()) p.client.closeStreams();
		const games = [this.gameId, ...this.extraGames];
		await db()`delete from game where id = any(${games}::uuid[])`;
		if (this.tvIds.size) await db()`delete from tv_screen where id = any(${[...this.tvIds]}::uuid[])`;
		await this.admin.client.command(await this.admin.content('deletePlaylist'), { id: this.playlistId }).catch(() => {});
		await this.admin.cleanupContent();
	}
}
