/**
 * The admin side: an `Admin` device (logged in over HTTP, for setting up content and driving a
 * game without the host UI) and helpers for the real `/login` and `/host` pages.
 */
import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { adminPassword, BASE_URL } from './env.ts';
import { LANDMARKS } from './db.ts';
import { Device, type FormResult } from './remote.ts';

export function expectRedirect(r: FormResult, what: string): string {
	if (!r.redirect) throw new Error(`${what} did not redirect: ${JSON.stringify(r.issues ?? r)}`);
	return r.redirect;
}

/** An admin session (one cookie jar) talking to the remote functions. */
export class Admin extends Device {
	readonly ownLocations: string[] = [];
	readonly ownPhotos: string[] = [];
	readonly ownPlaylists: string[] = [];

	static async login(baseURL: string = BASE_URL): Promise<Admin> {
		const a = new Admin(baseURL);
		expectRedirect(await a.form('auth', 'login', { _password: adminPassword(), next: '/' }), 'login');
		if (!a.cookies.has('cw_admin')) throw new Error('login did not set the admin cookie');
		return a;
	}

	/** A game command (`startRound`, `nextRound`, …) for `gameId`. */
	game(name: string, arg: unknown) {
		return this.command('game', name, arg);
	}

	/** Creates a playlist with these locations in order (removed by `cleanupContent`). */
	async createPlaylist(locationIds: string[], opts: { en?: string; sv?: string; timerSeconds?: number } = {}) {
		const tag = Math.random().toString(36).slice(2, 7);
		const r = await this.form<{ id: string }>('content', 'createPlaylist', {
			nameEn: opts.en ?? `E2E list ${tag}`,
			nameSv: opts.sv ?? `E2E-lista ${tag}`,
			defaultTimerSeconds: opts.timerSeconds ?? 30
		});
		const id = r.result?.id;
		if (!id) throw new Error(`createPlaylist failed: ${JSON.stringify(r)}`);
		this.ownPlaylists.push(id);
		await this.command('content', 'setPlaylistItems', { playlistId: id, locationIds });
		return id;
	}

	/** Uploads a photo and creates a location using it (removed by `cleanupContent`). */
	async createPhotoLocation(opts: {
		image: Buffer;
		attribution?: string;
		nameEn: string;
		nameSv?: string;
		clueTextEn?: string;
		clueTextSv?: string;
		factEn?: string;
		factSv?: string;
		lat: number;
		lng: number;
	}): Promise<{ locationId: string; photoId: string; fileKey: string }> {
		const up = await this.form<{ id: string; fileKey: string }>('content', 'uploadPhoto', {
			file: new File([new Uint8Array(opts.image)], 'clue.jpg', { type: 'image/jpeg' }),
			attribution: opts.attribution ?? ''
		});
		const photo = up.result;
		if (!photo?.id) throw new Error(`uploadPhoto failed: ${JSON.stringify(up)}`);
		this.ownPhotos.push(photo.id);
		const loc = await this.form<{ id: string }>('content', 'createLocation', {
			nameEn: opts.nameEn,
			nameSv: opts.nameSv ?? '',
			clueTextEn: opts.clueTextEn ?? '',
			clueTextSv: opts.clueTextSv ?? '',
			factEn: opts.factEn ?? '',
			factSv: opts.factSv ?? '',
			lat: opts.lat,
			lng: opts.lng,
			photoId: photo.id
		});
		const id = loc.result?.id;
		if (!id) throw new Error(`createLocation failed: ${JSON.stringify(loc)}`);
		this.ownLocations.push(id);
		return { locationId: id, photoId: photo.id, fileKey: photo.fileKey };
	}

	/** Deletes the playlists, locations and photos this admin created (after the games using them). */
	async cleanupContent() {
		for (const id of this.ownPlaylists.splice(0)) {
			await this.command('content', 'deletePlaylist', { id }).catch(() => {});
		}
		for (const id of this.ownLocations.splice(0)) {
			await this.command('content', 'deleteLocation', { id }).catch(() => {});
		}
		for (const id of this.ownPhotos.splice(0)) {
			await this.command('content', 'deletePhoto', { id }).catch(() => {});
		}
	}
}

/** SHA-256 hex of a token, as stored in `player.token_hash` / `tv_screen.token_hash`. */
export function tokenHash(token: string): string {
	return createHash('sha256').update(decodeURIComponent(token), 'utf8').digest('hex');
}

// --- The real host pages ----------------------------------------------------------------------

/** Logs in through `/login` (the page's password field) and lands on `next`. */
export async function loginHost(page: Page, next = '/host') {
	await page.goto(`/login?next=${encodeURIComponent(next)}`);
	await page.locator('#password').fill(adminPassword());
	await page.locator('#password').press('Enter');
	await page.waitForURL((u) => u.pathname === next);
	if (next === '/host') await hostHomeReady(page);
}

/** The create form is hydrated (its custom controls respond to taps). */
export async function hostHomeReady(page: Page) {
	await page.locator('form[data-ready="true"]').waitFor();
}

/**
 * Creates a game through the `/host` form and lands in its lobby. `rounds`/`seconds` are typed
 * into the steppers when given (defaults: all, the playlist's default timer).
 */
export async function createGameViaUi(
	page: Page,
	opts: { rounds?: number; seconds?: number; playlist?: string; onCreated?: (gameId: string) => void } = {}
): Promise<{ gameId: string; code: string }> {
	if (new URL(page.url()).pathname !== '/host') await page.goto('/host');
	await hostHomeReady(page);
	await page.getByTestId('playlist-option').filter({ hasText: opts.playlist ?? LANDMARKS.en }).click();
	if (opts.rounds !== undefined) await page.locator('#rounds').fill(String(opts.rounds));
	if (opts.seconds !== undefined) await page.locator('#seconds').fill(String(opts.seconds));
	await page.getByTestId('create-game').click();
	await page.waitForURL(/\/host\/[0-9a-f-]{36}$/);
	const gameId = new URL(page.url()).pathname.split('/').pop()!;
	opts.onCreated?.(gameId);
	const code = (await page.getByTestId('join-code').textContent())!.trim();
	expect(code).toMatch(/^[A-Z]{4}$/);
	return { gameId, code };
}
