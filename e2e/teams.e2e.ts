/**
 * Teams games: the host's create form, the join page's team choice, even auto-assignment, and a
 * short game where the TV, a phone and the host show team results. Games are created through the
 * host UI or the driver (e2e/helpers/driver.ts); every test removes what it created.
 *
 * Needs the seeded playlists (pnpm seed) and the map tiles for the TV reveal and the phone map.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createGameViaUi, hostHomeReady, loginHost } from './helpers/admin.ts';
import { closeDb, db, LANDMARKS, SEED } from './helpers/db.ts';
import { GameDriver } from './helpers/driver.ts';
import { WEBGL_LAUNCH } from './helpers/env.ts';
import { Created } from './helpers/fixtures.ts';
import { newPhone } from './helpers/phone.ts';

test.use({ locale: 'en-US', launchOptions: WEBGL_LAUNCH });
test.describe.configure({ timeout: 120_000 });

const BASE = () => test.info().project.use.baseURL!;

test.afterAll(async () => {
	await closeDb();
});

async function teamCounts(gameId: string): Promise<Record<number, number>> {
	const rows = await db()<{ team: number; n: number }[]>`
		select team, count(*)::int as n from player where game_id = ${gameId} and not kicked group by team`;
	return Object.fromEntries(rows.map((r) => [r.team, r.n]));
}

/** A fresh TV context on /tv; resolves its pairing code. */
async function openTv(browser: Browser) {
	const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1920, height: 1080 } });
	const page = await context.newPage();
	await page.goto('/tv');
	const el = page.getByTestId('pairing-code');
	await expect(el).toHaveAttribute('data-code', /^\d{6}$/, { timeout: 15_000 });
	return { context, page, code: (await el.getAttribute('data-code'))! };
}

/** On an open join page: the nickname, optionally a team, then submit. */
async function fillJoin(page: Page, nickname: string, team?: string) {
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await page.locator('#nickname').fill(nickname);
	if (team) await page.getByTestId('team-option').filter({ hasText: team }).click();
	await page.locator('#nickname').press('Enter');
}

test('the host creates a teams game; a phone picks its team on the join page', async ({ page, browser }) => {
	const created = new Created();
	const phone = await newPhone(browser);
	try {
		await loginHost(page);
		await page.getByTestId('playlist-option').filter({ hasText: LANDMARKS.en }).click();
		const toggle = page.getByTestId('teams-toggle');
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(page.locator('#team-count')).toHaveCount(0);

		await toggle.click();
		await expect(page.locator('#team-count')).toHaveValue('2');
		await expect(page.getByTestId('team-name-input')).toHaveCount(2);
		await expect(page.getByTestId('team-pick-toggle')).toHaveAttribute('aria-checked', 'false');
		// The stepper stops at 2 and 8.
		const teamsStepper = page.locator('.stepper').filter({ has: page.locator('#team-count') });
		await expect(teamsStepper.getByRole('button', { name: 'Fewer' })).toBeDisabled();
		await page.locator('#team-count').fill('8');
		await expect(teamsStepper.getByRole('button', { name: 'More' })).toBeDisabled();
		await page.locator('#team-count').fill('3');
		const names = page.getByTestId('team-name-input');
		await expect(names).toHaveCount(3);
		await expect(names.nth(1)).toHaveAttribute('placeholder', 'Team 2');
		await names.nth(0).fill('Red');
		await names.nth(2).fill('Blue');
		await page.getByTestId('team-pick-toggle').click();

		const { gameId, code } = await createGameViaUi(page, { onCreated: (id) => created.games.add(id) });
		const [row] = await db()<{ team_count: number; team_names: string[]; team_pick: boolean }[]>`
			select team_count, team_names, team_pick from game where id = ${gameId}`;
		expect(row).toEqual({ team_count: 3, team_names: ['Red', '', 'Blue'], team_pick: true });

		// Host lobby: every team as a heading, empty ones included.
		const hostTeams = page.getByTestId('lobby-team');
		await expect(hostTeams).toHaveCount(3);
		await expect(hostTeams.nth(0)).toContainText('Red');
		await expect(hostTeams.nth(1)).toContainText('Team 2');
		await expect(hostTeams.nth(2)).toContainText('Blue');

		// The join page lists the teams with their player counts.
		await phone.page.goto(`/join/${code}`);
		const options = phone.page.getByTestId('team-option');
		await expect(options).toHaveCount(3);
		await expect(options.nth(0)).toContainText('Red');
		await expect(options.nth(1)).toContainText('Team 2');
		await expect(options.nth(2)).toContainText('Blue');
		await expect(options.nth(2)).toContainText('0 players');

		// No team chosen: a message, still on the join page.
		await fillJoin(phone.page, 'Dana');
		await expect(phone.page.getByRole('alert')).toContainText('Pick a team first');
		await expect(phone.page).toHaveURL(new RegExp(`/join/${code}$`));

		await phone.page.getByTestId('team-option').filter({ hasText: 'Blue' }).click();
		await phone.page.locator('#nickname').press('Enter');
		await phone.page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 20_000 });
		await expect(phone.page.getByTestId('my-team')).toHaveText('You’re on Blue');
		await expect(page.getByTestId('lobby-team').nth(2).getByTestId('player-row')).toHaveAttribute('data-team', '2');
	} finally {
		await phone.context.close();
		await created.cleanup();
	}
});

