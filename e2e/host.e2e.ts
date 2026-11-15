/**
 * Host controller (`/host`, `/host/[gameId]`). The host's phone is a real browser page; players
 * and the TV are simulated over HTTP with the real remote functions (e2e/helpers/sim.ts),
 * so these tests do not depend on the /play or /tv UIs.
 *
 * Every test creates its own game (and TV/players) and removes exactly those afterwards.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { createGameViaUi, loginHost } from './helpers/admin.ts';
import { closeDb, dbGame, LANDMARKS } from './helpers/db.ts';
import { Created } from './helpers/fixtures.ts';
import { remoteId } from './helpers/remote.ts';

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } });

let created: Created;
test.beforeEach(() => {
	created = new Created();
});
test.afterEach(async () => {
	await created.cleanup();
});
test.afterAll(async () => {
	await closeDb();
});

/** Creates a game through the real /host form; the test's registry removes it afterwards. */
const createGame = (page: Page, reg: Created, opts: { rounds?: number; seconds?: number; playlist?: string } = {}) =>
	createGameViaUi(page, { ...opts, onCreated: (id) => reg.games.add(id) });

const primary = (page: Page) => page.getByTestId('primary-action');
const title = (page: Page) => page.getByTestId('phase-title');

/** Lobby → round with the given players already joined. */
async function startRound(page: Page) {
	await expect(primary(page)).toBeEnabled();
	await primary(page).click();
	await expect(page.getByTestId('end-round')).toBeVisible();
}

/** Round → reveal via the hold-to-confirm button. */
async function endRoundNow(page: Page) {
	await page.getByTestId('end-round').click({ delay: 1300 });
	await expect(page.getByTestId('reveal-place')).toBeVisible();
}

test.describe('create', () => {
	test('form defaults, validation and the created game', async ({ page }) => {
		await loginHost(page);
		const create = page.getByTestId('create-game');
		await expect(create).toBeDisabled();
		await expect(create).toHaveText('Pick a playlist');

		await page.getByTestId('playlist-option').filter({ hasText: LANDMARKS.en }).click();
		// Defaults: every location, the playlist's timer, the host phone's language for the TV.
		await expect(page.locator('#rounds')).toHaveValue(String(LANDMARKS.size));
		await expect(page.getByRole('button', { name: `All ${LANDMARKS.size}` })).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#seconds')).toHaveValue('30');
		await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
		await expect(page.getByRole('radio', { name: 'Playlist order' })).toBeChecked();
		// With all locations there is nothing to choose between first and random.
		await expect(page.getByText('Which locations')).toHaveCount(0);
		await expect(create).toBeEnabled();
		await expect(page.getByTestId('create-summary')).toHaveText(`${LANDMARKS.size} rounds · 30 s each`);

		// Validation: out-of-range values block the form with a clear message.
		await page.locator('#seconds').fill('3');
		await expect(page.getByText('Between 5 and 600 seconds')).toBeVisible();
		await expect(create).toBeDisabled();
		await page.locator('#seconds').fill('15');
		await page.locator('#rounds').fill('99');
		await expect(page.getByText(`Between 1 and ${LANDMARKS.size}`)).toBeVisible();
		await expect(create).toBeDisabled();
		// "Fewer" from out of range lands on the maximum, then steps down.
		await page.getByRole('button', { name: 'Fewer' }).first().click();
		await expect(page.locator('#rounds')).toHaveValue(String(LANDMARKS.size));
		await page.getByRole('button', { name: 'Fewer' }).first().click();
		await expect(page.locator('#rounds')).toHaveValue(String(LANDMARKS.size - 1));

		// Fewer rounds than locations: first N vs random N appears.
		await page.getByRole('button', { name: '5', exact: true }).click();
		await expect(page.locator('#rounds')).toHaveValue('5');
		await page.getByText('5 at random', { exact: true }).click();
		await page.getByText('Shuffled', { exact: true }).click();
		await page.getByText('Swedish', { exact: true }).click();
		await expect(page.getByTestId('create-summary')).toHaveText('5 rounds · 15 s each');

		await create.click();
		await page.waitForURL(/\/host\/[0-9a-f-]{36}$/);
		const gameId = new URL(page.url()).pathname.split('/').pop()!;
		created.games.add(gameId);
		await expect(title(page)).toHaveText('Lobby');
		await expect(page.getByTestId('join-code')).toHaveText(/^[A-Z]{4}$/);
		expect(await dbGame(gameId)).toMatchObject({
			phase: 'lobby',
			round_count: 5,
			selection: 'random',
			shuffle: true,
			timer_seconds: 15,
			language: 'sv'
		});

		// The unfinished game is offered on /host to get back in.
		await page.goto('/host');
		await expect(page.locator(`a[href="/host/${gameId}"]`)).toBeVisible();
	});

	test('unknown and malformed game ids are handled', async ({ page }) => {
		await loginHost(page);
		await page.goto('/host/00000000-0000-4000-8000-000000000000');
		await expect(page.getByTestId('host-fatal')).toHaveAttribute('data-state', 'notFound');
		await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
		await page.goto('/host/not-a-game');
		await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
		await page.getByRole('link', { name: 'All games' }).click();
		await expect(page).toHaveURL(/\/host$/);
	});
});

