/**
 * The real thing: one game played through the real pages on five screens at once. The host
 * (phone) logs in and runs the game, the TV (1920×1080) shows it, three phones join by the URL
 * in the TV's QR code and pan the real map by touch.
 *
 * The test reads each round's answer from Postgres to place the crosses where it wants them
 * (the UIs never see the answer before the reveal, and the test checks that they do not show
 * it). Guesses are arranged so the regular rounds end in a tie and a sudden death decides.
 *
 * Runs in its own Playwright project after all other tests (see playwright.config.ts): the
 * sudden-death round picks a random library location, and the restart scenario starts and
 * stops a second server, neither of which should overlap with other tests.
 */
import { existsSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
import { Admin } from './helpers/admin.ts';
import { BASE_URL, WEBGL_LAUNCH } from './helpers/env.ts';
import { closeDb, db, dbGame, deleteGames, deleteTvs, SEED } from './helpers/db.ts';
import { newPhone, steerTo, submitNickname } from './helpers/phone.ts';
import {
	bg,
	expectNoAnswer,
	hexToRgb,
	offset,
	PRIVATE_URL,
	PrivateServer,
	roundState,
	setUpGame,
	TIMER
} from './helpers/screens.ts';

test.use({ launchOptions: WEBGL_LAUNCH });
test.describe.configure({ mode: 'serial' });

// --- Scenario 1: a whole game ------------------------------------------------------------------------

test('a whole game on five real screens: three rounds, a tie, sudden death and one winner', async ({ browser }) => {
	test.setTimeout(420_000);
	const admin = await Admin.login();
	const tag = Math.random().toString(36).slice(2, 7);
	const listName = `Full game ${tag}`;
	await admin.createPlaylist([SEED.eiffel, SEED.sydney, SEED.machuPicchu], {
		en: listName,
		sv: `Helt spel ${tag}`,
		timerSeconds: TIMER
	});
	const track = { games: new Set<string>(), tvs: new Set<string>() };
	let contexts: BrowserContext[] = [];
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
			track
		);
		contexts = setup.contexts;
		const { screens: s, gameId } = setup;
		const { host, tv, phones } = s;

		// --- Lobby: everyone sees everyone, in the same colour ---------------------------------
		await s.phase('lobby');
		await expect(tv.getByTestId('lobby-player')).toHaveCount(3);
		await expect(host.getByTestId('player-row')).toHaveCount(3);
		await expect(s.phone('Anna').page.getByTestId('player-count')).toHaveText('3 players here');
		await expect(s.phone('Björn').page.getByTestId('player-count')).toHaveText('3 spelare här');
		for (const p of phones) {
			const rgb = hexToRgb(p.color);
			expect(await bg(tv, `[data-testid="lobby-player"][data-player-id="${p.id}"] .avatar`)).toBe(rgb);
			expect(await bg(host, `[data-testid="player-row"][data-player="${p.nick}"] .dot`)).toBe(rgb);
			for (const other of phones) {
				// Every phone lists every player with the same colour dot (its own first).
				const chip = other.page.locator('.chip', { hasText: p.nick }).locator('.dot');
				expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb);
			}
		}
		expect(new Set(phones.map((p) => p.color)).size).toBe(3);

		// --- Round 1 (Eiffel Tower): everyone locks in, Anna is closest -------------------------
		await s.hostPrimary('Start game');
		await s.phase('round');
		await s.roundLabel(1);
		let r = await roundState(gameId);
		await expectNoAnswer([tv, ...phones.map((p) => p.page)], r.target);
		await s.locked([], ['Anna', 'Björn', 'Cleo']);
		await s.steer(gameId, r.index, [
			['Anna', offset(r.target, 1, 0)],
			['Björn', offset(r.target, 0, 7)],
			['Cleo', offset(r.target, -16, 0)]
		]);
		await s.lockIn('Anna');
		await s.locked(['Anna'], ['Anna', 'Björn', 'Cleo']);
		await s.lockIn('Björn');
		await s.locked(['Anna', 'Björn'], ['Anna', 'Björn', 'Cleo']);
		await expectNoAnswer([tv, ...phones.map((p) => p.page)], r.target);
		await s.watchReveal();
		await s.lockIn('Cleo'); // the last one: the round ends by itself
		await s.reveal(r.target);
		await s.results(gameId, ['Anna'], []);
		expect((await dbGame(gameId)).phase).toBe('reveal');

		await s.hostPrimary('Show standings');
		await s.standings(gameId, { Anna: 1, Björn: 0, Cleo: 0 });
		await expect(tv.getByTestId('standings-screen')).toHaveAttribute('data-next', 'round');
		for (const p of phones) await expect(p.page.getByTestId('next-step')).toHaveAttribute('data-kind', 'round');

		// --- Round 2 (Sydney): ends by the timer; Björn's unlocked cross counts, Cleo never touches
		await s.hostPrimary('Start round 2');
		await s.phase('round');
		await s.roundLabel(2);
		r = await roundState(gameId);
		await expectNoAnswer([tv, ...phones.map((p) => p.page)], r.target);
		await s.steer(gameId, r.index, [
			['Anna', offset(r.target, 0, -9)],
			['Björn', offset(r.target, 2, 0)]
		]);
		await s.lockIn('Anna');
		await s.locked(['Anna'], ['Anna', 'Björn', 'Cleo']);
		// Cleo is warned near the end that an untouched map does not count.
		await expect(s.phone('Cleo').page.getByTestId('untouched-hint')).toBeVisible({ timeout: TIMER * 1000 });
		await s.watchReveal();
		await expect(s.phone('Cleo').page.getByTestId('timeup-panel')).toBeVisible({ timeout: TIMER * 1000 });
		await s.reveal(r.target);
		await s.results(gameId, ['Björn'], ['Cleo']);
		await expect(host.getByTestId('result-row').filter({ hasText: 'Björn' })).toContainText('time ran out');
		await expect(tv.getByText('1 player without a guess')).toBeVisible();

		await s.hostPrimary('Show standings');
		await s.standings(gameId, { Anna: 1, Björn: 1, Cleo: 0 });

		// --- Round 3 (Machu Picchu): nobody touches the map; the host ends it -------------------
		await s.hostPrimary('Start round 3');
		await s.phase('round');
		await s.roundLabel(3);
		r = await roundState(gameId);
		await expectNoAnswer([tv, ...phones.map((p) => p.page)], r.target);
		await s.watchReveal();
		await host.getByTestId('end-round').click({ delay: 1300 });
		await s.reveal(r.target);
		await s.results(gameId, [], ['Anna', 'Björn', 'Cleo']);
		for (const p of phones) {
			await expect(p.page.getByText(p.locale === 'sv' ? 'Ingen gissade den här rundan.' : 'Nobody made a guess this round.')).toBeVisible();
		}

		// --- Tie at the top: Anna and Björn go to sudden death, Cleo watches --------------------
		await s.hostPrimary('Show standings');
		await s.standings(gameId, { Anna: 1, Björn: 1, Cleo: 0 });
		await expect(tv.getByTestId('standings-screen')).toHaveAttribute('data-next', 'suddenDeath');
		// The duellists, named in the same order on every screen (the standings order).
		const duel = await tv
			.getByTestId('next-duel')
			.locator('.who')
			.evaluateAll((els) =>
				els.map((el) =>
					[...el.childNodes]
						.filter((n) => n.nodeType === Node.TEXT_NODE)
						.map((n) => n.textContent!.trim())
						.join('')
				)
			);
		expect([...duel].sort()).toEqual(['Anna', 'Björn']);
		const [first, second] = duel;
		for (const p of phones) await expect(p.page.getByTestId('next-step')).toHaveAttribute('data-kind', 'suddenDeath');
		await expect(s.phone('Cleo').page.getByTestId('next-step')).toContainText(`${first} and ${second} play sudden death`);
		await expect(s.phone('Björn').page.getByTestId('next-step')).toContainText('du är med i utslagsrundan');

		await s.hostPrimary(`Start sudden death: ${first} and ${second}`);
		await s.phase('round');
		await s.roundLabel(1, true);
		r = await roundState(gameId);
		await expectNoAnswer([tv, ...phones.map((p) => p.page)], r.target);
		expect(await tv.getByTestId('duel').locator('.dn').allTextContents()).toEqual(duel);
		await expect(tv.getByTestId('watching')).toBeVisible();
		await expect(s.phone('Cleo').page.getByTestId('round')).toHaveAttribute('data-can-guess', 'false');
		await expect(s.phone('Cleo').page.getByTestId('spectator')).toContainText(`Sudden death between ${first} and ${second}`);
		await expect(s.phone('Anna').page.getByTestId('sd-stakes')).toContainText('You vs Björn');
		await s.locked([], ['Anna', 'Björn']);
		await s.steer(gameId, r.index, [
			['Anna', offset(r.target, 0, 2)],
			['Björn', offset(r.target, 10, 0)]
		]);
		await s.lockIn('Björn');
		await s.locked(['Björn'], ['Anna', 'Björn']);
		await s.watchReveal();
		await s.lockIn('Anna'); // both duellists locked: the round ends without waiting for Cleo
		await s.reveal(r.target);
		await s.results(gameId, ['Anna'], []);

		await s.hostPrimary('Show standings');
		await s.standings(gameId, { Anna: 2, Björn: 1, Cleo: 0 });
		await expect(tv.getByTestId('standings-screen')).toHaveAttribute('data-next', 'finish');

		// --- Game over -------------------------------------------------------------------------
		await s.hostPrimary('Show final result');
		await s.phase('finished');
		const anna = s.phone('Anna');
		await expect(tv.getByTestId('finished-screen')).toHaveAttribute('data-winners', anna.id);
		await expect(tv.getByTestId('game-winner')).toContainText('Anna');
		await expect(host.getByTestId('final-winner')).toContainText('Anna');
		await expect(anna.page.getByTestId('finish-hero')).toHaveAttribute('data-kind', 'me');
		await expect(s.phone('Cleo').page.getByTestId('finish-title')).toHaveText('Anna wins!');
		await expect(s.phone('Björn').page.getByTestId('finish-hero')).toHaveAttribute('data-kind', 'other');
		expect(await dbGame(gameId)).toMatchObject({ phase: 'finished' });

		// The TV offers its next pairing code (shown split in two), and the host is told so.
		const next = tv.getByTestId('next-pairing');
		await expect(next).toHaveAttribute('data-code', /^\d{6}$/);
		const nextCode = (await next.getAttribute('data-code'))!;
		await expect(next).toContainText(`${nextCode.slice(0, 3)} ${nextCode.slice(3)}`);
		await expect(host.getByTestId('tv-next-pairing')).toBeVisible();
	} finally {
		for (const c of contexts) await c.close().catch(() => {});
		await deleteGames(track.games);
		await deleteTvs(track.tvs);
		await admin.cleanupContent();
	}
});

