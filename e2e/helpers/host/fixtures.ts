/**
 * Host controller test fixtures: log in, create a game through the real form, and keep track of
 * everything a test creates (games, simulated players and TVs) so `cleanup()` removes exactly
 * that. Other agents use the same database: never truncate, never assert on global counts.
 */
import postgres from 'postgres';
import { expect, type Page } from '@playwright/test';
import { SimPlayer, SimTv } from './sim.ts';

/** Seeded by `pnpm seed` (scripts/seed.ts): 8 locations, default timer 30 s. */
export const LANDMARKS = { id: 'c0ffee00-0000-4000-9000-000000000001', en: 'Famous landmarks', sv: 'Kända landmärken', size: 8 };

let sql: postgres.Sql | null = null;
export const db = () => (sql ??= postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }));
export async function closeDb() {
	await sql?.end();
	sql = null;
}

export async function loginHost(page: Page, next = '/host') {
	await page.goto(`/login?next=${encodeURIComponent(next)}`);
	await page.locator('#password').fill(process.env.ADMIN_PASSWORD!);
	await page.locator('#password').press('Enter');
	await page.waitForURL((u) => u.pathname === next);
	if (next === '/host') await hostHomeReady(page);
}

/** The create form is hydrated (its custom controls respond to taps). */
export async function hostHomeReady(page: Page) {
	await page.locator('form[data-ready="true"]').waitFor();
}

/** Per-test registry of what was created, removed by `cleanup()`. */
export class Created {
	games = new Set<string>();
	players: SimPlayer[] = [];
	tvs: SimTv[] = [];

	private baseURL: string;

	constructor(baseURL: string) {
		this.baseURL = baseURL;
	}

	/** Joins simulated players (each keeps a live stream open, so they count as connected). */
	async join(code: string, ...names: string[]): Promise<SimPlayer[]> {
		const joined = await Promise.all(names.map((n) => new SimPlayer(this.baseURL, code, n).join()));
		this.players.push(...joined);
		return joined;
	}

	async tv(): Promise<SimTv> {
		const tv = await new SimTv(this.baseURL).register();
		this.tvs.push(tv);
		return tv;
	}

	async cleanup() {
		for (const p of this.players) p.disconnect();
		for (const tv of this.tvs) tv.disconnect();
		const hashes = this.tvs.map((tv) => tv.tokenHash()).filter((h): h is string => !!h);
		if (hashes.length) await db()`delete from tv_screen where token_hash = any(${hashes})`;
		if (this.games.size) await db()`delete from game where id = any(${[...this.games]})`;
	}
}

/**
 * Creates a game from the seeded playlist through the `/host` form and lands in its lobby.
 * `rounds`/`seconds` are typed into the steppers when given (defaults: all, playlist default).
 */
export async function createGame(
	page: Page,
	created: Created,
	opts: { rounds?: number; seconds?: number; playlist?: string } = {}
): Promise<{ gameId: string; code: string }> {
	if (new URL(page.url()).pathname !== '/host') await page.goto('/host');
	await hostHomeReady(page);
	await page.getByTestId('playlist-option').filter({ hasText: opts.playlist ?? LANDMARKS.en }).click();
	if (opts.rounds !== undefined) await page.locator('#rounds').fill(String(opts.rounds));
	if (opts.seconds !== undefined) await page.locator('#seconds').fill(String(opts.seconds));
	await page.getByTestId('create-game').click();
	await page.waitForURL(/\/host\/[0-9a-f-]{36}$/);
	const gameId = new URL(page.url()).pathname.split('/').pop()!;
	created.games.add(gameId);
	const code = (await page.getByTestId('join-code').textContent())!.trim();
	expect(code).toMatch(/^[A-Z]{4}$/);
	return { gameId, code };
}

/** Phase of a game straight from the database (to prove what the engine did, not the UI). */
export async function dbGame(gameId: string) {
	const [row] = await db()`
		select phase, round_count, selection, shuffle, timer_seconds, language,
			(select count(*)::int from game_round r where r.game_id = g.id and r.started_at is not null) as started
		from game g where id = ${gameId}`;
	return row as {
		phase: string;
		round_count: number;
		selection: string;
		shuffle: boolean;
		timer_seconds: number;
		language: string;
		started: number;
	};
}