test.describe('lobby', () => {
	test('pairs the TV with a wrong, then the right code, and shows when it drops', async ({ page }) => {
		await loginHost(page);
		await createGame(page, created);
		const tv = await created.tv();
		const status = page.getByTestId('tv-status');
		await expect(status).toHaveCount(0);

		const wrong = tv.pairingCode.replace(/^\d/, (d) => String((Number(d) + 5) % 10));
		await page.locator('#pairing-code').fill(wrong);
		await expect(page.getByText('No screen is showing that code right now')).toBeVisible();
		await expect(status).toHaveCount(0);

		// Six digits submit by themselves (numeric keypad, no extra tap).
		await page.locator('#pairing-code').fill(tv.pairingCode);
		await expect(status).toHaveAttribute('data-state', 'connected');
		await expect(status).toContainText('TV connected');
		await expect(page.getByTestId('tv-indicator')).toHaveClass(/\bon\b/);
		await tv.state((s) => s.status === 'paired');

		tv.disconnect();
		await expect(status).toHaveAttribute('data-state', 'disconnected', { timeout: 15_000 });
		await expect(status).toContainText('TV disconnected');
		await tv.connect();
		await expect(status).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });
	});

	test('players appear live, can be removed, and start needs at least one', async ({ page }) => {
		await loginHost(page);
		const { code } = await createGame(page, created);
		await expect(primary(page)).toBeDisabled();
		await expect(primary(page)).toHaveText('Waiting for players');

		const [, bob] = await created.join(code, 'Alice', 'Bob');
		const rows = page.getByTestId('player-row');
		await expect(rows).toHaveCount(2);
		await expect(page.getByTestId('player-count')).toHaveText('2');
		await expect(rows.filter({ hasText: 'Alice' })).toBeVisible();
		// No TV: allowed, with a warning.
		await expect(page.getByTestId('no-tv-warning')).toBeVisible();
		await expect(primary(page)).toBeEnabled();

		// Kick asks first.
		await page.getByRole('button', { name: 'Remove Bob' }).click();
		await expect(page.getByText('Remove Bob from the game?')).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		await expect(rows).toHaveCount(2);
		await page.getByRole('button', { name: 'Remove Bob' }).click();
		await page.getByRole('button', { name: 'Yes, remove' }).click();
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('Alice');
		await bob!.state((s) => s.status === 'kicked');

		await startRound(page);
		await expect(title(page)).toHaveText(`Round 1 of ${LANDMARKS.size}`);
	});
});

