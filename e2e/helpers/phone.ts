/**
 * Phones: mobile browser contexts with touch, the real join page, and one-finger drags with
 * real touch events (CDP) for the guess map.
 */
import { expect, type Browser, type Page } from '@playwright/test';
import { BASE_URL } from './env.ts';

export interface PhoneOptions {
	locale?: string;
	viewport?: { width: number; height: number };
	colorScheme?: 'light' | 'dark';
	reducedMotion?: 'reduce' | 'no-preference';
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
		reducedMotion: opts.reducedMotion ?? 'reduce'
	});
	const page = await context.newPage();
	return { context, page };
}

/** Fills in the nickname on an open join page and waits for the player screen. */
export async function submitNickname(page: Page, code: string, nickname: string) {
	const input = page.locator('#nickname');
	await input.waitFor();
	// The form is hydrated (Enter submits through the remote form, not a full page post).
	await expect(page.locator('main.join')).toHaveAttribute('data-hydrated', 'true');
	await input.fill(nickname);
	await input.press('Enter');
	await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 20_000 });
	await expect(page.getByTestId('player-app')).toBeVisible({ timeout: 20_000 });
}

/** Joins through the real join page and waits for the player screen. */
export async function joinViaUi(page: Page, code: string, nickname: string) {
	await page.goto(`/join/${code}`);
	await submitNickname(page, code, nickname);
}

export type Pt = { x: number; y: number };

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

/** Waits until the guess map has drawn its first tiles. */
export async function mapReady(page: Page) {
	await expect(page.locator('.guess-map')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
}

/** Pans the guess map by dragging across the middle of the screen. */
export async function panMap(page: Page, dx = -80, dy = 40) {
	await mapReady(page);
	const vp = page.viewportSize()!;
	const from = { x: vp.width / 2 - dx / 2, y: vp.height / 2 + 30 - dy / 2 };
	await touchDrag(page, from, { x: from.x + dx, y: from.y + dy });
}

/** GUESS_UPDATE_DEBOUNCE_MS (400) plus slack. */
export const GUESS_DEBOUNCE_WAIT = 700;

// --- Steering the guess map by touch -------------------------------------------------------------

export interface MapView {
	lat: number;
	lng: number;
	zoom: number;
	touched: boolean;
}

/** Web Mercator y in world fractions (0 at the top). */
function mercY(lat: number): number {
	const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
	return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
}

/** The phone's own record of its cross (`RoundScreen` keeps it in sessionStorage per round). */
async function readView(page: Page, key: string): Promise<MapView | null> {
	return page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), key);
}

async function waitForNewView(page: Page, key: string, before: string, timeoutMs = 2500): Promise<MapView | null> {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const v = await readView(page, key);
		if (v && JSON.stringify(v) !== before) return v;
		if (Date.now() > end) return v;
		await page.waitForTimeout(100);
	}
}

/**
 * One finger stroke moving the map by (fx, fy) CSS pixels, held still before lifting (no
 * inertia). MapLibre ignores very short drags (its click tolerance swallows the start of a
 * gesture), so a short move is done as an overshoot and a way back.
 */
async function stroke(page: Page, fx: number, fy: number): Promise<void> {
	const len = Math.hypot(fx, fy);
	if (len < 40) {
		const ux = len ? fx / len : 1;
		const uy = len ? fy / len : 0;
		await stroke(page, fx + ux * 60, fy + uy * 60);
		await stroke(page, -ux * 60, -uy * 60);
		return;
	}
	const vp = page.viewportSize()!;
	const start = { x: vp.width / 2 - fx / 2, y: vp.height / 2 + 20 - fy / 2 };
	const cdp = await page.context().newCDPSession(page);
	const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 2, radiusY: 2, force: 1 }))
		});
	await send('touchStart', [start]);
	const steps = 10;
	for (let s = 1; s <= steps; s++) {
		await send('touchMove', [{ x: start.x + (fx * s) / steps, y: start.y + (fy * s) / steps }]);
		await page.waitForTimeout(16);
	}
	await page.waitForTimeout(150);
	await send('touchEnd', []);
	await cdp.detach();
}

/** Two-finger pinch (spreading horizontally around the screen centre): zooms in by ~`factor`. */
async function pinch(page: Page, factor = 3.5) {
	const vp = page.viewportSize()!;
	const c = { x: vp.width / 2, y: vp.height / 2 + 20 };
	const from = 30;
	const to = from * factor;
	const cdp = await page.context().newCDPSession(page);
	const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 2, radiusY: 2, force: 1 }))
		});
	await send('touchStart', [
		{ x: c.x - from, y: c.y },
		{ x: c.x + from, y: c.y }
	]);
	const steps = 10;
	for (let s = 1; s <= steps; s++) {
		const d = from + ((to - from) * s) / steps;
		await send('touchMove', [
			{ x: c.x - d, y: c.y },
			{ x: c.x + d, y: c.y }
		]);
		await page.waitForTimeout(16);
	}
	await page.waitForTimeout(150);
	await send('touchEnd', []);
	await cdp.detach();
}

/**
 * Moves the round's guess map by touch, like a player would, until the centre cross is on
 * `target` (within `tolerancePx` screen pixels), reading where the cross is from the phone's
 * own state. At the world view a tall phone shows the whole height of the map, so it cannot
 * pan north or south yet: first pan east/west, then pinch to zoom in, then fine-tune.
 */
export async function steerTo(
	page: Page,
	gameId: string,
	roundIndex: number,
	target: { lat: number; lng: number },
	tolerancePx = 1.5
): Promise<MapView> {
	await mapReady(page);
	const key = `cw:view:${gameId}:${roundIndex}`;
	let view = await readView(page, key);
	if (!view) {
		await stroke(page, 40, 0);
		view = await waitForNewView(page, key, 'null');
	}
	const delta = (v: MapView) => {
		const world = 512 * 2 ** v.zoom;
		const dLng = ((((target.lng - v.lng) % 360) + 540) % 360) - 180;
		return { dx: (dLng / 360) * world, dy: (mercY(target.lat) - mercY(v.lat)) * world };
	};
	const log: string[] = [];
	for (let i = 0; i < 30 && view; i++) {
		const { dx, dy } = delta(view);
		log.push(`z${view.zoom.toFixed(2)} ${view.lat.toFixed(3)},${view.lng.toFixed(3)} d=${dx.toFixed(1)},${dy.toFixed(1)}`);
		let fx: number;
		let fy: number;
		if (view.zoom < 2) {
			// Coarse east/west first, then zoom in around the cross.
			if (Math.abs(dx) > 25) {
				fx = Math.max(-160, Math.min(160, -dx));
				fy = 0;
			} else {
				const before = JSON.stringify(view);
				await pinch(page);
				view = await waitForNewView(page, key, before);
				continue;
			}
		} else {
			if (Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx) return view;
			// The map follows the finger: to move the cross east, the finger moves west.
			fx = Math.max(-160, Math.min(160, -dx));
			fy = Math.max(-170, Math.min(170, -dy));
		}
		const before = JSON.stringify(view);
		await stroke(page, fx, fy);
		view = await waitForNewView(page, key, before);
	}
	throw new Error(`could not steer the map to ${target.lat},${target.lng}: ${log.join(' | ')}`);
}
