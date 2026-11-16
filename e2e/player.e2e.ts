/**
 * Player phone (`/play/[code]`) on a mobile touch viewport, driving real games: games are
 * inserted into Postgres from the seeded playlists, the host side is driven through the game's
 * remote commands over HTTP (see helpers/fixtures.ts), phones join through the real join
 * page. Needs the dev database (pnpm seed) and data/map/world.pmtiles.
 */
import { expect, test, type Browser } from '@playwright/test';
import { closeDb, currentGuess, db, playerIdByNickname } from './helpers/db.ts';
import { WEBGL_LAUNCH } from './helpers/env.ts';
import {
	addBot,
	Host,
	insertGame as createGame,
	insertPhotoLocation as createPhotoLocation,
	type Bot,
	type TestGame
} from './helpers/fixtures.ts';
import { GUESS_DEBOUNCE_WAIT, joinViaUi, newPhone, panMap, type PhoneOptions } from './helpers/phone.ts';
import { remoteId } from './helpers/remote.ts';
import { SimPlayer } from './helpers/sim.ts';

test.use({
	// Headless WebGL via SwiftShader (MapLibre).
	launchOptions: WEBGL_LAUNCH
});
test.describe.configure({ timeout: 90_000 });

// --- Per-test bookkeeping ------------------------------------------------------------------------

let host: Host | null = null;
const cleanups: Array<() => Promise<unknown>> = [];

async function getHost(browser: Browser) {
	return (host ??= await Host.login());
}

async function game(opts: Parameters<typeof createGame>[0] = {}): Promise<TestGame> {
	const g = await createGame(opts);
	cleanups.push(g.cleanup);
	return g;
}

async function phone(browser: Browser, opts: PhoneOptions = {}) {
	const p = await newPhone(browser, opts);
	cleanups.push(() => p.context.close());
	return p;
}

async function bot(g: TestGame, nickname: string): Promise<Bot> {
	const b = await addBot(g, nickname);
	cleanups.push(() => b.dispose());
	return b;
}

test.afterEach(async () => {
	// Contexts first (they hold streams), then games, then fixtures.
	for (const fn of cleanups.splice(0).reverse()) await fn().catch(() => {});
});

test.afterAll(async () => {
	await host?.close();
	host = null;
	await closeDb();
});