test('without picking, joins are spread evenly and a kicked player’s team gets the next one', async ({ page }) => {
	const g = await GameDriver.create(BASE(), { teams: { count: 2 } });
	try {
		await page.goto(`/join/${g.joinCode}`);
		await expect(page.locator('#nickname')).toBeVisible();
		await expect(page.getByTestId('team-option')).toHaveCount(0);

		const [a] = await g.joinMany(['Anna', 'Bo', 'Cecilia', 'Dag'], { connected: false });
		expect(await teamCounts(g.gameId)).toEqual({ 0: 2, 1: 2 });

		await g.cmd('kickPlayer', { gameId: g.gameId, playerId: a!.playerId });
		await g.join('Eva', { connected: false });
		const [eva] = await db()<{ team: number }[]>`
			select team from player where game_id = ${g.gameId} and nickname = 'Eva'`;
		expect(eva!.team).toBe(0);
		expect(await teamCounts(g.gameId)).toEqual({ 0: 2, 1: 2 });
	} finally {
		await g.cleanup();
	}
});

test('a short teams game: team round win, team standings and the winning team on every screen', async ({
	browser
}) => {
	const g = await GameDriver.create(BASE(), {
		locations: [SEED.eiffel, SEED.liberty],
		rounds: 1,
		teams: { count: 3, pick: true, names: ['Red', '', 'Blue'] }
	});
	const tv = await openTv(browser);
	const phone = await newPhone(browser);
	const hostContext = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
	const host = await hostContext.newPage();
	try {
		await g.pairTv(tv.code);
		await expect(tv.page.getByTestId('lobby-screen')).toBeVisible();
		await expect(tv.page.getByTestId('team-heading')).toHaveText([/Red/, /Team 2/, /Blue/]);

		// Anna joins through the join page (Red); Bo (Team 2) and Cid (Blue) are simulated.
		await phone.page.goto(`/join/${g.joinCode}`);
		await fillJoin(phone.page, 'Anna', 'Red');
		await phone.page.waitForURL(new RegExp(`/play/${g.joinCode}$`), { timeout: 20_000 });
		await expect(phone.page.getByTestId('my-team')).toHaveText('You’re on Red');
		const bo = await g.join('Bo', { team: 1 });
		await g.join('Cid', { team: 2 });
		await expect(tv.page.locator(`[data-testid="lobby-player"][data-player-id="${bo.playerId}"]`)).toHaveAttribute(
			'data-team',
			'1'
		);

		await loginHost(host, `/host/${g.gameId}`);
		await g.startRound();
		await expect(tv.page.getByTestId('round-screen')).toBeVisible();
		await expect(tv.page.getByTestId('player-team')).toHaveCount(3);

		// Bo is closest to the Eiffel Tower: Team 2 takes the round.
		await g.guess('Bo', 48.85, 2.3);
		await g.guess('Cid', 40.4, -3.7);
		await g.endRoundNow();
		await g.skipReveal();
		const winner = tv.page.getByTestId('round-winner');
		await expect(winner).toHaveAttribute('data-winner-teams', '1', { timeout: 15_000 });
		await expect(winner).toContainText('Team 2 took the round');
		await expect(phone.page.getByTestId('team-outcome')).toHaveText('Team 2 took the round', { timeout: 15_000 });
		await expect(phone.page.getByTestId('team-outcome')).toHaveAttribute('data-team-won', 'false');
		const boState = await bo.state((v) => v.status === 'playing' && v.phase === 'reveal');
		expect(boState.status === 'playing' && boState.phase === 'reveal' && boState.myResult?.teamWon).toBe(true);
		await expect(host.getByTestId('round-winner')).toHaveAttribute('data-winner-teams', '1');

		// Standings: team tables on the TV, the phone and the host.
		await g.nextRound();
		for (const page of [tv.page, phone.page, host]) {
			const table = page.getByTestId('team-standings');
			await expect(table).toBeVisible();
			const rows = table.getByTestId('team-row');
			await expect(rows).toHaveCount(3);
			await expect(rows.first()).toHaveAttribute('data-team', '1');
			await expect(rows.first()).toContainText('Bo');
		}
		await expect(phone.page.getByTestId('team-standings').getByTestId('my-row')).toContainText('Anna');
		await expect(phone.page.getByTestId('team-standings').getByTestId('my-row')).toContainText('–');

		// Finished: Team 2 wins on every screen.
		await g.nextRound();
		const finished = tv.page.getByTestId('finished-screen');
		await expect(finished).toHaveAttribute('data-winner-teams', '1');
		await expect(tv.page.getByTestId('winner-team')).toHaveText('Team 2');
		await expect(finished).toContainText('Bo');
		await expect(host.getByTestId('final-winner')).toContainText('Team 2 wins!');
		await expect(phone.page.getByTestId('finish-hero')).toHaveAttribute('data-winner-teams', '1');
		await expect(phone.page.getByTestId('finish-title')).toHaveText('Team 2 wins!');
	} finally {
		await phone.context.close();
		await hostContext.close();
		await tv.context.close();
		await g.cleanup();
	}
});

test('the create form without teams submits no team settings', async ({ page }) => {
	const created = new Created();
	try {
		await loginHost(page);
		await hostHomeReady(page);
		const { gameId } = await createGameViaUi(page, { onCreated: (id) => created.games.add(id) });
		const [row] = await db()<{ team_count: number | null; team_names: string[]; team_pick: boolean }[]>`
			select team_count, team_names, team_pick from game where id = ${gameId}`;
		expect(row).toEqual({ team_count: null, team_names: [], team_pick: false });
		await expect(page.getByTestId('lobby-team')).toHaveCount(0);
	} finally {
		await created.cleanup();
	}
});
