/**
 * Phones: mobile browser contexts with touch, the real join page, and one-finger drags with
 * real touch events (CDP) for the guess map.
 */
import { expect, type Browser, type CDPSession, type Page } from '@playwright/test';
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
	// Hydrated: Enter submits through the remote form, not a full page post.
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
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
	await holdStill(page);
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

/**
 * The cross position once the map has settled after a gesture. The phone records it debounced
 * (GUESS_UPDATE_DEBOUNCE_MS = 400 after the last movement, which includes the `moveend` when
 * the finger lifts), so a record written during a slow gesture can be an intermediate position.
 * Gestures leave no inertia, so wait in the page (two frames for `moveend`, then longer than the
 * debounce: page timers fire in order, so the final record is written by then) and read once.
 */
async function settledView(page: Page, key: string, before: string): Promise<MapView | null> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 450)))
			)
	);
	const v = await readView(page, key);
	if (JSON.stringify(v) !== before) return v;
	// Unchanged: the map may not have moved at all; give a slow page one more moment.
	await page.waitForTimeout(500);
	return readView(page, key);
}

/** One CDP session per page for touch input (creating one per gesture adds latency). */
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();
function touchSession(page: Page): Promise<CDPSession> {
	let s = touchSessions.get(page);
	if (!s) {
		s = page.context().newCDPSession(page);
		touchSessions.set(page, s);
	}
	return s;
}

async function sendTouch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) {
	const cdp = await touchSession(page);
	await cdp.send('Input.dispatchTouchEvent', {
		type,
		touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 2, radiusY: 2, force: 1 }))
	});
}

/**
 * Keeps the fingers still long enough that lifting them has no velocity, measured in the page:
 * MapLibre records gesture updates in animation frames and keeps those of the last 160 ms for
 * inertia. Waiting in the test's own clock is not enough: on a busy renderer the last moves are
 * applied late, the release follows them within that window and the map flings (seen as
 * steering overshooting and oscillating in the full-game test). So wait two frames (the last
 * move is applied) and then 250 ms of page time.
 */
async function holdStill(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)))
			)
	);
}

/**
 * One finger gesture that moves the map by (fx, fy) CSS pixels and leaves no inertia (the
 * finger is held still before lifting, `holdStill`). MapLibre swallows the first pixels of a gesture (click tolerance), so
 * a short move goes out past the target and comes back within the same gesture: one gesture,
 * one final position, and nothing for the debounced record to catch half-way.
 */
async function stroke(page: Page, fx: number, fy: number): Promise<void> {
	const MIN = 60;
	const len = Math.hypot(fx, fy);
	const ux = len ? fx / len : 1;
	const uy = len ? fy / len : 0;
	const path: Pt[] = len >= MIN ? [{ x: fx, y: fy }] : [{ x: fx + ux * MIN, y: fy + uy * MIN }, { x: fx, y: fy }];
	const vp = page.viewportSize()!;
	const start = { x: vp.width / 2 - fx / 2, y: vp.height / 2 + 20 - fy / 2 };
	await sendTouch(page, 'touchStart', [start]);
	let from = { x: 0, y: 0 };
	for (const to of path) {
		const steps = 5;
		for (let s = 1; s <= steps; s++) {
			const x = from.x + ((to.x - from.x) * s) / steps;
			const y = from.y + ((to.y - from.y) * s) / steps;
			await sendTouch(page, 'touchMove', [{ x: start.x + x, y: start.y + y }]);
			await page.waitForTimeout(16);
		}
		from = to;
	}
	await holdStill(page);
	await sendTouch(page, 'touchEnd', []);
}

