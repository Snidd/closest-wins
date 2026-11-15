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
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { formatDistance } from '../src/lib/i18n/format.ts';
import { Admin, createGameViaUi, loginHost } from './helpers/admin.ts';
import { BASE_URL, WEBGL_LAUNCH } from './helpers/env.ts';
import { closeDb, currentTarget, db, dbGame, deleteGames, deleteTvs, SEED, type LocationRow } from './helpers/db.ts';
import { newPhone, steerTo, submitNickname } from './helpers/phone.ts';
import { expectedQrPath } from './helpers/qr.ts';

test.use({ launchOptions: WEBGL_LAUNCH });
test.describe.configure({ mode: 'serial' });

/** Seconds per round: long enough for three phones to steer, short enough to wait out once. */
const TIMER = 30;

type Locale = 'en' | 'sv';
interface Phone {
	nick: string;
	locale: Locale;
	page: Page;
	id: string;
	color: string;
}

// --- Small helpers -------------------------------------------------------------------------------

const hexToRgb = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const bg = (page: Page, selector: string) =>
	page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
const km = (d: number, locale: Locale) => formatDistance(d, locale === 'sv' ? 'sv-SE' : 'en-GB');

/** Visible text of the page, for "the answer is not on this screen" checks. */
const screenText = (page: Page) => page.locator('body').innerText();

async function expectNoAnswer(pages: Page[], target: LocationRow) {
	const secrets = [target.nameEn, target.nameSv, target.factEn, target.factSv].filter(
		(s): s is string => !!s && s.length > 3
	);
	for (const page of pages) {
		const text = await screenText(page);
		for (const s of secrets) expect(text, `answer text on ${page.url()}`).not.toContain(s);
	}
}

/**
 * Records (in the page, on the shared machine clock) when `selector` first appears, so the test
 * can compare when two screens showed something without polling granularity in the way.
 */
async function watchAppear(page: Page, key: string, selector: string) {
	await page.evaluate(
		([k, sel]) => {
			const w = window as unknown as { __appear?: Record<string, number> };
			w.__appear ??= {};
			delete w.__appear[k];
			const check = () => {
				if (!w.__appear![k] && document.querySelector(sel)) w.__appear![k] = Date.now();
			};
			check();
			new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
		},
		[key, selector] as const
	);
}
const appearedAt = (page: Page, key: string) =>
	page.evaluate((k) => (window as unknown as { __appear?: Record<string, number> }).__appear?.[k] ?? null, key);

/** A point `dLat`/`dLng` degrees away from the target. */
const offset = (t: LocationRow, dLat: number, dLng: number) => ({ lat: t.lat + dLat, lng: t.lng + dLng });

async function roundState(gameId: string) {
	const g = await dbGame(gameId);
	return { index: g.current_round!, target: await currentTarget(gameId) };
}

/** Distances the engine stored for the current round (after it ended). */
async function storedDistances(gameId: string): Promise<Map<string, number>> {
	const rows = await db()<{ player_id: string; distance_km: number }[]>`
		select g.player_id, g.distance_km from guess g
		join game_round r on r.id = g.round_id join game on game.id = r.game_id
		where game.id = ${gameId} and r.index = game.current_round and g.distance_km is not null`;
	return new Map(rows.map((r) => [r.player_id, r.distance_km]));
}

// --- Screens ---------------------------------------------------------------------------------------

class Screens {
	constructor(
		readonly host: Page,
		readonly tv: Page,
		readonly phones: Phone[]
	) {}

	phone(nick: string) {
		return this.phones.find((p) => p.nick === nick)!;
	}

	/** All five screens show the same phase. */
	async phase(phase: string) {
		await expect(this.tv.getByTestId('tv')).toHaveAttribute('data-phase', phase, { timeout: 15_000 });
		await expect(this.host.getByTestId('host-controller')).toHaveAttribute('data-phase', phase, { timeout: 15_000 });
		for (const p of this.phones) {
			await expect(p.page.getByTestId('player-app'), p.nick).toHaveAttribute('data-phase', phase, { timeout: 15_000 });
		}
	}

