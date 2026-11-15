/**
 * Admin content flow: log in, create a location with an uploaded photo, find it in the list,
 * edit it, put it in a new playlist, reorder, then delete both. Rows are tagged with a unique
 * name and removed in `afterAll` even if a step fails (the dev database is shared).
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';

const TAG = `E2E-${randomUUID().slice(0, 8)}`;
const UUID = '[0-9a-f-]{36}';

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
	const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
	try {
		const like = `%${TAG}%`;
		await sql`delete from playlist where name_en like ${like} or name_sv like ${like}`;
		const photos = await sql<{ id: string; file_key: string }[]>`
			select p.id, p.file_key from photo p join location l on l.photo_id = p.id
			where l.name_en like ${like} or l.name_sv like ${like}`;
		await sql`delete from location where name_en like ${like} or name_sv like ${like}`;
		for (const p of photos) {
			await sql`delete from photo where id = ${p.id}`;
			await rm(path.resolve(process.env.DATA_DIR ?? './data', 'media', p.file_key), { recursive: true, force: true });
		}
		// Photos uploaded by this test but never attached carry the tag in their attribution.
		const orphans = await sql<{ id: string; file_key: string }[]>`
			delete from photo where attribution like ${like}
			and not exists (select 1 from location where photo_id = photo.id) returning id, file_key`;
		for (const p of orphans) {
			await rm(path.resolve(process.env.DATA_DIR ?? './data', 'media', p.file_key), { recursive: true, force: true });
		}
	} finally {
		await sql.end();
	}
});

async function login(page: Page) {
	await page.goto('/login?next=/admin');
	await page.getByLabel('Admin password').fill(process.env.ADMIN_PASSWORD!);
	await page.getByLabel('Admin password').press('Enter');
	await expect(page).toHaveURL(/\/admin$/);
}

test.use({ locale: 'en-US' });

test('admin manages a location and a playlist end to end', async ({ page }) => {
	test.setTimeout(90_000);
	page.on('dialog', (d) => d.accept()); // "unsaved changes" guard, if it ever fires
	await login(page);
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

	// --- Create a location with an uploaded photo -------------------------------------------
	await page.getByRole('link', { name: 'Locations' }).first().click();
	await page.getByRole('link', { name: '+ New location' }).first().click();
	await expect(page).toHaveURL(/\/admin\/locations\/new$/);

	// Client-side validation before anything is filled in.
	await page.getByRole('button', { name: 'Create location' }).click();
	await expect(page.getByText('Enter a name in at least one language.')).toBeVisible();

	await page.getByLabel('Name (English)').fill(`${TAG} Tower`);
	await page.getByLabel('Name (Swedish)').fill(`${TAG} Tornet`);
	await page.getByLabel('Fun fact (English)').fill('It grows in summer.');
	await page.getByLabel('Paste coordinates').fill('48°51′30″N 2°17′40″E');
	await expect(page.getByLabel('Latitude')).toHaveValue('48.858333');
	await expect(page.getByLabel('Longitude')).toHaveValue('2.294444');

	const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7bd5' } })
		.png()
		.toBuffer();
	const upload = page.locator('#panel-upload');
	await upload.getByLabel('Image file').setInputFiles({ name: 'tower.png', mimeType: 'image/png', buffer: png });
	await upload.getByLabel('Attribution').fill(`${TAG} photographer / CC0`);
	await upload.getByRole('button', { name: 'Upload' }).click();
	const preview = page.getByRole('img', { name: 'Photo' });
	await expect(preview).toBeVisible();
	await expect(preview).toHaveAttribute('src', /^\/media\/[A-Za-z0-9_-]+\/md\.webp$/);
	await expect(page.getByText('The photo change is saved with the location.')).toBeVisible();

	await page.getByRole('button', { name: 'Create location' }).click();
	await expect(page).toHaveURL(new RegExp(`/admin/locations/${UUID}$`));
	await expect(page.getByRole('heading', { name: `${TAG} Tower` })).toBeVisible();
	await expect(page.getByRole('img', { name: 'Photo' })).toBeVisible();
	await expect(page.getByText('The photo change is saved with the location.')).toBeHidden();
	const locationUrl = page.url();

	// The served variant is a WebP.
	const src = await page.getByRole('img', { name: 'Photo' }).getAttribute('src');
	const media = await page.request.get(src!);
	expect(media.status()).toBe(200);
	expect(media.headers()['content-type']).toBe('image/webp');

	// --- Find it in the list ----------------------------------------------------------------
	await page.goto('/admin/locations');
	await page.getByPlaceholder('Search names, clues and facts in both languages').fill(TAG);
	await expect(page).toHaveURL(new RegExp(`\\?q=${TAG}`));
	const row = page.getByRole('row').filter({ hasText: `${TAG} Tower` });
	await expect(row).toHaveCount(1);
	await expect(row.locator('img')).toHaveAttribute('src', /\/sm\.webp$/);
	await expect(row.getByText('Missing SV')).toBeVisible(); // fact only in English
	await expect(row.getByText('Not in a playlist')).toHaveCount(0);

	// --- Edit -----------------------------------------------------------------------------------
	await row.getByRole('link').click();
	await expect(page).toHaveURL(locationUrl);
	await page.getByLabel('Name (English)').fill(`${TAG} Tall Tower`);
	await page.getByLabel('Fun fact (Swedish)').fill('Den växer på sommaren.');
	await expect(page.getByText('Unsaved changes')).toBeVisible();
	await page.getByRole('button', { name: 'Save location' }).click();
	await expect(page.getByText('✓ Saved')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Name (English)')).toHaveValue(`${TAG} Tall Tower`);
	await expect(page.getByLabel('Fun fact (Swedish)')).toHaveValue('Den växer på sommaren.');

	// --- New playlist with the location -----------------------------------------------------
	await page.getByRole('link', { name: 'Playlists' }).first().click();
	await page.getByRole('link', { name: '+ New playlist' }).first().click();
	await page.getByLabel('Name (English)').fill(`${TAG} List`);
	await page.getByLabel('Default timer (seconds)').fill('45');
	await page.getByRole('button', { name: 'Create playlist' }).click();
	await expect(page).toHaveURL(new RegExp(`/admin/playlists/${UUID}$`));
	await expect(page.getByText('No locations in this playlist yet.')).toBeVisible();

	const search = page.getByLabel('Search the library');
	await search.fill(TAG);
	await page.getByRole('button', { name: `Add: ${TAG} Tall Tower` }).click();
	await expect(page.getByText('✓ Order saved')).toBeVisible();
	await search.fill('Eiffel Tower');
	await page.getByRole('button', { name: 'Add: Eiffel Tower' }).click();
	await expect(page.getByText('✓ Order saved')).toBeVisible();

	const items = page.locator('ol.list > li');
	await expect(items).toHaveCount(2);
	await expect(items.nth(0)).toContainText(`${TAG} Tall Tower`);

	// Reorder with the keyboard-accessible button; focus follows the moved item.
	await page.getByRole('button', { name: 'Move Eiffel Tower up' }).click();
	await expect(items.nth(0)).toContainText('Eiffel Tower');
	await expect(page.getByRole('button', { name: 'Move Eiffel Tower down' })).toBeFocused();
	await expect(page.getByText('✓ Order saved')).toBeVisible();

	// …and back with drag and drop.
	await items.nth(1).dragTo(items.nth(0), { targetPosition: { x: 20, y: 5 } });
	await expect(items.nth(0)).toContainText(`${TAG} Tall Tower`);
	await expect(page.getByText('✓ Order saved')).toBeVisible();
	await page.getByRole('button', { name: 'Move Eiffel Tower up' }).click();
	await expect(page.getByText('✓ Order saved')).toBeVisible();

	await page.reload();
	await expect(items).toHaveCount(2);
	await expect(items.nth(0)).toContainText('Eiffel Tower');
	await expect(items.nth(1)).toContainText(`${TAG} Tall Tower`);

	// The list shows the counts.
	await page.goto('/admin/playlists');
	const plRow = page.getByRole('row').filter({ hasText: `${TAG} List` });
	await expect(plRow).toContainText('2');
	await expect(plRow).toContainText('45 s');
	await expect(plRow.getByText('Missing SV')).toBeVisible(); // playlist name only in English

	// --- Delete the playlist, then the location --------------------------------------------------
	await plRow.getByRole('link').click();
	await page.getByRole('button', { name: 'Delete playlist' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page).toHaveURL(/\/admin\/playlists$/);
	await expect(page.getByRole('row').filter({ hasText: `${TAG} List` })).toHaveCount(0);

	await page.goto(locationUrl);
	await page.getByRole('button', { name: 'Delete location' }).click();
	await expect(page.getByRole('dialog')).toContainText(`${TAG} Tall Tower`);
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page).toHaveURL(/\/admin\/locations$/);
	await page.goto(`/admin/locations?q=${TAG}`);
	await expect(page.getByText(`Nothing matches “${TAG}”.`)).toBeVisible();

	// The photo went with it.
	expect((await page.request.get(src!)).status()).toBe(404);
});

test('admin pages render in Swedish and the editor refuses invalid input', async ({ browser }) => {
	const ctx = await browser.newContext({ locale: 'sv-SE' });
	const page = await ctx.newPage();
	await page.goto('/login?next=/admin/locations/new');
	await page.getByLabel('Adminlösenord').fill(process.env.ADMIN_PASSWORD!);
	await page.getByLabel('Adminlösenord').press('Enter');
	await expect(page.getByRole('heading', { name: 'Ny plats' })).toBeVisible();

	await page.getByLabel('Namn (Svenska)').fill(`${TAG} Plats`);
	await page.getByLabel('Latitud').fill('86'); // valid on Earth, but the map cannot show it
	await page.getByLabel('Longitud').fill('10');
	await page.getByRole('button', { name: 'Skapa plats' }).click();
	await expect(page.getByText('Ange en latitud mellan -85 och 85 (kartan kan inte visa polerna).')).toBeVisible();
	await expect(page.getByText('Lägg till ett foto eller en ledtrådstext på minst ett språk.')).toBeVisible();
	await expect(page).toHaveURL(/\/admin\/locations\/new$/);

	await page.getByLabel('Klistra in koordinater').fill('inte koordinater');
	await expect(page.getByText('Kunde inte läsa några koordinater i texten.')).toBeVisible();

	// URL import goes through the server's SSRF guard; the refusal lands on the URL field.
	await page.getByRole('tab', { name: 'Från URL' }).click();
	const importForm = page.locator('#panel-url');
	await importForm.getByLabel('Bild-URL').fill('http://127.0.0.1:5432/x.png');
	await importForm.getByRole('button', { name: 'Importera' }).click();
	await expect(importForm.getByText('That address is not allowed')).toBeVisible();

	await page.goto('/admin/locations/00000000-0000-4000-8000-000000000000');
	await expect(page.getByText('Platsen finns inte')).toBeVisible();
	await ctx.close();
});
