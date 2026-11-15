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
