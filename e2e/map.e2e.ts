/**
 * Map layer on a phone viewport with real touch input (CDP Input.dispatchTouchEvent), using
 * the /dev/map playground. Needs data/map/world.pmtiles (scripts/fetch-map.sh).
 */
import { WEBGL_LAUNCH } from './helpers/env.ts';
import { devices, expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// Pixel 7: mobile viewport, touch, DPR 2.625. `defaultBrowserType` cannot be set per file.
const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
test.use({
	...pixel7,
	// Headless WebGL via SwiftShader (MapLibre).
	launchOptions: WEBGL_LAUNCH
});

type Pt = { x: number; y: number };
/** GUESS_UPDATE_DEBOUNCE_MS (400) plus slack. */
const GUESS_DEBOUNCE_WAIT = 600;

async function touch(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 2, radiusY: 2, force: 1 }))
		});
	/** Moves each finger from `from[i]` to `to[i]` in `steps` steps. */
	async function gesture(from: Pt[], to: Pt[], steps = 12) {
		await send('touchStart', from);
		for (let s = 1; s <= steps; s++) {
			const f = s / steps;
			await send(
				'touchMove',
				from.map((p, i) => ({ x: p.x + (to[i]!.x - p.x) * f, y: p.y + (to[i]!.y - p.y) * f }))
			);
			await page.waitForTimeout(16);
		}
		// Hold still briefly so the release does not start pan inertia.
		await page.waitForTimeout(120);
		await send('touchEnd', []);
	}
	return { gesture };
}

const num = async (page: Page, id: string) => Number(await page.getByTestId(id).textContent());

async function readNow(page: Page) {
	await page.getByTestId('read').tap();
	return { lat: await num(page, 'lat'), lng: await num(page, 'lng'), zoom: await num(page, 'zoom') };
}

async function openGuess(page: Page) {
	await page.goto('/dev/map?view=guess&theme=light&lat=20&lng=10&z=3');
	await expect(page.locator('.guess-map')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
}

test('GuessMap renders tiles (canvas is not blank)', async ({ page }) => {
	await openGuess(page);
	const png = await page.locator('.guess-map .canvas').screenshot();
	const { channels } = await sharp(png).stats();
	// A blank or single-colour canvas has ~0 deviation; land, water and borders give plenty.
	expect(Math.max(...channels.slice(0, 3).map((c) => c.stdev))).toBeGreaterThan(12);
	// Distinct colours: ocean (blue-ish) and land (warm) are both present.
	const { data, info } = await sharp(png).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
	const colours = new Set<string>();
	for (let i = 0; i < data.length; i += info.channels) colours.add(`${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`);
	expect(colours.size).toBeGreaterThan(5);
});

test('one-finger drag pans, sets touched and reports the centre', async ({ page }) => {
	await openGuess(page);
	await expect(page.getByTestId('touched')).toHaveText('false');
	const before = await readNow(page);
	const box = (await page.locator('.guess-map').boundingBox())!;
	const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const { gesture } = await touch(page);
	// Finger moves left → the map moves with it → the centre moves east.
	await gesture([c], [{ x: c.x - 150, y: c.y + 40 }]);
	await expect(page.getByTestId('touched')).toHaveText('true');
	// Debounced onchange arrives.
	await expect(page.getByTestId('changes')).not.toHaveText('0', { timeout: 3000 });
	const after = { lat: await num(page, 'lat'), lng: await num(page, 'lng') };
	expect(after.lng).toBeGreaterThan(before.lng + 1);
	expect(after.lat).toBeGreaterThan(before.lat); // finger moved down → centre moved north
	expect(after.lng).toBeGreaterThanOrEqual(-180);
	expect(after.lng).toBeLessThanOrEqual(180);
});

test('two-finger pinch zooms; the page itself never scrolls or zooms', async ({ page }) => {
	await openGuess(page);
	const before = await readNow(page);
	const box = (await page.locator('.guess-map').boundingBox())!;
	const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const { gesture } = await touch(page);
	await gesture(
		[
			{ x: c.x - 40, y: c.y - 40 },
			{ x: c.x + 40, y: c.y + 40 }
		],
		[
			{ x: c.x - 150, y: c.y - 150 },
			{ x: c.x + 150, y: c.y + 150 }
		],
		16
	);
	await page.waitForTimeout(GUESS_DEBOUNCE_WAIT);
	const after = await readNow(page);
	expect(after.zoom).toBeGreaterThan(before.zoom + 0.8);
	// Zoom is around the centre, so the cross stays (almost) on the same point.
	expect(Math.abs(after.lat - before.lat)).toBeLessThan(1);
	expect(Math.abs(after.lng - before.lng)).toBeLessThan(1);

	// A long vertical swipe (would rubber-band / pull-to-refresh a normal page).
	await gesture([{ x: c.x, y: box.y + 120 }], [{ x: c.x, y: box.y + box.height - 60 }]);
	const page_ = await page.evaluate(() => ({
		scrollY: window.scrollY,
		scrollTop: document.scrollingElement?.scrollTop ?? 0,
		scale: window.visualViewport?.scale ?? 1,
		bodyTop: document.body.getBoundingClientRect().top
	}));
	expect(page_).toEqual({ scrollY: 0, scrollTop: 0, scale: 1, bodyTop: 0 });
});

test('locked mode ignores drags and pinches', async ({ page }) => {
	await openGuess(page);
	const box = (await page.locator('.guess-map').boundingBox())!;
	const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const { gesture } = await touch(page);
	await gesture([c], [{ x: c.x + 80, y: c.y }]); // touch once so Lock in is enabled
	await page.getByTestId('lock').tap();
	await expect(page.getByTestId('locked')).toHaveText('true');
	const lockedAt = await readNow(page);

	await gesture([c], [{ x: c.x - 200, y: c.y - 100 }]);
	await gesture(
		[
			{ x: c.x - 30, y: c.y },
			{ x: c.x + 30, y: c.y }
		],
		[
			{ x: c.x - 160, y: c.y },
			{ x: c.x + 160, y: c.y }
		]
	);
	await page.waitForTimeout(GUESS_DEBOUNCE_WAIT);
	expect(await readNow(page)).toEqual(lockedAt);
	await expect(page.locator('.guess-map.locked')).toBeVisible();
});

test('RevealMap runs the stages and skip jumps to the end', async ({ page }) => {
	await page.goto('/dev/map?view=reveal&n=40&theme=light');
	await expect(page.getByTestId('stage')).toHaveText('pins', { timeout: 30_000 });
	expect(await page.locator('.reveal-map .pin').count()).toBeGreaterThan(30);
	await expect(page.getByTestId('stage')).toHaveText('flying', { timeout: 6000 });
	await expect(page.locator('.reveal-map .target svg')).toBeVisible();
	await expect(page.getByTestId('stage')).toHaveText('done', { timeout: 8000 });
	await expect(page.locator('.reveal-map .pin.winner .label')).toBeVisible();

	await page.getByTestId('replay').tap();
	await expect(page.getByTestId('stage')).toHaveText('pins');
	await page.getByTestId('skip').tap();
	await expect(page.getByTestId('stage')).toHaveText('done', { timeout: 1000 });
});

test('a missing tile file shows an error instead of a blank map', async ({ page }) => {
	await page.route('**/map/world.pmtiles', (route) => route.fulfill({ status: 404, body: 'Not found' }));
	await page.goto('/dev/map?view=guess');
	await expect(page.locator('.guess-map')).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
	await expect(page.getByRole('alert')).toContainText(/map could not be loaded|Kartan kunde inte laddas/);
});
