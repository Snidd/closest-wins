/**
 * Not a test: plays a short game on the real pages and saves screenshots of the TV, a phone and
 * the host at every phase (with a photo clue), for looking at the screens side by side.
 *
 *   SHOTS=1 pnpm test:e2e e2e/screenshots.e2e.ts --no-deps     # → test-results/shots/
 *
 * Skipped unless SHOTS=1. Creates its own photo location and playlist and removes them again.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Admin } from './helpers/admin.ts';
import { BASE_URL, WEBGL_LAUNCH } from './helpers/env.ts';
import { closeDb, deleteGames, deleteTvs, SEED } from './helpers/db.ts';
import { makePhoto } from './helpers/photo.ts';
import { offset, roundState, setUpGame } from './helpers/screens.ts';
import { steerTo } from './helpers/phone.ts';

test.use({ launchOptions: WEBGL_LAUNCH });

const DIR = process.env.SHOTS_DIR ?? 'test-results/shots';

test('screenshots of every phase on TV, phone and host', async ({ browser }) => {
	test.skip(!process.env.SHOTS, 'set SHOTS=1 to take screenshots');
	test.setTimeout(300_000);
	await mkdir(DIR, { recursive: true });
	const admin = await Admin.login();
	const tag = Math.random().toString(36).slice(2, 7);
	const photo = await admin.createPhotoLocation({
		image: await makePhoto('landscape'),
		attribution: 'Screenshot Photographer / CC BY 4.0',
		nameEn: 'Lake Louise',
		nameSv: 'Lake Louise',
		clueTextEn: 'Turquoise water below a glacier, in a national park.',
		clueTextSv: 'Turkost vatten nedanför en glaciär, i en nationalpark.',
		factEn: 'The colour comes from rock flour carried down by the glacier.',
		factSv: 'Färgen kommer från stenmjöl som glaciären för med sig.',
		lat: 51.4167,
		lng: -116.2167
	});
	const listName = `Shots ${tag}`;
	await admin.createPlaylist([photo.locationId, SEED.eiffel], { en: listName, sv: `Bilder ${tag}`, timerSeconds: 45 });
	const track = { games: new Set<string>(), tvs: new Set<string>() };
	let contexts: BrowserContext[] = [];
	const shot = async (page: Page, name: string, settleMs = 400) => {
		await page.waitForTimeout(settleMs); // let entry animations settle
		await page.screenshot({ path: path.join(DIR, `${name}.png`) });
	};
	try {
		const setup = await setUpGame(
			browser,
			BASE_URL,
			listName,
			[
				['Anna', 'en'],
				['Björn', 'sv'],
				['Cleo', 'en']
			],
			track,
			45,
			2
		);
		contexts = setup.contexts;
		const { screens: s, gameId } = setup;
		const anna = s.phone('Anna').page;
		const bjorn = s.phone('Björn').page;
		await shot(s.tv, '01-tv-lobby');
		await shot(anna, '01-phone-lobby');
		await shot(bjorn, '01-phone-sv-lobby');
		await shot(s.host, '01-host-lobby');

		await s.hostPrimary('Start game');
		await s.phase('round');
		await expect(s.tv.locator('figure.photo')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });
		let r = await roundState(gameId);
		await shot(s.tv, '02-tv-round-photo');
		await shot(anna, '02-phone-round-photo');
		await shot(s.host, '02-host-round');
		await Promise.all([
			steerTo(anna, gameId, r.index, offset(r.target, 1.5, -2)),
			steerTo(bjorn, gameId, r.index, offset(r.target, -4, 5)),
			steerTo(s.phone('Cleo').page, gameId, r.index, offset(r.target, 9, 12))
		]);
		await s.lockIn('Anna');
		await shot(anna, '03-phone-locked');
		await shot(s.tv, '03-tv-one-locked');
		await s.lockIn('Cleo');
		await s.lockIn('Björn');
		await s.phase('reveal');
		await shot(s.tv, '04-tv-reveal-pins');
		await shot(anna, '04-phone-reveal-wait');
		await expect(s.tv.getByTestId('reveal-screen')).toHaveAttribute('data-reveal-stage', 'done', { timeout: 15_000 });
		await shot(s.tv, '05-tv-reveal-done', 3000);
		await shot(anna, '05-phone-result');
		await shot(bjorn, '05-phone-sv-result');
		await shot(s.host, '05-host-reveal');

		await s.hostPrimary('Show standings');
		await s.phase('standings');
		await shot(s.tv, '06-tv-standings');
		await shot(anna, '06-phone-standings');
		await shot(s.host, '06-host-standings');

		await s.hostPrimary('Start round 2');
		await s.phase('round');
		r = await roundState(gameId);
		await shot(s.tv, '07-tv-round-text');
		await shot(bjorn, '07-phone-sv-round-text');
		await steerTo(bjorn, gameId, r.index, offset(r.target, 0.3, 0.3));
		await s.lockIn('Björn');
		await s.host.getByTestId('end-round').click({ delay: 1300 });
		await s.phase('reveal');
		await expect(s.tv.getByTestId('reveal-screen')).toHaveAttribute('data-reveal-stage', 'done', { timeout: 15_000 });
		await shot(s.tv, '08-tv-reveal-close', 3000);
		await shot(bjorn, '08-phone-sv-result-close');
		await s.hostPrimary('Show standings');
		await s.phase('standings');
		await shot(s.tv, '09-tv-standings-sudden-death');
		await shot(anna, '09-phone-standings-sudden-death');
		await s.hostPrimary(/Start sudden death/);
		await s.phase('round');
		await shot(s.tv, '10-tv-sudden-death');
		await shot(anna, '10-phone-sudden-death');
		await shot(s.phone('Cleo').page, '10-phone-spectator');
		await s.host.getByTestId('menu-button').click();
		await s.host.getByTestId('end-game').click();
		await s.host.getByTestId('end-game-confirm').click();
		await s.phase('finished');
		await shot(s.tv, '11-tv-finished', 3000);
		await shot(anna, '11-phone-finished');
		await shot(bjorn, '11-phone-sv-finished');
		await shot(s.host, '11-host-finished');
	} finally {
		for (const c of contexts) await c.close().catch(() => {});
		await deleteGames(track.games);
		await deleteTvs(track.tvs);
		await admin.cleanupContent();
		await closeDb();
	}
});