	/** Round labels agree (regular round `n` of 3, or sudden death). */
	async roundLabel(n: number, suddenDeath = false) {
		if (suddenDeath) {
			await expect(this.tv.getByTestId('sudden-death-label')).toBeVisible();
			await expect(this.host.getByTestId('phase-title')).toHaveText(/Sudden death/);
			for (const p of this.phones) {
				await expect(p.page.getByTestId('round-label')).toHaveText(p.locale === 'sv' ? 'Utslagsrunda' : 'Sudden death');
			}
			return;
		}
		await expect(this.tv.getByTestId('round-label')).toHaveText(new RegExp(`^${n}\\s*/\\s*3$`));
		await expect(this.host.getByTestId('phase-title')).toHaveText(`Round ${n} of 3`);
		for (const p of this.phones) {
			await expect(p.page.getByTestId('round-label')).toHaveText(p.locale === 'sv' ? `Runda ${n}/3` : `Round ${n}/3`);
		}
	}

	/** Who has locked in, out of the players guessing this round, agrees on every screen. */
	async locked(locked: string[], guessing: string[]) {
		const n = guessing.length;
		await expect(this.tv.getByTestId('locked-count')).toHaveAttribute('data-locked', String(locked.length));
		await expect(this.tv.getByTestId('locked-count')).toHaveAttribute('data-total', String(n));
		for (const nick of guessing) {
			const id = this.phone(nick).id;
			await expect(this.tv.locator(`[data-testid="round-player"][data-player-id="${id}"]`)).toHaveAttribute(
				'data-locked',
				String(locked.includes(nick))
			);
		}
		await expect(this.host.getByTestId('lock-count')).toHaveText(new RegExp(`${locked.length}\\s*/ ${n}`));
		await expect(this.host.getByTestId('player-locked')).toHaveCount(locked.length);
		for (const nick of locked) {
			await expect(this.host.locator(`[data-testid="player-locked"][data-player="${nick}"]`)).toBeVisible();
		}
		for (const p of this.phones) {
			const round = p.page.getByTestId('round');
			const isLocked = locked.includes(p.nick);
			await expect(round, p.nick).toHaveAttribute('data-locked', String(isLocked));
			await expect(round, p.nick).toHaveAttribute('data-can-guess', String(guessing.includes(p.nick)));
			// Phones show the tally once they are done guessing (locked in, or watching).
			if (isLocked || !guessing.includes(p.nick)) {
				await expect(p.page.getByTestId('locked-count')).toContainText(
					p.locale === 'sv' ? `${locked.length} av ${n} har låst` : `${locked.length} of ${n} locked in`
				);
			}
		}
	}

	/** Steers several phones at once (each phone has its own touch screen). */
	async steer(gameId: string, roundIndex: number, moves: Array<[string, { lat: number; lng: number }]>) {
		await Promise.all(moves.map(([nick, at]) => steerTo(this.phone(nick).page, gameId, roundIndex, at)));
	}

	async lockIn(nick: string) {
		const page = this.phone(nick).page;
		await page.getByTestId('lock-in').tap();
		await expect(page.getByTestId('locked-panel')).toBeVisible();
	}

	/** Before a round ends: note when the TV shows the answer and when each phone shows its result. */
	async watchReveal() {
		await watchAppear(this.tv, 'answer', '[data-testid="reveal-name"]');
		for (const p of this.phones) await watchAppear(p.page, 'result', '[data-testid="reveal-result"]');
	}

	/**
	 * The reveal on all screens: suspense first (no answer on the TV or the phones), then the TV
	 * shows the answer, and only from that moment the phones show their own result.
	 */
	async reveal(target: LocationRow) {
		await this.phase('reveal');
		const name = target.nameEn!;
		await expect(this.tv.getByTestId('reveal-name')).toHaveText(name, { timeout: 15_000 });
		for (const p of this.phones) {
			await expect(p.page.getByTestId('reveal-result')).toBeVisible({ timeout: 10_000 });
			await expect(p.page.getByTestId('answer-name')).toHaveText(p.locale === 'sv' ? (target.nameSv ?? name) : name);
		}
		const tvAt = await appearedAt(this.tv, 'answer');
		expect(tvAt).not.toBeNull();
		for (const p of this.phones) {
			const at = await appearedAt(p.page, 'result');
			expect(at, `${p.nick}'s phone showed its result before the TV showed the answer`).toBeGreaterThanOrEqual(
				tvAt! - 300
			);
		}
		await expect(this.host.getByTestId('reveal-place')).toHaveText(name);
		await expect(this.tv.getByTestId('reveal-screen')).toHaveAttribute('data-reveal-stage', 'done', { timeout: 10_000 });
	}

