/**
 * Fixtures written straight to Postgres (fast, no UI involved) and per-test registries that
 * remove exactly what a test created.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { JOIN_CODE_ALPHABET } from '../../src/lib/game/types.ts';
import { Admin, tokenHash } from './admin.ts';
import { BASE_URL } from './env.ts';
import { currentRoundIndex, db, deleteGames, expectedState } from './db.ts';
import { Device } from './remote.ts';
import { SimPlayer, SimTv } from './sim.ts';

// --- Games inserted into Postgres ---------------------------------------------------------------

export interface TestRound {
	index: number;
	locationId: string;
	lat: number;
	lng: number;
	nameEn: string | null;
	nameSv: string | null;
}

export interface TestGame {
	id: string;
	code: string;
	rounds: TestRound[];
	cleanup: () => Promise<void>;
}

export interface InsertGameOptions {
	timerSeconds?: number;
	rounds?: number;
	/** Seeded playlist (English name). */
	playlist?: string;
	language?: 'en' | 'sv';
	/** Use these locations instead of a playlist (e.g. a photo fixture). */
	locationIds?: string[];
}

/** Inserts a lobby game the way `engine.createGame` does (game + one row per round). */
export async function insertGame(opts: InsertGameOptions = {}): Promise<TestGame> {
	const { timerSeconds = 60, rounds = 3, playlist = 'Around the world', language = 'en' } = opts;
	const sqlc = db();
	let playlistId: string | null = null;
	let locationIds = opts.locationIds;
	if (!locationIds) {
		const [pl] = await sqlc<{ id: string }[]>`select id from playlist where name_en = ${playlist} limit 1`;
		if (!pl) throw new Error(`Seeded playlist "${playlist}" not found (run pnpm seed)`);
		playlistId = pl.id;
		const items = await sqlc<{ location_id: string }[]>`
			select location_id from playlist_item where playlist_id = ${pl.id} order by position limit ${rounds}`;
		locationIds = items.map((i) => i.location_id);
	}
	if (locationIds.length === 0) throw new Error('No locations for the test game');

	for (let attempt = 0; attempt < 30; attempt++) {
		const code = Array.from(randomBytes(4), (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
		const id = await sqlc.begin(async (tx) => {
			const rows = await tx<{ id: string }[]>`
				insert into game (join_code, playlist_id, language, timer_seconds, round_count, selection)
				select ${code}, ${playlistId}, ${language}, ${timerSeconds}, ${locationIds.length}, 'first'
				where not exists (select 1 from game where join_code = ${code} and phase <> 'finished')
				returning id`;
			if (!rows.length) return null;
			const gameId = rows[0]!.id;
			for (const [index, locationId] of locationIds.entries()) {
				await tx`insert into game_round (game_id, index, location_id) values (${gameId}, ${index}, ${locationId})`;
			}
			return gameId;
		});
		if (!id) continue;
		const locs = await sqlc<{ id: string; lat: number; lng: number; name_en: string | null; name_sv: string | null }[]>`
			select id, lat, lng, name_en, name_sv from location where id in ${sqlc(locationIds)}`;
		const byId = new Map(locs.map((l) => [l.id, l]));
		return {
			id,
			code,
			rounds: locationIds.map((locationId, index) => {
				const l = byId.get(locationId)!;
				return { index, locationId, lat: l.lat, lng: l.lng, nameEn: l.name_en, nameSv: l.name_sv };
			}),
			cleanup: () => deleteGames([id])
		};
	}
	throw new Error('Could not find a free join code');
}

// --- Bot players --------------------------------------------------------------------------------

export interface Bot {
	id: string;
	nickname: string;
	updateGuess(lat: number, lng: number, touched?: boolean): Promise<void>;
	lockIn(lat: number, lng: number): Promise<void>;
	dispose(): Promise<void>;
}

/**
 * A player without a phone: inserted into Postgres with a known token, so it can guess over HTTP
 * with its cookie. It never opens a stream, so it counts as disconnected (never blocks the
 * "everyone locked in" early finish).
 */
export async function addBot(game: { id: string }, nickname: string, color = '#2debf9'): Promise<Bot> {
	const token = randomBytes(32).toString('base64url');
	const [row] = await db()<{ id: string }[]>`
		insert into player (game_id, nickname, color, token_hash) values (${game.id}, ${nickname}, ${color}, ${tokenHash(token)})
		returning id`;
	const device = new Device(BASE_URL);
	device.cookies.set(`cw_p_${game.id.replaceAll('-', '')}`, token);
	const guess = async (name: 'updateGuess' | 'lockIn', lat: number, lng: number, touched: boolean) =>
		device.command('game', name, { gameId: game.id, roundIndex: await currentRoundIndex(game.id), lat, lng, touched });
	return {
		id: row!.id,
		nickname,
		updateGuess: (lat, lng, touched = true) => guess('updateGuess', lat, lng, touched),
		lockIn: (lat, lng) => guess('lockIn', lat, lng, true),
		dispose: async () => device.disconnect()
	};
}

// --- Host commands without the host UI ------------------------------------------------------------

/** Host actions over HTTP with an admin session (for tests of the other screens). */
export class Host {
	private constructor(private readonly admin: Admin) {}

	static async login(): Promise<Host> {
		return new Host(await Admin.login(BASE_URL));
	}

	/** A command that moves the game on, sent from the state the game is in now. */
	private advance = async (name: string, gameId: string) =>
		this.admin.game(name, { gameId, expected: await expectedState(gameId) });

	startRound = (gameId: string) => this.advance('startRound', gameId);
	endRoundNow = (gameId: string) => this.advance('endRoundNow', gameId);
	skipReveal = (gameId: string) => this.advance('skipReveal', gameId);
	nextRound = (gameId: string) => this.advance('nextRound', gameId);
	endGame = (gameId: string) => this.admin.game('endGame', { gameId });
	kickPlayer = (gameId: string, playerId: string) => this.admin.game('kickPlayer', { gameId, playerId });

	async close() {
		this.admin.disconnect();
	}
}

// --- Photo fixture written to DATA_DIR ----------------------------------------------------------------

export interface PhotoLocation {
	id: string;
	cleanup: () => Promise<void>;
}

/**
 * A location with a generated photo (and a clue text), written straight to Postgres and
 * DATA_DIR/media, optionally with a start view for the guess map. Delete the games using it
 * before `cleanup()`.
 */
export async function insertPhotoLocation(
	tag: string,
	opts: { startView?: { lat: number; lng: number; zoom: number } } = {}
): Promise<PhotoLocation> {
	const fileKey = `e2e-${randomBytes(6).toString('hex')}`;
	const dir = path.resolve(process.env.DATA_DIR ?? './data', 'media', fileKey);
	await mkdir(dir, { recursive: true });
	const svg = (w: number, h: number) =>
		Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 160 100">
			<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4f0"/><stop offset="1" stop-color="#f6e2b3"/></linearGradient></defs>
			<rect width="160" height="100" fill="url(#s)"/>
			<circle cx="122" cy="26" r="11" fill="#ffd34d"/>
			<path d="M0 78 L38 40 L62 62 L92 30 L128 70 L160 52 V100 H0 Z" fill="#5b7f4a"/>
			<path d="M0 88 Q40 80 80 90 T160 86 V100 H0 Z" fill="#3c6aa8"/>
		</svg>`);
	const sizes = { sm: 480, md: 1024, lg: 1920 } as const;
	for (const [name, w] of Object.entries(sizes)) {
		const h = Math.round((w * 100) / 160);
		await sharp(svg(w, h)).webp({ quality: 80 }).toFile(path.join(dir, `${name}.webp`));
	}
	const sqlc = db();
	const [photo] = await sqlc<{ id: string }[]>`
		insert into photo (file_key, width, height, attribution, source_url)
		values (${fileKey}, 1920, 1200, ${`E2E ${tag} / CC0`}, null) returning id`;
	const [loc] = await sqlc<{ id: string }[]>`
		insert into location (name_en, name_sv, clue_text_en, clue_text_sv, fact_en, fact_sv, lat, lng, photo_id,
			start_lat, start_lng, start_zoom)
		values (${`E2E ${tag} Lake Bled`}, ${`E2E ${tag} Bledsjön`},
			'A church on a tiny island in an Alpine lake.', 'En kyrka på en liten ö i en alpsjö.',
			'The only natural island in Slovenia.', 'Sloveniens enda naturliga ö.',
			46.3625, 14.0936, ${photo!.id},
			${opts.startView?.lat ?? null}, ${opts.startView?.lng ?? null}, ${opts.startView?.zoom ?? null})
		returning id`;
	return {
		id: loc!.id,
		cleanup: async () => {
			await sqlc`delete from location where id = ${loc!.id}`;
			await sqlc`delete from photo where id = ${photo!.id}`;
			await rm(dir, { recursive: true, force: true });
		}
	};
}

// --- Per-test registry --------------------------------------------------------------------------

/** What a test created (games, simulated players and TVs), removed by `cleanup()`. */
export class Created {
	games = new Set<string>();
	players: SimPlayer[] = [];
	tvs: SimTv[] = [];

	/** Joins simulated players (each keeps a live stream open, so they count as connected). */
	async join(code: string, ...names: string[]): Promise<SimPlayer[]> {
		const joined: SimPlayer[] = [];
		// In order, so colours follow the join order.
		for (const n of names) joined.push(await new SimPlayer(code, n).join());
		this.players.push(...joined);
		return joined;
	}

	async tv(): Promise<SimTv> {
		const tv = await new SimTv(BASE_URL).register();
		this.tvs.push(tv);
		return tv;
	}

	async cleanup() {
		for (const p of this.players) p.disconnect();
		for (const tv of this.tvs) tv.disconnect();
		const hashes = this.tvs.map((tv) => tv.tokenHash()).filter((h): h is string => !!h);
		if (hashes.length) await db()`delete from tv_screen where token_hash = any(${hashes})`;
		await deleteGames(this.games);
	}
}
