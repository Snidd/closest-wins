import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('landing page renders in English and Swedish', async ({ browser }) => {
	const en = await browser.newContext({ locale: 'en-US' });
	const page = await en.newPage();
	await page.goto('/');
	await expect(page.locator('h1')).toHaveText('Closest Wins');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await en.close();

	const sv = await browser.newContext({ locale: 'sv-SE' });
	const svPage = await sv.newPage();
	await svPage.goto('/');
	await expect(svPage.locator('h1')).toHaveText('Närmast vinner');
	await expect(svPage.locator('html')).toHaveAttribute('lang', 'sv');
	await sv.close();
});

test('protected pages require the admin password', async ({ page }) => {
	await page.goto('/admin');
	await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);

	const password = page.getByLabel('Admin password');
	await password.fill('definitely-wrong');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByText('Wrong password.')).toBeVisible();

	await password.fill(process.env.ADMIN_PASSWORD!);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByText('TODO admin')).toBeVisible();

	// The session cookie also unlocks hosting.
	await page.goto('/host');
	await expect(page).toHaveURL(/\/host$/);
	const cookie = (await page.context().cookies()).find((c) => c.name === 'cw_admin');
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe('Lax');
});

test.describe('file routes', () => {
	const dir = path.resolve(process.env.DATA_DIR ?? './data', 'map');
	const file = path.join(dir, '__e2e_range.bin');
	const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

	test.beforeAll(async () => {
		await mkdir(dir, { recursive: true });
		await writeFile(file, bytes);
	});
	test.afterAll(async () => {
		await rm(file, { force: true });
	});

	test('/map serves byte ranges (206) as PMTiles needs', async ({ request }) => {
		const full = await request.get('/map/__e2e_range.bin');
		expect(full.status()).toBe(200);
		expect(full.headers()['accept-ranges']).toBe('bytes');
		expect(Buffer.compare(await full.body(), bytes)).toBe(0);

		const part = await request.get('/map/__e2e_range.bin', { headers: { range: 'bytes=1000-1499' } });
		expect(part.status()).toBe(206);
		expect(part.headers()['content-range']).toBe('bytes 1000-1499/4096');
		expect(part.headers()['content-length']).toBe('500');
		expect(Buffer.compare(await part.body(), bytes.subarray(1000, 1500))).toBe(0);

		const bad = await request.get('/map/__e2e_range.bin', { headers: { range: 'bytes=9999-' } });
		expect(bad.status()).toBe(416);
	});

	test('/map and /media refuse path traversal', async ({ request }) => {
		for (const url of ['/map/..%2F.env', '/map/.env', '/media/..%2F..%2F.env', '/media/x/..%2F..%2F..%2Fpackage.json']) {
			expect((await request.get(url)).status(), url).toBe(404);
		}
	});
});