	/** Winner and distances agree with what the engine stored, on every screen. */
	async results(gameId: string, winners: string[], noGuess: string[]) {
		const dist = await storedDistances(gameId);
		const winnerIds = winners.map((n) => this.phone(n).id);
		await expect(this.tv.getByTestId('round-winner')).toHaveAttribute('data-winners', winnerIds.join(','));
		if (winners.length === 0) {
			await expect(this.tv.getByTestId('round-winner')).toContainText('Nobody guessed');
			await expect(this.host.getByTestId('round-winner')).toContainText('Nobody guessed');
		} else {
			await expect(this.host.getByTestId('round-winner')).toContainText(`${winners.join(' and ')} wins the round`);
		}

		// Ranked distances: TV ranking, host results and each phone's own distance.
		const ranked = this.phones.filter((p) => dist.has(p.id)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
		const tvRows = this.tv.getByTestId('ranking-row');
		const hostRows = this.host.getByTestId('result-row');
		await expect(tvRows).toHaveCount(ranked.length);
		await expect(hostRows).toHaveCount(ranked.length + noGuess.length);
		for (const [i, p] of ranked.entries()) {
			const d = km(dist.get(p.id)!, 'en');
			await expect(tvRows.nth(i).locator('.rname')).toHaveText(p.nick);
			await expect(tvRows.nth(i).locator('.km')).toHaveText(d);
			await expect(hostRows.nth(i)).toContainText(p.nick);
			await expect(hostRows.nth(i).locator('.km')).toHaveText(d);
		}
		for (const p of this.phones) {
			const own = p.page.getByTestId('own-result');
			if (dist.has(p.id)) {
				await expect(own).toHaveAttribute('data-kind', winners.includes(p.nick) ? 'won' : 'placed');
				await expect(p.page.getByTestId('own-distance')).toHaveText(km(dist.get(p.id)!, p.locale));
			} else if (noGuess.includes(p.nick)) {
				await expect(own).toHaveAttribute('data-kind', 'noGuess');
			} else {
				await expect(own).toHaveAttribute('data-kind', 'spectator');
			}
		}
		for (const nick of noGuess) {
			await expect(hostRows.filter({ hasText: nick })).toContainText('No guess');
		}
	}

	/** Standings (order, rounds won, total distance) agree on all screens. */
	async standings(gameId: string, wins: Record<string, number>) {
		await this.phase('standings');
		const totals = new Map(
			(
				await db()<{ player_id: string; total: number; n: number }[]>`
					select g.player_id, sum(g.distance_km)::float8 as total, count(*)::int as n from guess g
					join game_round r on r.id = g.round_id where r.game_id = ${gameId} and g.distance_km is not null
					group by g.player_id`
			).map((r) => [r.player_id, r.total])
		);
		const order = [...this.phones].sort((a, b) => wins[b.nick]! - wins[a.nick]! || 0);
		const tvRows = this.tv.getByTestId('standings-row');
		const hostRows = this.host.getByTestId('standing-row');
		await expect(tvRows).toHaveCount(this.phones.length);
		await expect(hostRows).toHaveCount(this.phones.length);
		for (const p of order) {
			const tvRow = this.tv.locator(`[data-testid="standings-row"][data-player-id="${p.id}"]`);
			const hostRow = this.host.locator(`[data-testid="standing-row"][data-player="${p.nick}"]`);
			const total = totals.has(p.id) ? km(totals.get(p.id)!, 'en') : '–';
			await expect(tvRow.locator('.wins')).toHaveText(String(wins[p.nick]));
			await expect(tvRow.locator('.dist')).toHaveText(total);
			await expect(hostRow.locator('.wins')).toHaveText(String(wins[p.nick]));
			await expect(hostRow.locator('.dist')).toHaveText(total);
			const mine = p.page.getByTestId('my-row');
			await expect(mine.locator('.won')).toHaveText(String(wins[p.nick]));
			await expect(mine.locator('.dist')).toHaveText(totals.has(p.id) ? km(totals.get(p.id)!, p.locale) : '–');
		}
		// Same order everywhere: by rounds won.
		const tvOrder = await tvRows.locator('.name').allTextContents();
		const hostOrder = await hostRows.locator('.name').allTextContents();
		expect(hostOrder).toEqual(tvOrder);
		for (const p of this.phones) {
			expect(await p.page.locator('[data-testid="standings"] tbody .nick').allTextContents()).toEqual(tvOrder);
		}
		const winsInOrder = tvOrder.map((n) => wins[n]!);
		expect(winsInOrder).toEqual([...winsInOrder].sort((a, b) => b - a));
	}

	/** The host's big button, once it is armed for the current phase. */
	async hostPrimary(label: string | RegExp) {
		const button = this.host.getByTestId('primary-action');
		await expect(button).toHaveText(label);
		await expect(button.locator('xpath=ancestor::div[contains(@class,"actions")]')).not.toHaveClass(/arming/);
		await button.click();
	}
}

// --- Setup -----------------------------------------------------------------------------------------

interface Setup {
	screens: Screens;
	gameId: string;
	code: string;
	contexts: BrowserContext[];
}

async function setUpGame(
	browser: Browser,
	baseURL: string,
	playlistName: string,
	players: Array<[string, Locale]>,
	track: { games: Set<string>; tvs: Set<string> }
): Promise<Setup> {
	const contexts: BrowserContext[] = [];
	const hostCtx = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		locale: 'en-US'
	});
	contexts.push(hostCtx);
	const host = await hostCtx.newPage();
	await loginHost(host);
	const { gameId, code } = await createGameViaUi(host, {
		playlist: playlistName,
		rounds: 3,
		seconds: TIMER,
		onCreated: (id) => track.games.add(id)
	});

	// The TV shows a pairing code; the host types it.
	const tvCtx = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, locale: 'en-US' });
	contexts.push(tvCtx);
	const tv = await tvCtx.newPage();
	await tv.goto('/tv');
	const pairing = tv.getByTestId('pairing-code');
	await expect(pairing).toHaveAttribute('data-code', /^\d{6}$/, { timeout: 15_000 });
	const pairingCode = (await pairing.getAttribute('data-code'))!;
	const [tvRow] = await db()<{ id: string }[]>`select id from tv_screen where pairing_code = ${pairingCode}`;
	track.tvs.add(tvRow!.id);
	await host.locator('#pairing-code').fill(pairingCode);
	await expect(host.getByTestId('tv-status')).toHaveAttribute('data-state', 'connected');
	await expect(tv.getByTestId('lobby-screen')).toBeVisible();
	await expect(tv.getByTestId('join-code')).toHaveText(code);

	// "Scanning": the TV's QR code encodes exactly this URL; the phones open it.
	const joinUrl = `${baseURL}/join/${code}`;
	await expect(tv.locator('svg.qr').first().locator('path')).toHaveAttribute('d', expectedQrPath(joinUrl, 2));

	const phones: Phone[] = [];
	for (const [nick, locale] of players) {
		const { context, page } = await newPhone(browser, { locale: locale === 'sv' ? 'sv-SE' : 'en-US' });
		contexts.push(context);
		await page.goto(joinUrl);
		await submitNickname(page, code, nick);
		const [row] = await db()<{ id: string; color: string }[]>`
			select id, color from player where game_id = ${gameId} and nickname = ${nick}`;
		phones.push({ nick, locale, page, id: row!.id, color: row!.color });
	}
	return { screens: new Screens(host, tv, phones), gameId, code, contexts };
}

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

test.afterAll(async () => {
	await closeDb();
});

// Unused until scenario 2 lands.
void spawn;
void existsSync;
export type { ChildProcess };
