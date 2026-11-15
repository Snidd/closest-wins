/**
 * Big screen (/tv) at 1920×1080, driving real games through the remote functions (no host /
 * player UI needed; see e2e/helpers/driver.ts). Each test creates its own playlist, game and TV and
 * removes them again; nothing global is asserted, so other agents can share the database.
 *
 * Needs the map tiles (data/map/world.pmtiles) for the reveal.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { WEBGL_LAUNCH } from './helpers/env.ts';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Admin } from './helpers/admin.ts';
import { closeDb, db, loadLocation, SEED } from './helpers/db.ts';
import { GameDriver } from './helpers/driver.ts';
import { makePhoto } from './helpers/photo.ts';

test.use({
	viewport: { width: 1920, height: 1080 },
	locale: 'en-US',
	// Headless WebGL via SwiftShader (MapLibre).
	launchOptions: WEBGL_LAUNCH
});
test.setTimeout(120_000);

const BASE = () => test.info().project.use.baseURL!;

test.afterAll(async () => {
	await closeDb();
});

// --- Helpers ---------------------------------------------------------------------------------

/** A fresh browser context (= a new TV with no cookie) on /tv; resolves the pairing code. */
async function openTv(browser: Browser, locale = 'en-US') {
	const context = await browser.newContext({ locale, viewport: { width: 1920, height: 1080 } });
	const page = await context.newPage();
	await page.goto('/tv');
	const code = await pairingCode(page);
	return { context, page, code };
}

async function pairingCode(page: Page): Promise<string> {
	const el = page.getByTestId('pairing-code');
	await expect(el).toHaveAttribute('data-code', /^\d{6}$/, { timeout: 15_000 });
	return (await el.getAttribute('data-code'))!;
}

/** Creates a game, opens a TV and pairs it; the driver cleans up both. */
async function pairedGame(browser: Browser, opts: Parameters<typeof GameDriver.create>[1] = {}, admin?: Admin) {
	const g = await GameDriver.create(BASE(), opts, admin);
	const tv = await openTv(browser);
	await g.pairTv(tv.code);
	await expect(tv.page.getByTestId('lobby-screen')).toBeVisible();
	return { g, ...tv };
}

/** Same algorithm as `qrPath` in src/lib/ui/QrCode.svelte. */
function expectedQrPath(value: string, quietZone: number) {
	const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
	const n = modules.size;
	let d = '';
	for (let y = 0; y < n; y++) {
		let x = 0;
		while (x < n) {
			if (!modules.get(y, x)) {
				x++;
				continue;
			}
			const start = x;
			while (x < n && modules.get(y, x)) x++;
			d += `M${start + quietZone} ${y + quietZone}h${x - start}v1h${start - x}z`;
		}
	}
	return d;
}

const stage = (page: Page) => page.getByTestId('reveal-screen');

// --- Tests -----------------------------------------------------------------------------------

test('an unregistered screen registers itself and shows a pairing code', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1920, height: 1080 } });
	const page = await context.newPage();
	let tvId: string | undefined;
	try {
		await page.goto('/tv');
		// Before the cookie exists the stream says "unregistered"; the page registers and reconnects.
		const code = await pairingCode(page);
		await expect(page.getByTestId('tv')).toHaveAttribute('data-status', 'pairing');
		await expect(page.getByText('Pair this screen')).toBeVisible();
		await expect(page.getByText(/open\s+localhost:\d+\/host\s+and enter this code/)).toBeVisible();
		expect((await context.cookies()).some((c) => c.name === 'cw_tv')).toBe(true);
		const [row] = await db()<{ id: string }[]>`select id from tv_screen where pairing_code = ${code}`;
		tvId = row?.id;
		expect(tvId).toBeTruthy();

		// A reload keeps the same TV (cookie) and shows a code again without registering anew.
		await page.reload();
		await pairingCode(page);
		const [again] = await db()<{ n: number }[]>`select count(*)::int as n from tv_screen where id = ${tvId!}`;
		expect(again!.n).toBe(1);
	} finally {
		await context.close();
		if (tvId) await db()`delete from tv_screen where id = ${tvId}`;
	}
});

