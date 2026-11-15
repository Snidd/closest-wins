/**
 * Test harness for the player phone: drives a real game without the host UI.
 *
 * - Games are inserted straight into Postgres from a seeded playlist (random free join code)
 *   and deleted afterwards (`cleanup()`), so tests never depend on the host screens.
 * - Host actions (`startRound`, `endRoundNow`, `skipReveal`, `nextRound`, `kickPlayer`,
 *   `endGame`) call the game's remote commands over HTTP exactly like the browser does:
 *   `POST /_app/remote/<hash>/<name>` with `{ payload, refreshes }`, where `<hash>` is Kit's
 *   djb2 hash of the module path and `payload` is base64url(devalue.stringify(arg)). The
 *   admin session comes from logging in on `/login` in a throwaway browser context.
 * - Bot players are inserted into Postgres with a known token, so they can `updateGuess` /
 *   `lockIn` over HTTP with their cookie. They never open a stream, so they count as
 *   disconnected (they never block the "everyone locked in" early finish).
 *
 * Other agents share the database: only rows created here are touched.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';
import {
	expect,
	request as playwrightRequest,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page
} from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

// --- Database ----------------------------------------------------------------------------------

let sql: postgres.Sql | null = null;
export const db = () => (sql ??= postgres(process.env.DATABASE_URL!, { max: 3, onnotice: () => {} }));
export async function closeDb() {
	await sql?.end();
	sql = null;
}

// --- Remote function wire format -----------------------------------------------------------------

/** Kit's djb2 hash (utils/hash.js), used for remote module ids. */
function djb2(value: string): string {
	let hash = 5381;
	let i = value.length;
	while (i) hash = (hash * 33) ^ value.charCodeAt(--i);
	return (hash >>> 0).toString(36);
}
const GAME_REMOTE_ID = djb2('src/lib/remote/game.remote.ts');

type Flat = Record<string, string | number | boolean>;

/** devalue.stringify for a flat object of primitives: `[{"k":1,…}, v1, …]`. */
function devalueFlat(value: Flat): string {
	const keys = Object.keys(value);
	const root: Record<string, number> = {};
	keys.forEach((k, i) => (root[k] = i + 1));
	return JSON.stringify([root, ...keys.map((k) => value[k])]);
}
const encodeArg = (value: Flat) => Buffer.from(devalueFlat(value), 'utf8').toString('base64url');

export class RemoteError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(`${status} ${message}`);
	}
}

async function callCommand(ctx: APIRequestContext, name: string, arg: Flat, headers: Record<string, string> = {}) {
	const res = await ctx.post(`${BASE_URL}/_app/remote/${GAME_REMOTE_ID}/${name}`, {
		headers: { 'content-type': 'application/json', origin: new URL(BASE_URL).origin, ...headers },
		data: JSON.stringify({ payload: encodeArg(arg), refreshes: [] })
	});
	const body = (await res.json().catch(() => null)) as { type?: string; error?: { message?: string } } | null;
	if (!res.ok() || body?.type === 'error') {
		throw new RemoteError(res.status(), body?.error?.message ?? res.statusText());
	}
}

// --- Host ----------------------------------------------------------------------------------------

export class Host {
	private constructor(
		private readonly context: BrowserContext,
		private readonly ctx: APIRequestContext
	) {}

	/** Logs in as admin in a separate browser context; its cookie jar backs the HTTP calls. */
	static async login(browser: Browser): Promise<Host> {
		const context = await browser.newContext({ locale: 'en-US', baseURL: BASE_URL });
		const page = await context.newPage();
		await page.goto('/login?next=/admin');
		await page.getByLabel('Admin password').fill(process.env.ADMIN_PASSWORD!);
		await page.getByLabel('Admin password').press('Enter');
		await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
		await page.close();
		return new Host(context, context.request);
	}

	startRound = (gameId: string) => callCommand(this.ctx, 'startRound', { gameId });
	endRoundNow = (gameId: string) => callCommand(this.ctx, 'endRoundNow', { gameId });
	skipReveal = (gameId: string) => callCommand(this.ctx, 'skipReveal', { gameId });
	nextRound = (gameId: string) => callCommand(this.ctx, 'nextRound', { gameId });
	endGame = (gameId: string) => callCommand(this.ctx, 'endGame', { gameId });
	kickPlayer = (gameId: string, playerId: string) => callCommand(this.ctx, 'kickPlayer', { gameId, playerId });

	async close() {
		await this.context.close();
	}
}

// --- Games ---------------------------------------------------------------------------------------

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

export interface CreateGameOptions {
	timerSeconds?: number;
	rounds?: number;
	/** Seeded playlist (English name). */
	playlist?: string;
	language?: 'en' | 'sv';
	/** Use these locations instead of a playlist (e.g. a photo fixture). */
	locationIds?: string[];
}

/** Inserts a lobby game the way `engine.createGame` does (game + one row per round). */
export async function createGame(opts: CreateGameOptions = {}): Promise<TestGame> {
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
		const code = Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
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
			cleanup: async () => void (await sqlc`delete from game where id = ${id}`)
		};
	}
	throw new Error('Could not find a free join code');
}

export async function playerIdByNickname(gameId: string, nickname: string): Promise<string> {
	const [p] = await db()<{ id: string }[]>`select id from player where game_id = ${gameId} and nickname = ${nickname}`;
	if (!p) throw new Error(`No player ${nickname}`);
	return p.id;
}