const uniq = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`;

// --- Tests ---------------------------------------------------------------------------------------

test('not joined → join page; join → lobby shows another player arriving live', async ({ browser }) => {
	const g = await game();
	const a = await phone(browser);

	await a.page.goto(`/play/${g.code.toLowerCase()}`);
	await expect(a.page).toHaveURL(new RegExp(`/join/${g.code}$`));

	const nameA = uniq('Ann');
	await joinViaUi(a.page, g.code, nameA);
	await expect(a.page.getByTestId('lobby')).toBeVisible();
	await expect(a.page.getByTestId('me-name')).toHaveText(nameA);
	await expect(a.page.getByTestId('player-count')).toHaveText('1 player here');

	const b = await phone(browser);
	const nameB = uniq('Bo');
	await joinViaUi(b.page, g.code, nameB);

	await expect(a.page.getByTestId('player-count')).toHaveText('2 players here');
	await expect(a.page.getByTestId('lobby-player')).toHaveText(nameB);
});

test('round: untouched hint, pan, lock in, locked state, reveal holding then own result', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90 });
	const other = await bot(g, uniq('Bot'));
	const { page } = await phone(browser);
	const name = uniq('Pia');
	await joinViaUi(page, g.code, name);
	const me = await playerIdByNickname(g.id, name);
	// A second, connected phone that never locks in keeps the round running.
	const idle = await phone(browser);
	await joinViaUi(idle.page, g.code, uniq('Idle'));

	await h.startRound(g.id);
	await expect(page.getByTestId('round')).toBeVisible();
	await expect(page.getByTestId('round-label')).toHaveText('Round 1/3');
	await expect(page.getByTestId('clue')).toBeVisible();
	await expect(page.getByTestId('round-timer')).toBeVisible();
	const lock = page.getByTestId('lock-in');
	await expect(lock).toBeDisabled();
	await expect(lock).toContainText('Move the map to aim');
	// The red warning only appears in the last seconds.
	await expect(page.getByTestId('untouched-hint')).toHaveCount(0);

	// Another player locks in: only the count reaches the phone, never a position.
	await other.lockIn(10, 10);

	await panMap(page);
	await expect(lock).toBeEnabled();
	await expect(lock).toHaveText('Lock in');
	await lock.tap();

	await expect(page.getByTestId('locked-panel')).toBeVisible();
	await expect(page.getByTestId('locked-panel')).toContainText('Locked in');
	await expect(page.getByTestId('round')).toHaveAttribute('data-locked', 'true');
	await expect(page.getByTestId('locked-count')).toContainText('2 of 3 locked in');
	await expect.poll(async () => (await currentGuess(g.id, me))?.locked_at ?? null).not.toBeNull();
	expect((await currentGuess(g.id, me))?.touched).toBe(true);

	await h.endRoundNow(g.id);
	await expect(page.getByTestId('reveal-holding')).toBeVisible();
	await expect(page.getByTestId('own-result')).toHaveCount(0);

	// After the TV's suspense beat the phone shows the player's own outcome.
	await expect(page.getByTestId('reveal-result')).toBeVisible({ timeout: 10_000 });
	await expect(page.getByTestId('own-result')).toBeVisible();
	await expect(page.getByTestId('own-distance')).toHaveText(/\d.*(km|m)$/);
	await expect(page.getByTestId('answer-name')).toHaveText(g.rounds[0]!.nameEn!);
});

test('refresh mid-round restores the cross and the touched state', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90 });
	const { page } = await phone(browser);
	const name = uniq('Rik');
	await joinViaUi(page, g.code, name);
	const me = await playerIdByNickname(g.id, name);
	const idle = await phone(browser);
	await joinViaUi(idle.page, g.code, uniq('Idle'));

	await h.startRound(g.id);
	await panMap(page, -120, 60);
	await page.waitForTimeout(GUESS_DEBOUNCE_WAIT);
	await expect.poll(() => currentGuess(g.id, me)).not.toBeNull();
	const before = (await currentGuess(g.id, me))!;
	expect(before.touched).toBe(true);

	await page.reload();
	await expect(page.getByTestId('round')).toHaveAttribute('data-touched', 'true');
	await expect(page.locator('.guess-map')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
	await expect(page.getByTestId('lock-in')).toHaveText('Lock in');
	await expect(page.getByTestId('untouched-hint')).toHaveCount(0);

	// Locking in without moving uses the restored centre.
	await page.getByTestId('lock-in').tap();
	await expect(page.getByTestId('locked-panel')).toBeVisible();
	await expect.poll(async () => (await currentGuess(g.id, me))?.locked_at ?? null).not.toBeNull();
	const after = (await currentGuess(g.id, me))!;
	expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.01);
	expect(Math.abs(after.lng - before.lng)).toBeLessThan(0.01);

	// And a refresh after locking shows the locked state again.
	await page.reload();
	await expect(page.getByTestId('locked-panel')).toBeVisible();
});

test('an untouched map at timeout yields no guess', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 6 });
	const { page } = await phone(browser);
	const name = uniq('Ulf');
	await joinViaUi(page, g.code, name);
	const me = await playerIdByNickname(g.id, name);

	await h.startRound(g.id);
	await expect(page.getByTestId('round')).toBeVisible();
	// Near the end the hint turns into a warning.
	await expect(page.getByTestId('untouched-hint')).toHaveText(/won’t have a guess/, { timeout: 10_000 });

	await expect(page.getByTestId('timeup-panel').or(page.getByTestId('reveal-holding'))).toBeVisible({
		timeout: 15_000
	});
	await expect(page.getByTestId('reveal-result')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('own-result')).toHaveAttribute('data-kind', 'noGuess');
	const guess = await currentGuess(g.id, me);
	expect(guess === null || guess.distance_km === null).toBe(true);
});

test('a player joining mid-round spectates until the next round', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90 });
	const first = await phone(browser);
	await joinViaUi(first.page, g.code, uniq('Eva'));
	await h.startRound(g.id);
	await expect(first.page.getByTestId('round')).toBeVisible();

	const late = await phone(browser);
	await joinViaUi(late.page, g.code, uniq('Sen'));
	await expect(late.page.getByTestId('spectator')).toBeVisible();
	await expect(late.page.getByTestId('spectator')).toContainText('joined mid-round');
	await expect(late.page.getByTestId('round')).toHaveAttribute('data-can-guess', 'false');
	await expect(late.page.getByTestId('lock-in')).toHaveCount(0);
	await expect(late.page.getByTestId('clue')).toBeVisible();

	// Next round they play.
	await h.endRoundNow(g.id);
	await h.nextRound(g.id);
	await expect(late.page.getByTestId('standings-screen')).toBeVisible();
	await h.nextRound(g.id);
	await expect(late.page.getByTestId('round')).toHaveAttribute('data-can-guess', 'true');
	await expect(late.page.getByTestId('lock-in')).toBeVisible();
});

test('kicked players see a final message', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game();
	const { page } = await phone(browser);
	const name = uniq('Kim');
	await joinViaUi(page, g.code, name);
	await h.kickPlayer(g.id, await playerIdByNickname(g.id, name));
	await expect(page.getByTestId('gate-kicked')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'You’ve been removed' })).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('gate-kicked')).toBeVisible();
});

test('standings and finished screens: own row, next step, winner, placement', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90, rounds: 2 });
	const rival = await bot(g, uniq('Rival'));
	const { page } = await phone(browser);
	const name = uniq('Fia');
	await joinViaUi(page, g.code, name);

	// Round 1: the bot locks in right on the answer, the phone somewhere else → the bot wins.
	await h.startRound(g.id);
	await rival.lockIn(g.rounds[0]!.lat, g.rounds[0]!.lng);
	await panMap(page);
	await page.getByTestId('lock-in').tap();
	// Let the lock-in land first (it ends the round by itself: the bot is not connected).
	const me = await playerIdByNickname(g.id, name);
	await expect.poll(async () => (await currentGuess(g.id, me))?.locked_at ?? null).not.toBeNull();
	await h.endRoundNow(g.id).catch(() => {});
	await h.skipReveal(g.id);
	await expect(page.getByTestId('reveal-result')).toBeVisible();
	await expect(page.getByTestId('own-result')).toHaveAttribute('data-kind', 'placed');
	await expect(page.getByTestId('own-place')).toHaveText('2nd of 2');
	await expect(page.getByTestId('round-winner')).toContainText(rival.nickname);

	await h.nextRound(g.id);
	await expect(page.getByTestId('standings-screen')).toBeVisible();
	await expect(page.getByTestId('my-row')).toContainText(name);
	await expect(page.getByTestId('next-step')).toHaveText('Next up: round 2 of 2. Get ready!');

	// End the game early → finished, the bot won.
	await h.endGame(g.id);
	await expect(page.getByTestId('finished-screen')).toBeVisible();
	await expect(page.getByTestId('finish-title')).toHaveText(`${rival.nickname} wins!`);
	await expect(page.getByTestId('my-place')).toHaveText('You finished 2nd of 2');
	await expect(page.getByRole('link', { name: 'Back to start' })).toHaveAttribute('href', '/');
});

test('sudden death: stakes are visible to the tied players', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90, rounds: 1 });
	const rival = await bot(g, uniq('Tie'));
	const { page } = await phone(browser);
	const name = uniq('Sam');
	await joinViaUi(page, g.code, name);
	const me = await playerIdByNickname(g.id, name);

	await h.startRound(g.id);
	await panMap(page);
	// The bot locks in exactly where the phone's cross is → exact tie → shared round win. (The
	// phone is the only connected player, so its lock-in ends the round: the bot goes first.)
	await expect.poll(() => currentGuess(g.id, me)).not.toBeNull();
	const mine = (await currentGuess(g.id, me))!;
	await rival.lockIn(mine.lat, mine.lng);
	await page.getByTestId('lock-in').tap();
	await h.endRoundNow(g.id).catch(() => {});
	await h.skipReveal(g.id);
	await expect(page.getByTestId('own-result')).toHaveAttribute('data-kind', 'won');
	await expect(page.getByRole('heading', { name: 'You share the round win!' })).toBeVisible();

	await h.nextRound(g.id);
	await expect(page.getByTestId('next-step')).toHaveAttribute('data-kind', 'suddenDeath');
	await expect(page.getByTestId('next-step')).toContainText('you’re in the sudden death round');

	await h.nextRound(g.id);
	await expect(page.getByTestId('round-label')).toHaveText('Sudden death');
	await expect(page.getByTestId('sd-stakes')).toContainText(`You vs ${rival.nickname}`);
});

test('photo clue opens full screen and closes again (button and Back)', async ({ browser }) => {
	const h = await getHost(browser);
	const fixture = await createPhotoLocation(uniq('photo'));
	cleanups.push(fixture.cleanup);
	const g = await game({ timerSeconds: 90, locationIds: [fixture.id] });
	const { page } = await phone(browser);
	await joinViaUi(page, g.code, uniq('Liv'));
	await h.startRound(g.id);

	await expect(page.getByTestId('clue-text')).toHaveText('A church on a tiny island in an Alpine lake.');
	await page.getByTestId('clue-photo').tap();
	const viewer = page.getByTestId('photo-viewer');
	await expect(viewer).toBeVisible();
	await expect(viewer.locator('img')).toHaveJSProperty('complete', true);
	await page.getByRole('button', { name: 'Close photo' }).tap();
	await expect(viewer).toHaveCount(0);

	await page.getByTestId('clue-photo').tap();
	await expect(viewer).toBeVisible();
	await page.goBack();
	await expect(viewer).toHaveCount(0);
	await expect(page.getByTestId('round')).toBeVisible();

	// Collapse and expand the clue.
	await page.getByTestId('hide-clue').tap();
	await expect(page.getByTestId('clue')).toHaveCount(0);
	await page.getByTestId('show-clue').tap();
	await expect(page.getByTestId('clue')).toBeVisible();
});

test('Swedish phone: lobby and round in Swedish', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90, language: 'en' });
	const { page } = await phone(browser, { locale: 'sv-SE' });
	await joinViaUi(page, g.code, uniq('Sven'));
	await expect(page.getByRole('heading', { name: 'Du är med!' })).toBeVisible();
	await expect(page.getByTestId('player-count')).toHaveText('1 spelare här');

	await h.startRound(g.id);
	await expect(page.getByTestId('round-label')).toHaveText('Runda 1/3');
	await expect(page.getByTestId('lock-in')).toContainText('Flytta kartan för att sikta');
	await panMap(page);
	await expect(page.getByTestId('lock-in')).toHaveText('Lås gissning');
	// The clue uses the Swedish text.
	const [row] = await db()<{ clue_text_sv: string | null }[]>`select clue_text_sv from location where id = ${g.rounds[0]!.locationId}`;
	if (row?.clue_text_sv) await expect(page.getByTestId('clue-text')).toHaveText(row.clue_text_sv);
});

test('a failed lock-in can be retried, and the position keeps being sent', async ({ browser }) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90 });
	const { page } = await phone(browser);
	const name = uniq('Net');
	await joinViaUi(page, g.code, name);
	const me = await playerIdByNickname(g.id, name);
	const idle = await phone(browser);
	await joinViaUi(idle.page, g.code, uniq('Idle'));
	await h.startRound(g.id);

	// The first lock-in request dies on the network.
	let failed = false;
	await page.route('**/_app/remote/**/lockIn', async (route) => {
		if (failed) return route.continue();
		failed = true;
		await route.abort('internetdisconnected');
	});
	await panMap(page);
	await page.getByTestId('lock-in').tap();
	await expect(page.getByTestId('lock-error')).toBeVisible();
	await expect(page.getByTestId('lock-in')).toHaveText('Try again');
	// The cross position still reached the server, so the timeout rule would count it.
	await expect.poll(async () => (await currentGuess(g.id, me))?.touched ?? false).toBe(true);

	await page.getByTestId('lock-in').tap();
	await expect(page.getByTestId('locked-panel')).toBeVisible();
	await expect.poll(async () => (await currentGuess(g.id, me))?.locked_at ?? null).not.toBeNull();
});

test('a round the server is late to end does not make the phone reconnect on every snapshot', async ({
	browser
}) => {
	const h = await getHost(browser);
	const g = await game({ timerSeconds: 90 });
	const { page } = await phone(browser);
	await joinViaUi(page, g.code, uniq('Wait'));
	await h.startRound(g.id);
	await expect(page.getByTestId('round')).toBeVisible();

	const opened: number[] = [];
	const stream = `/_app/remote/${remoteId('game', 'playerState')}`;
	page.on('request', (r) => {
		if (r.url().includes(stream)) opened.push(Date.now());
	});
	// The deadline the phone sees is long past, but the server keeps the round running (as when
	// it is retrying a round end that failed).
	await db()`update game_round set ends_at = now() - interval '10 seconds'
		where game_id = ${g.id} and started_at is not null and ended_at is null`;
	// Snapshots keep coming: other players join and come and go.
	for (let i = 0; i < 3; i++) {
		const p = new SimPlayer(g.code, uniq('Sim'));
		cleanups.push(async () => p.disconnect());
		await p.join();
		p.disconnect();
		await p.connect();
	}
	await page.waitForTimeout(5000);
	// One resync for the overdue round, then backoff (the next one is 8 s later).
	expect(opened.length).toBeGreaterThanOrEqual(1);
	expect(opened.length).toBeLessThanOrEqual(2);
	await expect(page.getByTestId('round')).toBeVisible();
});

test('losing the connection shows an indicator and recovers by itself', async ({ browser }) => {
	const g = await game();
	const { context, page } = await phone(browser);
	await joinViaUi(page, g.code, uniq('Off'));
	await expect(page.getByTestId('lobby')).toBeVisible();

	await context.setOffline(true);
	await expect(page.getByTestId('connection-badge')).toBeVisible({ timeout: 10_000 });
	await context.setOffline(false);
	await expect(page.getByTestId('connection-badge')).toHaveCount(0, { timeout: 15_000 });

	// Live again: another player joining shows up without a refresh.
	const b = await phone(browser);
	const nameB = uniq('Bea');
	await joinViaUi(b.page, g.code, nameB);
	await expect(page.getByTestId('lobby-player')).toHaveText(nameB);
});