test('pairing switches to the lobby: scannable QR for joinUrl, players appear live', async ({ browser }) => {
	const g = await GameDriver.create(BASE(), { playlistName: { en: 'Lobby Test List', sv: 'Lobbytest' } });
	const tv = await openTv(browser);
	try {
		await g.pairTv(tv.code);
		const { page } = tv;
		await expect(page.getByTestId('lobby-screen')).toBeVisible();
		await expect(page.getByTestId('tv')).toHaveAttribute('data-game-id', g.gameId);

		// QR: black on white, large, and encoding exactly the join URL.
		// The server under test runs with ORIGIN = its own base URL (playwright.config.ts).
		const joinUrl = `${BASE()}/join/${g.joinCode}`;
		const qr = page.locator('svg.qr').first();
		await expect(qr.locator('path')).toHaveAttribute('d', expectedQrPath(joinUrl, 2));
		await expect(qr.locator('rect')).toHaveAttribute('fill', '#ffffff');
		await expect(qr.locator('path')).toHaveAttribute('fill', '#000000');
		const box = (await qr.boundingBox())!;
		expect(box.height).toBeGreaterThan(1080 * 0.4);
		await expect(page.getByTestId('join-code')).toHaveText(g.joinCode.split('').join(''));
		await expect(page.getByText('Lobby Test List')).toBeVisible();
		await expect(page.getByText('Waiting for the host to start the game')).toBeVisible();

		// Players pop in live, offline ones greyed out.
		await expect(page.getByTestId('player-count')).toHaveText('0');
		await g.join('Anna');
		await expect(page.getByTestId('lobby-player')).toHaveCount(1);
		await g.join('Bo', { connected: false });
		await g.join('Cecilia');
		await expect(page.getByTestId('lobby-player')).toHaveCount(3);
		await expect(page.getByTestId('player-count')).toHaveText('3');
		const bo = page.locator(`[data-player-id="${g.players.get('Bo')!.id}"]`);
		await expect(bo).toHaveClass(/offline/);
		await expect(page.locator(`[data-player-id="${g.players.get('Anna')!.id}"]`)).not.toHaveClass(/offline/);
	} finally {
		await tv.context.close();
		await g.cleanup();
	}
});