// --- Scenario 2: late joiner, reload, kick and a server restart, on a private server ----------------

test('mid-game: a reload, a kick, a late joiner and a server restart during a round', async ({ browser }) => {
	test.skip(!!process.env.E2E_BASE_URL || !existsSync('build/index.js'), 'needs the production build (pnpm test:e2e)');
	test.setTimeout(300_000);
	const server = new PrivateServer();
	await server.start();
	const admin = await Admin.login(PRIVATE_URL);
	const tag = Math.random().toString(36).slice(2, 7);
	const listName = `Mid-game ${tag}`;
	await admin.createPlaylist([SEED.giza, SEED.liberty, SEED.sydney], { en: listName, sv: `Mitt i ${tag}`, timerSeconds: 180 });
	const track = { games: new Set<string>(), tvs: new Set<string>() };
	let contexts: BrowserContext[] = [];
	try {
		const setup = await setUpGame(
			browser,
			PRIVATE_URL,
			listName,
			[
				['Anna', 'en'],
				['Ben', 'en'],
				['Cleo', 'en']
			],
			track,
			// Rounds here must outlast steering, a restart and the checks around it.
			180
		);
		contexts = setup.contexts;
		const { screens: s, gameId, code } = setup;
		const { host, tv } = s;
		const pages = () => [tv, ...s.phones.map((p) => p.page)];

		// --- Round 1: Ben reloads his phone mid-round and keeps his cross ------------------------
		await s.hostPrimary('Start game');
		await s.phase('round');
		let r = await roundState(gameId);
		const ben = s.phone('Ben');
		await steerTo(ben.page, gameId, r.index, offset(r.target, 4, 0));
		await expect.poll(async () => (await db()`
			select g.touched from guess g join game_round gr on gr.id = g.round_id
			where gr.game_id = ${gameId} and gr.index = ${r.index} and g.player_id = ${ben.id}`)[0]?.touched).toBe(true);
		await ben.page.reload();
		await expect(ben.page.getByTestId('round')).toHaveAttribute('data-touched', 'true', { timeout: 15_000 });
		await expect(ben.page.getByTestId('lock-in')).toBeEnabled();
		await s.lockIn('Ben');
		await steerTo(s.phone('Anna').page, gameId, r.index, offset(r.target, 1, 0));
		await s.lockIn('Anna');
		await s.locked(['Anna', 'Ben'], ['Anna', 'Ben', 'Cleo']);
		await expectNoAnswer(pages(), r.target);

		// --- The host removes Cleo: her phone says so, the round ends (everyone left locked in) --
		await s.watchReveal();
		await host.getByTestId('menu-button').click();
		await host.getByRole('button', { name: 'Remove Cleo' }).click();
		await host.getByRole('button', { name: 'Yes, remove' }).click();
		const cleo = s.phone('Cleo');
		await expect(cleo.page.getByTestId('gate-kicked')).toBeVisible();
		s.phones.splice(s.phones.indexOf(cleo), 1);
		await host.keyboard.press('Escape');
		await s.reveal(r.target);
		await s.results(gameId, ['Anna'], []);
		await expect(tv.locator(`[data-player-id="${cleo.id}"]`)).toHaveCount(0);

		// --- Between rounds: Dana joins late from the TV's QR and plays the next round ------------
		await s.hostPrimary('Show standings');
		await s.phase('standings');
		const { context: danaCtx, page: danaPage } = await newPhone(browser);
		contexts.push(danaCtx);
		await danaPage.goto(`${PRIVATE_URL}/join/${code}`);
		await submitNickname(danaPage, code, 'Dana');
		const [danaRow] = await db()<{ id: string; color: string }[]>`
			select id, color from player where game_id = ${gameId} and nickname = 'Dana'`;
		s.phones.push({ nick: 'Dana', locale: 'en', page: danaPage, id: danaRow!.id, color: danaRow!.color });
		await expect(tv.getByTestId('standings-row')).toHaveCount(3);
		await expect(host.getByTestId('standing-row')).toHaveCount(3);
		await s.standings(gameId, { Anna: 1, Ben: 0, Dana: 0 });

		await s.hostPrimary('Start round 2');
		await s.phase('round');
		await s.roundLabel(2);
		r = await roundState(gameId);
		await s.locked([], ['Anna', 'Ben', 'Dana']);
		await steerTo(s.phone('Anna').page, gameId, r.index, offset(r.target, 0, 3));
		await s.lockIn('Anna');
		await s.locked(['Anna'], ['Anna', 'Ben', 'Dana']);
		const [before] = await db()<{ ends_at: Date }[]>`
			select ends_at from game_round where game_id = ${gameId} and index = ${r.index}`;

		// --- The server restarts mid-round (SIGTERM, like a deploy) -------------------------------
		const stopMs = await server.stop();
		expect(stopMs, 'shutdown with open event streams').toBeLessThan(5000);
		await expect(tv.getByTestId('tv-offline')).toBeVisible({ timeout: 10_000 });
		await expect(host.getByTestId('connection')).toHaveAttribute('data-state', 'offline', { timeout: 10_000 });
		await expect(ben.page.getByTestId('connection-badge')).toBeVisible({ timeout: 10_000 });
		await server.start();
		for (const p of s.phones) {
			await expect(p.page.getByTestId('connection-badge'), p.nick).toHaveCount(0, { timeout: 20_000 });
		}

		// Every screen reconnects by itself, to the same round, with Anna still locked in.
		await expect(tv.getByTestId('tv-offline')).toHaveCount(0, { timeout: 30_000 });
		await expect(host.getByTestId('connection')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
		await s.phase('round');
		await s.locked(['Anna'], ['Anna', 'Ben', 'Dana']);
		const [after] = await db()<{ ends_at: Date }[]>`
			select ends_at from game_round where game_id = ${gameId} and index = ${r.index}`;
		expect(after!.ends_at.getTime()).toBe(before!.ends_at.getTime());

		await steerTo(ben.page, gameId, r.index, offset(r.target, -6, 0));
		await steerTo(danaPage, gameId, r.index, offset(r.target, 0, -12));
		await s.watchReveal();
		await s.lockIn('Ben');
		await s.lockIn('Dana');
		// Everyone locked in: the round ends (after the restart's reconnect grace at the latest).
		await s.reveal(r.target);
		await s.results(gameId, ['Anna'], []);

		// --- The host ends the game early from the menu -----------------------------------------
		await host.getByTestId('menu-button').click();
		await host.getByTestId('end-game').click();
		await host.getByTestId('end-game-confirm').click();
		await s.phase('finished');
		await expect(tv.getByTestId('finished-screen')).toHaveAttribute('data-winners', s.phone('Anna').id);
		expect(await dbGame(gameId)).toMatchObject({ phase: 'finished' });
	} finally {
		for (const c of contexts) await c.close().catch(() => {});
		await deleteGames(track.games);
		await deleteTvs(track.tvs);
		await admin.cleanupContent();
		await server.stop();
	}
});

test.afterAll(async () => {
	await closeDb();
});