test.describe('running a game', () => {
	test('round → reveal → standings → next round', async ({ page }) => {
		await loginHost(page);
		const { code, gameId } = await createGame(page, created, { rounds: 3, seconds: 120 });
		const [alice] = await created.join(code, 'Alice', 'Bob');
		await startRound(page);
		await expect(title(page)).toHaveText('Round 1 of 3');

		// Who has locked in, live.
		await expect(page.getByTestId('player-guessing')).toHaveCount(2);
		await expect(page.getByTestId('lock-count')).toHaveText(/0\s*\/ 2/);
		await alice!.lockIn(48.86, 2.29);
		await expect(page.getByTestId('player-locked')).toHaveText(/Alice/);
		await expect(page.getByTestId('player-guessing')).toHaveText(/Bob/);
		await expect(page.getByTestId('lock-count')).toHaveText(/1\s*\/ 2/);

		// A quick tap on "hold to end" does nothing.
		await page.getByTestId('end-round').click();
		await page.waitForTimeout(1200);
		expect((await dbGame(gameId)).phase).toBe('round');

		await endRoundNow(page);
		await expect(page.getByTestId('round-winner')).toContainText('Alice wins the round');
		await expect(page.getByTestId('result-row')).toHaveCount(2);
		await expect(page.getByTestId('result-row').nth(1)).toContainText('No guess');

		// Skip the TV animation while it runs.
		const skip = page.getByTestId('skip-reveal');
		await expect(skip).toBeVisible();
		await skip.click();
		await expect(skip).toHaveCount(0);
		await expect(page.getByTestId('reveal-progress')).toContainText('Revealed on the TV');

		await primary(page).click();
		await expect(title(page)).toHaveText('Standings');
		await expect(page.getByTestId('standing-row').first()).toContainText('Alice');
		await expect(primary(page)).toHaveText('Start round 2');
		await primary(page).click();
		await expect(title(page)).toHaveText('Round 2 of 3');
		await expect(page.getByTestId('player-guessing')).toHaveCount(2);
		expect(await dbGame(gameId)).toMatchObject({ phase: 'round', started: 2 });
	});

	test('double taps advance exactly once', async ({ page }) => {
		await loginHost(page);
		const { code, gameId } = await createGame(page, created, { rounds: 3, seconds: 120 });
		const [alice] = await created.join(code, 'Alice');
		await startRound(page);
		await alice!.lockIn(10, 10); // the only player: the round ends by itself
		await expect(page.getByTestId('reveal-place')).toBeVisible();

		// A machine-fast double click on "Show standings".
		await primary(page).dblclick();
		await expect(title(page)).toHaveText('Standings');
		await page.waitForTimeout(1500);
		expect((await dbGame(gameId)).phase).toBe('standings');
		await expect(title(page)).toHaveText('Standings');

		await primary(page).dblclick();
		await expect(title(page)).toHaveText('Round 2 of 3');
		await page.waitForTimeout(1500);
		expect(await dbGame(gameId)).toMatchObject({ phase: 'round', started: 2 });

		// A human double tap (~200 ms apart) on the same spot: the second tap lands after the
		// standings appeared, where "Start round 3" now sits. It must not start round 3.
		await alice!.lockIn(10, 10);
		await expect(page.getByTestId('reveal-place')).toBeVisible();
		await expect(primary(page)).toBeEnabled();
		await page.waitForTimeout(800);
		const box = (await primary(page).boundingBox())!;
		const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
		await page.mouse.click(x, y);
		await page.waitForTimeout(200);
		await page.mouse.click(x, y);
		await expect(title(page)).toHaveText('Standings');
		await page.waitForTimeout(1500);
		expect(await dbGame(gameId)).toMatchObject({ phase: 'standings', started: 2 });
		await expect(primary(page)).toHaveText('Start round 3');
	});

	test('two host devices pressing next at the same moment advance exactly once', async ({ page, context }) => {
		await loginHost(page);
		const { code, gameId } = await createGame(page, created, { rounds: 3, seconds: 120 });
		const [alice] = await created.join(code, 'Alice');
		await startRound(page);
		await alice!.lockIn(10, 10);
		await expect(page.getByTestId('reveal-place')).toBeVisible();
		// A second device of the same host (same session) on the same game.
		const other = await context.newPage();
		await other.goto(page.url());
		await expect(other.locator('html[data-hydrated="true"]')).toBeAttached();
		await expect(other.getByTestId('reveal-place')).toBeVisible();
		await expect(primary(page)).toBeEnabled();
		await expect(primary(other)).toBeEnabled();
		await page.waitForTimeout(800); // past ARM_MS on both

		// Both "Show standings" requests are in flight before either reaches the server.
		const held: Route[] = [];
		let bothHeld!: () => void;
		const ready = new Promise<void>((resolve) => (bothHeld = resolve));
		const hold = async (route: Route) => {
			held.push(route);
			if (held.length === 2) bothHeld();
		};
		const url = `**/_app/remote/${remoteId('game', 'nextRound')}`;
		await page.route(url, hold);
		await other.route(url, hold);
		await Promise.all([primary(page).click(), primary(other).click()]);
		await ready;
		await Promise.all(held.map((r) => r.continue()));

		await expect(title(page)).toHaveText('Standings');
		await expect(title(other)).toHaveText('Standings');
		await page.waitForTimeout(1500);
		expect(await dbGame(gameId)).toMatchObject({ phase: 'standings', started: 1 });
		await expect(primary(page)).toHaveText('Start round 2');
		await other.close();
	});

	test('a tie at the end offers sudden death between the tied players', async ({ page }) => {
		await loginHost(page);
		const { code } = await createGame(page, created, { rounds: 1, seconds: 120 });
		const [alice, bob] = await created.join(code, 'Alice', 'Bob');
		await startRound(page);
		await expect(title(page)).toHaveText('Round 1 of 1');
		// Identical guesses: an exact tie, both win the round. (Names are listed in join order,
		// and the two simulated players join concurrently.)
		await alice!.lockIn(40, 20);
		await bob!.lockIn(40, 20);
		await expect(page.getByTestId('round-winner')).toContainText(/Tie: (Alice and Bob|Bob and Alice) each get a point/);

		await primary(page).click();
		await expect(title(page)).toHaveText('Standings');
		await expect(page.getByTestId('sudden-death-explain')).toContainText(/(Alice and Bob|Bob and Alice) are tied for the lead/);
		await expect(primary(page)).toHaveText(/^Start sudden death: (Alice and Bob|Bob and Alice)$/);
		await primary(page).click();
		await expect(title(page)).toHaveText(/Sudden death/);
		await expect(page.getByTestId('player-guessing')).toHaveCount(2);
	});

	test('end game from the menu, with the TV note at the end', async ({ page }) => {
		await loginHost(page);
		const { code, gameId } = await createGame(page, created, { seconds: 120 });
		const tv = await created.tv();
		await page.locator('#pairing-code').fill(tv.pairingCode);
		await expect(page.getByTestId('tv-status')).toHaveAttribute('data-state', 'connected');
		await created.join(code, 'Alice');
		await startRound(page);

		await page.getByTestId('menu-button').click();
		const menu = page.getByTestId('game-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId('player-row')).toHaveCount(1);
		await menu.getByTestId('end-game').click();
		await expect(menu.getByText('End the game for everyone?')).toBeVisible();
		await menu.getByTestId('end-game-confirm').click();

		await expect(title(page)).toHaveText('Game over');
		await expect(menu).toBeHidden();
		await expect(page.getByTestId('final-winner')).toContainText('No winner this time');
		await expect(page.getByText('The game was ended early.')).toBeVisible();
		await expect(page.getByTestId('tv-next-pairing')).toBeVisible();
		expect((await dbGame(gameId)).phase).toBe('finished');
		// The TV gets a fresh pairing code for the next game.
		await tv.state((s) => s.status === 'paired' && s.phase === 'finished' && !!s.nextPairing);

		await primary(page).click();
		await expect(page).toHaveURL(/\/host$/);
		await expect(page.locator(`a[href="/host/${gameId}"]`)).toHaveCount(0);
	});
});

test.describe('connection', () => {
	test('shows when the connection drops and catches up afterwards', async ({ page, context }) => {
		await loginHost(page);
		const { code } = await createGame(page, created);
		const conn = page.getByTestId('connection');
		await expect(conn).toHaveAttribute('data-state', 'live');

		await context.setOffline(true);
		await expect(conn).toHaveAttribute('data-state', 'offline', { timeout: 10_000 });
		// Something happens while the phone is offline…
		await created.join(code, 'Late Larry');
		await page.waitForTimeout(500);
		await expect(page.getByTestId('player-row')).toHaveCount(0);

		// …and shows up once it is back.
		await context.setOffline(false);
		await expect(conn).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
		await expect(page.getByTestId('player-row')).toHaveCount(1);
		await expect(page.getByTestId('player-row')).toContainText('Late Larry');

		// Back from the background (phone asleep): the stream is reopened for a fresh snapshot.
		const setVisibility = (state: 'hidden' | 'visible') =>
			page.evaluate((s) => {
				Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
				document.dispatchEvent(new Event('visibilitychange'));
			}, state);
		await setVisibility('hidden');
		await page.waitForTimeout(1700);
		const reopened = page.waitForRequest((r) => r.url().includes('/hostState'));
		await setVisibility('visible');
		await reopened;
		await expect(conn).toHaveAttribute('data-state', 'live');
	});
});

test.describe('failures', () => {
	test('a command that cannot reach the server shows a retry', async ({ page, context }) => {
		await loginHost(page);
		const { code, gameId } = await createGame(page, created);
		await created.join(code, 'Alice');
		await expect(primary(page)).toBeEnabled();
		await page.waitForTimeout(700);

		await context.setOffline(true);
		await primary(page).click();
		const failure = page.getByTestId('command-failure');
		await expect(failure).toContainText('No connection');
		await expect(primary(page)).toBeEnabled(); // unlocked again
		expect((await dbGame(gameId)).phase).toBe('lobby');

		await context.setOffline(false);
		await failure.getByRole('button', { name: 'Try again' }).click();
		await expect(page.getByTestId('end-round')).toBeVisible();
		await expect(failure).toHaveCount(0);
		expect((await dbGame(gameId)).phase).toBe('round');
	});
});

test.describe('Swedish', () => {
	test.use({ locale: 'sv-SE' });

	test('the controller renders in Swedish', async ({ page }) => {
		await loginHost(page);
		await expect(page.getByRole('heading', { name: 'Nytt spel' })).toBeVisible();
		await expect(page.getByTestId('create-game')).toHaveText('Välj en spellista');
		await page.getByTestId('playlist-option').filter({ hasText: LANDMARKS.sv }).click();
		await expect(page.getByRole('radio', { name: 'Svenska' })).toBeChecked();
		await expect(page.getByTestId('create-game')).toHaveText('Skapa spel');
		await page.getByTestId('create-game').click();
		await page.waitForURL(/\/host\/[0-9a-f-]{36}$/);
		const gameId = new URL(page.url()).pathname.split('/').pop()!;
		created.games.add(gameId);
		const code = (await page.getByTestId('join-code').textContent())!.trim();

		await expect(page.getByText('Storskärm', { exact: true })).toBeVisible();
		await expect(primary(page)).toHaveText('Väntar på spelare');
		await created.join(code, 'Åsa');
		await expect(primary(page)).toHaveText('Starta spelet');
		await primary(page).click();
		await expect(title(page)).toHaveText(`Runda 1 av ${LANDMARKS.size}`);
		await expect(page.getByTestId('end-round')).toHaveText('Håll in för att avsluta rundan');
		await expect(page.getByText('Gissar fortfarande')).toBeVisible();
	});
});