test('a round shows clue, countdown and lock-ins, and none of the answer', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser, { timerSeconds: 60 });
	try {
		await g.join('Anna');
		await g.join('Bo');
		await g.join('Cecilia', { connected: false });
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		const target = await g.currentTarget();

		await expect(page.getByTestId('clue-text')).toContainText(target.clueTextEn!);
		await expect(page.getByTestId('round-label')).toContainText('1');
		const countdown = page.getByTestId('countdown');
		const s1 = Number(await countdown.getAttribute('data-seconds'));
		expect(s1).toBeGreaterThan(50);
		expect(s1).toBeLessThanOrEqual(60);
		await expect(countdown).not.toHaveAttribute('data-seconds', String(s1), { timeout: 3000 });

		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-locked', '0');
		await g.guess('Anna', 10, 10);
		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-locked', '1');
		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-total', '3');
		const chip = (name: string) => page.locator(`[data-testid=round-player][data-player-id="${g.players.get(name)!.id}"]`);
		await expect(chip('Anna')).toHaveAttribute('data-locked', 'true');
		await expect(chip('Bo')).toHaveAttribute('data-locked', 'false');
		await expect(chip('Cecilia')).toHaveAttribute('data-connected', 'false');

		// The answer is nowhere in the DOM (also not after a fresh server render).
		for (const html of [await page.content(), (await page.reload(), await page.content())]) {
			for (const secret of [target.nameEn, target.nameSv, target.factEn, target.factSv]) {
				if (secret) expect(html).not.toContain(secret);
			}
		}
		await expect(page.getByTestId('round-screen')).toBeVisible();
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('the reveal builds suspense, then shows place, fact, winner and distances', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser);
	try {
		await g.join('Anna');
		await g.join('Bo');
		await g.join('Cecilia');
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		const target = await loadLocation(SEED.eiffel);
		await g.guess('Anna', 48.0, 2.0); // ~100 km
		await g.guess('Bo', 40.4, -3.7); // Madrid
		await g.endRoundNow();

		await expect(stage(page)).toBeVisible();
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'pins');
		await expect(page.getByTestId('reveal-suspense')).toContainText('2 guesses');
		expect(await page.content()).not.toContain(target.nameEn!);

		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'flying', { timeout: 6000 });
		await expect(page.getByText('And the answer is')).toBeVisible();
		await expect(page.getByTestId('reveal-name')).toHaveText(target.nameEn!, { timeout: 6000 });
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'done', { timeout: 6000 });
		await expect(page.getByTestId('reveal-fact')).toHaveText(target.factEn!);

		const winner = page.getByTestId('round-winner');
		await expect(winner).toHaveAttribute('data-winners', g.players.get('Anna')!.id);
		await expect(winner).toContainText('Anna');
		await expect(winner).toContainText('wins the round');
		const rows = page.getByTestId('ranking-row');
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText('Anna');
		await expect(rows.nth(1)).toContainText('Bo');
		await expect(page.getByText('1 player without a guess')).toBeVisible();
		// The map itself reaches its end state too.
		await expect(page.locator('.reveal-map')).toHaveAttribute('data-stage', 'done', { timeout: 15_000 });
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('skipping the reveal jumps straight to the result; nobody guessed reads correctly', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser);
	try {
		await g.join('Anna');
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.endRoundNow();
		await g.skipReveal();
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'done', { timeout: 3000 });
		await expect(page.getByTestId('round-winner')).toContainText('Nobody guessed this time');
		await expect(page.getByTestId('round-winner')).toContainText('No point this round');
		await expect(page.getByTestId('reveal-name')).toHaveText('Eiffel Tower');
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('a shared round win and the standings with movement and what comes next', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser);
	try {
		await g.joinMany(['Anna', 'Bo', 'Cecilia']);
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.guess('Bo', 47, 3);
		await g.guess('Cecilia', 47, 3);
		await g.guess('Anna', 10, 10);
		await g.endRoundNow();
		await g.skipReveal();
		const winner = page.getByTestId('round-winner');
		await expect(winner).toContainText('share the round');
		await expect(winner.locator('.w-names')).toHaveText(/^(Bo & Cecilia|Cecilia & Bo)$/);

		await g.nextRound();
		const standings = page.getByTestId('standings-screen');
		await expect(standings).toBeVisible();
		await expect(standings).toHaveAttribute('data-next', 'round');
		await expect(page.getByText('After round 1 of 3')).toBeVisible();
		const rows = page.getByTestId('standings-row');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toHaveAttribute('data-rank', '1');
		await expect(rows.nth(1)).toHaveAttribute('data-rank', '1');
		await expect(rows.nth(2)).toContainText('Anna');
		await expect(rows.nth(0)).toContainText('+1');
		await expect(page.getByTestId('next-step')).toContainText('Round 2');
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('sudden death: tied leaders are named, then duel while the others watch', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser, { locations: [SEED.eiffel, SEED.liberty], rounds: 2 });
	try {
		await g.joinMany(['Anna', 'Bo', 'Cecilia']);
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.guess('Anna', 48.8, 2.3);
		await g.endRoundNow();
		await g.skipReveal();
		await g.nextRound();
		await g.nextRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.guess('Bo', 40.7, -74);
		await g.endRoundNow();
		await g.skipReveal();
		await g.nextRound();

		const standings = page.getByTestId('standings-screen');
		await expect(standings).toHaveAttribute('data-next', 'suddenDeath');
		await expect(page.getByText('Tied at the top!')).toBeVisible();
		await expect(page.getByTestId('next-duel')).toContainText('Anna');
		await expect(page.getByTestId('next-duel')).toContainText('Bo');
		await expect(page.getByTestId('next-duel')).not.toContainText('Cecilia');

		await g.nextRound();
		const round = page.getByTestId('round-screen');
		await expect(round).toHaveAttribute('data-sudden-death', 'true');
		await expect(page.getByTestId('sudden-death-label')).toContainText('Sudden death');
		await expect(page.getByTestId('duel')).toContainText(/Anna.*vs.*Bo|Bo.*vs.*Anna/);
		await expect(page.getByTestId('round-player')).toHaveCount(2);
		await expect(page.getByTestId('watching')).toContainText('Watching');
		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-total', '2');
		await expect(page.locator('.tv')).toHaveClass(/sd/);
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('game over shows the winner and a pairing code; pairing it moves the screen to the next game', async ({
	browser
}) => {
	const { g, page, context } = await pairedGame(browser);
	let next: GameDriver | undefined;
	try {
		await g.join('Anna');
		await g.join('Bo');
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.guess('Anna', 48.8, 2.3);
		await g.endRoundNow();
		await g.skipReveal();
		await g.endGame();

		const finished = page.getByTestId('finished-screen');
		await expect(finished).toBeVisible();
		await expect(finished).toHaveAttribute('data-winners', g.players.get('Anna')!.id);
		await expect(page.getByTestId('game-winner')).toContainText('Anna');
		await expect(page.getByTestId('game-winner')).toContainText('wins the game!');
		await expect(page.getByText('The game was ended early')).toBeVisible();
		await expect(page.getByTestId('standings-row')).toHaveCount(2);

		const nextPairing = page.getByTestId('next-pairing');
		await expect(nextPairing).toHaveAttribute('data-code', /^\d{6}$/);
		const code = (await nextPairing.getAttribute('data-code'))!;
		await expect(nextPairing).toContainText(`${code.slice(0, 3)} ${code.slice(3)}`);

		next = await g.createAnother({ language: 'sv' });
		await next.pairTv(code);
		await expect(page.getByTestId('lobby-screen')).toBeVisible();
		await expect(page.getByTestId('tv')).toHaveAttribute('data-game-id', next.gameId);
		await expect(page.getByTestId('join-code')).toHaveText(next.joinCode);
		await expect(page.getByText('Skanna för att vara med')).toBeVisible();
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('a reload mid-round and mid-reveal lands in the right state', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser, { timerSeconds: 60 });
	try {
		await g.join('Anna');
		await g.join('Bo'); // connected and never locks: the round only ends when we say so
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		await g.guess('Anna', 47, 2);
		await page.waitForTimeout(1500);
		const before = Number(await page.getByTestId('countdown').getAttribute('data-seconds'));
		await page.reload();
		await expect(page.getByTestId('round-screen')).toBeVisible();
		const after = Number(await page.getByTestId('countdown').getAttribute('data-seconds'));
		expect(after).toBeLessThanOrEqual(before);
		expect(after).toBeGreaterThan(before - 5);
		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-locked', '1');

		await g.endRoundNow();
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'pins');
		await page.waitForTimeout(3500); // past the suspense beat: flying
		await page.reload();
		await expect(stage(page)).toBeVisible();
		await expect(stage(page)).not.toHaveAttribute('data-reveal-stage', 'pins');
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', /flying|lines|done/);
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'done', { timeout: 8000 });

		// After the choreography a reload shows the result at once.
		await page.reload();
		await expect(stage(page)).toHaveAttribute('data-reveal-stage', 'done');
		await expect(page.getByTestId('reveal-name')).toHaveText('Eiffel Tower');
		await expect(page.getByTestId('round-winner')).toContainText('Anna');
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('a Swedish game is shown in Swedish whatever the browser language', async ({ browser }) => {
	const g = await GameDriver.create(BASE(), {
		language: 'sv',
		playlistName: { en: 'Wonders', sv: 'Underverk' }
	});
	const tv = await openTv(browser, 'en-US');
	try {
		// Before pairing there is no game: the browser's language.
		await expect(tv.page.getByText('Pair this screen')).toBeVisible();
		await g.pairTv(tv.code);
		const { page } = tv;
		await expect(page.getByText('Skanna för att vara med')).toBeVisible();
		await expect(page.getByText('Underverk')).toBeVisible();
		await expect(page.getByText('Väntar på att värden startar spelet')).toBeVisible();
		await expect(page.getByTestId('tv')).toHaveAttribute('lang', 'sv');

		await g.join('Anna');
		await g.startRound();
		const target = await g.currentTarget();
		await expect(page.getByTestId('clue-text')).toContainText(target.clueTextSv!);
		await expect(page.getByText('Runda', { exact: true })).toBeVisible();
		await expect(page.getByTestId('locked-count')).toContainText('har låst');
		await g.guess('Anna', 48, 2);
		await g.endRoundNow();
		await g.skipReveal();
		await expect(page.getByTestId('reveal-name')).toHaveText(target.nameSv!);
		await expect(page.getByTestId('round-winner')).toContainText('vinner rundan');
		await expect(page.getByText('Runda 1 av 3')).toBeVisible();
	} finally {
		await tv.context.close();
		await g.cleanup();
	}
});

test('a photo clue is shown letterboxed with its credit; a missing file shows a placeholder', async ({
	browser
}) => {
	const admin = await Admin.login(BASE());
	const photo = await admin.createPhotoLocation({
		image: await makePhoto('landscape'),
		attribution: 'Test Photographer / CC BY 4.0',
		nameEn: 'TV photo test place',
		clueTextEn: 'Mountains around a cold lake',
		factEn: 'A made-up fact.',
		lat: 46.5,
		lng: 8.0
	});
	const { g, page, context } = await pairedGame(browser, { locations: [photo.locationId, SEED.eiffel] }, admin);
	try {
		await g.join('Anna');
		await g.join('Bo');
		await g.startRound();
		const clue = page.getByTestId('clue');
		await expect(clue).toHaveAttribute('data-kind', 'both');
		await expect(page.locator('figure.photo')).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });
		const img = page.locator('img.pic');
		expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
		await expect(img).toHaveCSS('object-fit', 'contain');
		await expect(page.getByText('Photo: Test Photographer / CC BY 4.0')).toBeVisible();
		await expect(page.getByTestId('clue-text')).toContainText('Mountains around a cold lake');
		expect(await page.content()).not.toContain('TV photo test place');

		// Lock-in updates must not hide the loaded photo again.
		await g.guess('Anna', 46, 7);
		await expect(page.getByTestId('locked-count')).toHaveAttribute('data-locked', '1');
		await expect(page.locator('figure.photo')).toHaveAttribute('data-state', 'ready');

		// Remove the files behind the photo: the screen shows a placeholder instead of a hole.
		await rm(path.resolve(process.env.DATA_DIR ?? './data', 'media', photo.fileKey), { recursive: true, force: true });
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
		await page.reload();
		await expect(page.getByTestId('photo-missing')).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('clue-text')).toContainText('Mountains around a cold lake');
	} finally {
		await context.close();
		await g.cleanup();
	}
});

test('a dropped connection shows a quiet indicator and recovers by itself', async ({ browser }) => {
	const { g, page, context } = await pairedGame(browser);
	try {
		await expect(page.getByTestId('tv')).toHaveAttribute('data-connected', 'true');
		await expect(page.getByTestId('tv-offline')).toHaveCount(0);
		await context.setOffline(true);
		await expect(page.getByTestId('tv-offline')).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('tv-offline')).toHaveText('Reconnecting…');
		await g.join('Anna'); // happens while the screen is away
		await context.setOffline(false);
		await expect(page.getByTestId('tv-offline')).toHaveCount(0, { timeout: 15_000 });
		await expect(page.getByTestId('lobby-player')).toHaveCount(1);
		await g.startRound();
		await expect(page.getByTestId('round-screen')).toBeVisible();
	} finally {
		await context.close();
		await g.cleanup();
	}
});
