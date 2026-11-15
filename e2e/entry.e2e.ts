/**
 * Entry pages: landing (join code input), /join/[code] and /login.
 *
 * Some join tests need a real game. They insert a lobby game straight into Postgres (random
 * code, deleted afterwards).
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { expect, test, type Browser, type Page } from '@playwright/test';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

// --- Test games in the database ------------------------------------------------------------------

let sql: postgres.Sql | null = null;
const db = () => (sql ??= postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} }));

test.afterAll(async () => {
	await sql?.end();
	sql = null;
});

/** Inserts a lobby game with an unused join code; returns it with a cleanup function. */
async function createLobbyGame(): Promise<{ id: string; code: string; cleanup: () => Promise<void> }> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const code = Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
		const rows = await db()`
			insert into game (join_code, language, timer_seconds, round_count, selection)
			select ${code}, 'en', 30, 3, 'first'
			where not exists (select 1 from game where join_code = ${code} and phase <> 'finished')
			returning id`;
		if (rows.length) {
			const id = rows[0]!.id as string;
			return { id, code, cleanup: async () => void (await db()`delete from game where id = ${id}`) };
		}
	}
	throw new Error('could not find a free join code');
}

async function newPhone(browser: Browser, locale = 'en-US') {
	const context = await browser.newContext({
		locale,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	return { context, page: await context.newPage() };
}

const codeInput = (page: Page) => page.getByTestId('join-code');

/** Waits until Svelte has hydrated (event handlers attached). */
async function hydrated(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

// --- Landing ---------------------------------------------------------------------------------------

test.describe('landing', () => {
	test('shows the name in the visitor’s language and a quiet host link', async ({ browser }) => {
		for (const [locale, name, join, host] of [
			['en-US', 'Closest Wins', 'Join', 'Host a game'],
			['sv-SE', 'Närmast vinner', 'Gå med', 'Starta ett spel']
		] as const) {
			const { context, page } = await newPhone(browser, locale);
			await page.goto('/');
			await expect(page.locator('h1')).toHaveText(name);
			await expect(page.getByRole('button', { name: join, exact: true })).toBeVisible();
			await expect(page.getByRole('link', { name: host })).toHaveAttribute('href', '/host');
			await context.close();
		}
	});

	test('code input upper-cases, drops invalid characters and caps at four letters', async ({ page }) => {
		await page.goto('/');
		await hydrated(page);
		const input = codeInput(page);

		await input.pressSequentially('abcd');
		await expect(input).toHaveValue('ABCD');

		await input.fill('');
		await input.pressSequentially('a1');
		await expect(input).toHaveValue('A');
		await expect(page.getByText('Codes use the letters A–Z, except I, L and O')).toBeVisible();
		await input.pressSequentially('o b');
		await expect(input).toHaveValue('AB');

		await input.pressSequentially('cdef');
		await expect(input).toHaveValue('ABCD');
		await expect(page.getByText('The four letters on the TV')).toBeVisible();
	});

	test('pasting a messy code cleans it up', async ({ page }) => {
		await page.goto('/');
		await hydrated(page);
		const input = codeInput(page);
		await input.focus();
		// insertText is what a paste or keyboard suggestion does: one input event, many characters.
		await page.keyboard.insertText('  wx yz ');
		await expect(input).toHaveValue('WXYZ');

		await input.fill('');
		await page.keyboard.insertText('abcdefgh');
		await expect(input).toHaveValue('ABCD');
	});

	test('an incomplete code explains itself; a complete one opens the join page', async ({ page }) => {
		await page.goto('/');
		await hydrated(page);
		await codeInput(page).pressSequentially('ab');
		await page.getByRole('button', { name: 'Join', exact: true }).click();
		await expect(page.getByText('A game code is four letters')).toBeVisible();
		await expect(page).toHaveURL(/\/$/);

		// Tapping anywhere in the field continues at the end (pressSequentially would reset the
		// caret to the start, which no real tap does).
		await codeInput(page).click({ position: { x: 5, y: 10 } });
		await page.keyboard.type('cd');
		await expect(codeInput(page)).toHaveValue('ABCD');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/join\/ABCD$/);
	});

	test('works without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false, locale: 'en-US' });
		const page = await context.newPage();
		await page.goto('/');
		await codeInput(page).fill(' ab cd ');
		await page.getByRole('button', { name: 'Join', exact: true }).click();
		await expect(page).toHaveURL(/\/join\/ABCD$/);

		await page.goto('/');
		await codeInput(page).fill('ab');
		await page.getByRole('button', { name: 'Join', exact: true }).click();
		await expect(page).toHaveURL(/\/\?code=ab$/);
		await expect(page.getByText('A game code is four letters')).toBeVisible();
		await context.close();
	});
});

// --- Join page -------------------------------------------------------------------------------------

test.describe('join page', () => {
	test('lower-case codes redirect to the canonical URL', async ({ page }) => {
		await page.goto('/join/abcd');
		await expect(page).toHaveURL(/\/join\/ABCD$/);
	});

	test('an impossible code shows a friendly message in both languages', async ({ browser }) => {
		for (const [locale, title, back] of [
			['en-US', 'No game with that code', 'Try another code'],
			['sv-SE', 'Inget spel med den koden', 'Testa en annan kod']
		] as const) {
			const { context, page } = await newPhone(browser, locale);
			await page.goto('/join/IOL1');
			await expect(page.getByRole('heading', { name: title })).toBeVisible();
			await page.getByRole('link', { name: back }).click();
			await expect(page).toHaveURL(/\/$/);
			await context.close();
		}
	});

	test('an unknown code shows the not-found message', async ({ page }) => {
		// A valid-looking code with no game behind it (deleted right after creation).
		const game = await createLobbyGame();
		await game.cleanup();
		await page.goto(`/join/${game.code}`);
		const state = await page.locator('main').getAttribute('data-state');
		expect(state).toBe('notFound');
		await expect(page.getByRole('heading', { name: 'No game with that code' })).toBeVisible();
		await expect(page.getByText(game.code)).toBeVisible();
	});

	test('nickname field: focus, keyboard hints, counter, grapheme cap, preflight', async ({ browser }) => {
		const game = await createLobbyGame();
		const { context, page } = await newPhone(browser);
		try {
			await page.goto(`/join/${game.code}`);
			await hydrated(page);
			const nick = page.locator('#nickname');
			await expect(nick).toBeFocused();
			await expect(nick).toHaveAttribute('autocomplete', 'nickname');
			await expect(nick).toHaveAttribute('enterkeyhint', 'go');
			await expect(nick).toHaveAttribute('autocapitalize', 'words');
			await expect(page.getByTestId('join-code-chip')).toContainText(game.code);

			// Empty submit is caught on the phone, in the player's language.
			await page.getByRole('button', { name: "Let's play" }).click();
			await expect(page.getByText('Pick a nickname first')).toBeVisible();

			await nick.pressSequentially('Ann');
			await expect(page.getByTestId('nickname-count')).toContainText('3/16');

			// Emoji with a skin tone is one character for the counter.
			await nick.fill('');
			await nick.pressSequentially('Hi 👍🏽');
			await expect(page.getByTestId('nickname-count')).toContainText('4/16');

			// Typing past 16 characters is cut at 16.
			await nick.fill('');
			await nick.pressSequentially('abcdefghijklmnopqrst');
			await expect(nick).toHaveValue('abcdefghijklmnop');
			await expect(page.getByTestId('nickname-count')).toContainText('16/16');
		} finally {
			await context.close();
			await game.cleanup();
		}
	});

	test('prefills the last nickname used on this phone', async ({ browser }) => {
		const game = await createLobbyGame();
		const { context, page } = await newPhone(browser);
		try {
			await page.goto('/');
			await page.evaluate(() => localStorage.setItem('cw:lastNickname', 'Kim'));
			await page.goto(`/join/${game.code}`);
			await hydrated(page);
			await expect(page.locator('#nickname')).toHaveValue('Kim');
		} finally {
			await context.close();
			await game.cleanup();
		}
	});

	test('a full game says so instead of showing the form', async ({ page }) => {
		const game = await createLobbyGame();
		try {
			const players = Array.from({ length: 40 }, (_, i) => ({
				game_id: game.id,
				nickname: `p${i}`,
				color: '#e6424a',
				token_hash: randomBytes(32).toString('hex')
			}));
			await db()`insert into player ${db()(players)}`;
			await page.goto(`/join/${game.code}`);
			await expect(page.locator('main')).toHaveAttribute('data-state', 'full');
			await expect(page.getByRole('heading', { name: 'This game is full' })).toBeVisible();
			await expect(page.locator('#nickname')).toHaveCount(0);
		} finally {
			await game.cleanup();
		}
	});

	test('joining goes to /play, remembers the phone, and rejects a taken nickname', async ({ browser }) => {
		const game = await createLobbyGame();
		const first = await newPhone(browser);
		const second = await newPhone(browser);
		try {
			const { page } = first;
			await page.goto(`/join/${game.code}`);
			await hydrated(page);
			await page.locator('#nickname').fill('Alice');
			await page.getByRole('button', { name: "Let's play" }).click();

			await expect(page).toHaveURL(new RegExp(`/play/${game.code}$`));
			const cookie = (await first.context.cookies()).find((c) => c.name.startsWith('cw_p_'));
			expect(cookie?.httpOnly).toBe(true);
			expect(await page.evaluate(() => localStorage.getItem('cw:lastNickname'))).toBe('Alice');

			// Scanning the QR code again on the same phone goes straight back to the game.
			await page.goto(`/join/${game.code}`);
			await expect(page).toHaveURL(new RegExp(`/play/${game.code}$`));

			// Another phone cannot take the same name (case-insensitive).
			const other = second.page;
			await other.goto(`/join/${game.code}`);
			await hydrated(other);
			await other.locator('#nickname').fill('alice');
			await other.getByRole('button', { name: "Let's play" }).click();
			await expect(other.locator('#nickname')).toHaveAttribute('aria-invalid', 'true');
			await expect(other).toHaveURL(new RegExp(`/join/${game.code}$`));
		} finally {
			await first.context.close();
			await second.context.close();
			await game.cleanup();
		}
	});
});

// --- Login -----------------------------------------------------------------------------------------

test.describe('login', () => {
	for (const [locale, label, button, wrong, show] of [
		['en-US', 'Admin password', 'Log in', 'Wrong password.', 'Show password'],
		['sv-SE', 'Adminlösenord', 'Logga in', 'Fel lösenord.', 'Visa lösenord']
	] as const) {
		test(`works in ${locale} and keeps ?next`, async ({ browser }) => {
			const { context, page } = await newPhone(browser, locale);
			await page.goto('/login?next=%2Fadmin');
			await hydrated(page);
			const password = page.getByLabel(label, { exact: true });
			await expect(password).toHaveAttribute('autocomplete', 'current-password');
			await expect(password).toHaveAttribute('type', 'password');

			await password.fill('definitely-wrong');
			await page.getByRole('button', { name: show }).click();
			await expect(password).toHaveAttribute('type', 'text');
			await page.getByRole('button', { name: button, exact: true }).click();
			await expect(page.getByText(wrong)).toBeVisible();

			await password.fill(process.env.ADMIN_PASSWORD!);
			await page.getByRole('button', { name: button, exact: true }).click();
			await expect(page).toHaveURL(/\/admin$/);
			await context.close();
		});
	}

	test('ignores off-site next and falls back to /host', async ({ page }) => {
		await page.goto('/login?next=%2F%2Fevil.example');
		await hydrated(page);
		await page.getByLabel('Admin password', { exact: true }).fill(process.env.ADMIN_PASSWORD!);
		await page.getByRole('button', { name: 'Log in', exact: true }).click();
		await expect(page).toHaveURL(/\/host$/);
	});
});