/** The player's guess in the game's current round, if any. */
export async function currentGuess(gameId: string, playerId: string) {
	const [g] = await db()<{ lat: number; lng: number; touched: boolean; locked_at: Date | null; distance_km: number | null }[]>`
		select g.lat, g.lng, g.touched, g.locked_at, g.distance_km
		from guess g join game_round r on r.id = g.round_id join game on game.id = r.game_id
		where game.id = ${gameId} and r.index = game.current_round and g.player_id = ${playerId}`;
	return g ?? null;
}

export async function currentRoundIndex(gameId: string): Promise<number> {
	const [g] = await db()<{ current_round: number | null }[]>`select current_round from game where id = ${gameId}`;
	if (g?.current_round == null) throw new Error('No current round');
	return g.current_round;
}

// --- Bot players ---------------------------------------------------------------------------------

export interface Bot {
	id: string;
	nickname: string;
	updateGuess(lat: number, lng: number, touched?: boolean): Promise<void>;
	lockIn(lat: number, lng: number): Promise<void>;
	dispose(): Promise<void>;
}

/** A player without a phone: inserted into Postgres with a known token. */
export async function addBot(game: TestGame, nickname: string, color = '#2debf9'): Promise<Bot> {
	const token = randomBytes(32).toString('base64url');
	const hash = createHash('sha256').update(token, 'utf8').digest('hex');
	const [row] = await db()<{ id: string }[]>`
		insert into player (game_id, nickname, color, token_hash) values (${game.id}, ${nickname}, ${color}, ${hash})
		returning id`;
	const ctx = await playwrightRequest.newContext();
	const cookie = { cookie: `cw_p_${game.id.replaceAll('-', '')}=${token}` };
	const guess = async (name: 'updateGuess' | 'lockIn', lat: number, lng: number, touched: boolean) =>
		callCommand(
			ctx,
			name,
			{ gameId: game.id, roundIndex: await currentRoundIndex(game.id), lat, lng, touched },
			cookie
		);
	return {
		id: row!.id,
		nickname,
		updateGuess: (lat, lng, touched = true) => guess('updateGuess', lat, lng, touched),
		lockIn: (lat, lng) => guess('lockIn', lat, lng, true),
		dispose: () => ctx.dispose()
	};
}

// --- Photo fixture -------------------------------------------------------------------------------

export interface PhotoLocation {
	id: string;
	cleanup: () => Promise<void>;
}

/**
 * A location with a generated photo (and a clue text), for the photo viewer. Test fixture only:
 * written straight to Postgres and DATA_DIR/media; delete the games using it before `cleanup()`.
 */
export async function createPhotoLocation(tag: string): Promise<PhotoLocation> {
	const fileKey = `e2e-player-${randomBytes(6).toString('hex')}`;
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
		insert into location (name_en, name_sv, clue_text_en, clue_text_sv, fact_en, fact_sv, lat, lng, photo_id)
		values (${`E2E ${tag} Lake Bled`}, ${`E2E ${tag} Bledsjön`},
			'A church on a tiny island in an Alpine lake.', 'En kyrka på en liten ö i en alpsjö.',
			'The only natural island in Slovenia.', 'Sloveniens enda naturliga ö.',
			46.3625, 14.0936, ${photo!.id})
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

// --- Phones --------------------------------------------------------------------------------------

export interface PhoneOptions {
	locale?: string;
	viewport?: { width: number; height: number };
	colorScheme?: 'light' | 'dark';
}

export async function newPhone(browser: Browser, opts: PhoneOptions = {}) {
	const context = await browser.newContext({
		baseURL: BASE_URL,
		locale: opts.locale ?? 'en-US',
		viewport: opts.viewport ?? { width: 390, height: 844 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		colorScheme: opts.colorScheme ?? 'light',
		reducedMotion: 'reduce'
	});
	const page = await context.newPage();
	return { context, page };
}

/** Joins through the real join page and waits for the player screen. */
export async function joinViaUi(page: Page, code: string, nickname: string) {
	await page.goto(`/join/${code}`);
	const input = page.locator('#nickname');
	await input.waitFor();
	await page.waitForLoadState('networkidle');
	await input.fill(nickname);
	await input.press('Enter');
	await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 20_000 });
	await expect(page.getByTestId('player-app')).toBeVisible({ timeout: 20_000 });
}

type Pt = { x: number; y: number };

/** One-finger drag with real touch events (CDP), held still before release (no inertia). */
export async function touchDrag(page: Page, from: Pt, to: Pt, steps = 12) {
	const cdp = await page.context().newCDPSession(page);
	const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 2, radiusY: 2, force: 1 }))
		});
	await send('touchStart', [from]);
	for (let s = 1; s <= steps; s++) {
		const f = s / steps;
		await send('touchMove', [{ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }]);
		await page.waitForTimeout(16);
	}
	await page.waitForTimeout(120);
	await send('touchEnd', []);
	await cdp.detach();
}

/** Pans the guess map by dragging across the middle of the screen. */
export async function panMap(page: Page, dx = -80, dy = 40) {
	await expect(page.locator('.guess-map')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
	const vp = page.viewportSize()!;
	const from = { x: vp.width / 2 - dx / 2, y: vp.height / 2 + 30 - dy / 2 };
	await touchDrag(page, from, { x: from.x + dx, y: from.y + dy });
}

/** GUESS_UPDATE_DEBOUNCE_MS (400) plus slack. */
export const GUESS_DEBOUNCE_WAIT = 700;