/** Two-finger pinch (spreading horizontally around the screen centre): zooms in by ~`factor`. */
async function pinch(page: Page, factor = 3.5) {
	const vp = page.viewportSize()!;
	const c = { x: vp.width / 2, y: vp.height / 2 + 20 };
	const from = 30;
	const to = from * factor;
	await sendTouch(page, 'touchStart', [
		{ x: c.x - from, y: c.y },
		{ x: c.x + from, y: c.y }
	]);
	const steps = 10;
	for (let s = 1; s <= steps; s++) {
		const d = from + ((to - from) * s) / steps;
		await sendTouch(page, 'touchMove', [
			{ x: c.x - d, y: c.y },
			{ x: c.x + d, y: c.y }
		]);
		await page.waitForTimeout(16);
	}
	await holdStill(page);
	await sendTouch(page, 'touchEnd', []);
}

/**
 * Moves the round's guess map by touch, like a player would, until the centre cross is on
 * `target` (within `tolerancePx` screen pixels), reading where the cross is from the phone's
 * own state. At the world view a tall phone shows the whole height of the map, so it cannot
 * pan north or south yet: first pan east/west, then pinch to zoom in, then fine-tune.
 *
 * Deterministic: gestures leave no inertia, positions are read only once settled, and each
 * axis has its own gain that halves whenever a move did not shrink that axis' error, so the
 * corrections converge instead of oscillating even if gestures lose or gain a few pixels.
 * Fails at once (instead of retrying) if the round stops taking moves.
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
		await stroke(page, 60, 0);
		view = await settledView(page, key, 'null');
	}
	const delta = (v: MapView) => {
		const world = 512 * 2 ** v.zoom;
		const dLng = ((((target.lng - v.lng) % 360) + 540) % 360) - 180;
		return { dx: (dLng / 360) * world, dy: (mercY(target.lat) - mercY(v.lat)) * world };
	};
	const log: string[] = [];
	const fail = async (why: string): Promise<never> => {
		await page.screenshot({ path: `test-results/steer-failed-${Date.now()}.png` }).catch(() => {});
		throw new Error(`could not steer the map to ${target.lat},${target.lng}: ${why}: ${log.join(' | ')}`);
	};
	const gain = { x: 1, y: 1 };
	let prev: { dx: number; dy: number } | null = null;
	let stuck = 0;
	for (let i = 0; i < 40 && view; i++) {
		const { dx, dy } = delta(view);
		log.push(`z${view.zoom.toFixed(2)} ${view.lat.toFixed(3)},${view.lng.toFixed(3)} d=${dx.toFixed(1)},${dy.toFixed(1)}`);
		const round = page.getByTestId('round');
		if ((await round.count()) === 0 || (await round.getAttribute('data-locked')) === 'true') {
			await fail('the round no longer takes moves (ended or locked)');
		}
		if (view.zoom < 2) {
			// Coarse east/west first, then zoom in around the cross.
			const before = JSON.stringify(view);
			if (Math.abs(dx) > 25) await stroke(page, Math.max(-160, Math.min(160, -dx)), 0);
			else await pinch(page);
			view = await settledView(page, key, before);
			prev = null;
			continue;
		}
		if (Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx) return view;
		if (prev) {
			// A move that did not shrink an axis' error overshot or got lost: be gentler there.
			if (Math.abs(dx) > tolerancePx && Math.abs(dx) >= Math.abs(prev.dx) * 0.9) gain.x = Math.max(0.25, gain.x / 2);
			if (Math.abs(dy) > tolerancePx && Math.abs(dy) >= Math.abs(prev.dy) * 0.9) gain.y = Math.max(0.25, gain.y / 2);
		}
		prev = { dx, dy };
		// The map follows the finger: to move the cross east, the finger moves west.
		const fx = Math.abs(dx) <= tolerancePx ? 0 : Math.max(-160, Math.min(160, -dx * gain.x));
		const fy = Math.abs(dy) <= tolerancePx ? 0 : Math.max(-170, Math.min(170, -dy * gain.y));
		const before = JSON.stringify(view);
		await stroke(page, fx, fy);
		view = await settledView(page, key, before);
		if (JSON.stringify(view) === before && ++stuck >= 3) await fail('the map does not move');
		if (JSON.stringify(view) !== before) stuck = 0;
	}
	return fail('no convergence');
}
