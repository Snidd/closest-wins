/**
 * Needs the dev database (`docker compose up -d db && pnpm db:migrate`). Everything runs in a
 * transaction that is rolled back.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { client, db } from './index.ts';
import { location, playlist } from './schema.ts';

class Rollback extends Error {}

async function inRollback(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) {
	await db
		.transaction(async (tx) => {
			await fn(tx);
			throw new Rollback();
		})
		.catch((e) => {
			if (!(e instanceof Rollback)) throw e;
		});
}

/** postgres.js error code of a failed drizzle query (drizzle wraps it in `cause`). */
const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

afterAll(async () => {
	await client.end();
});

describe('schema constraints', () => {
	it('accepts a valid location and enforces its CHECKs', async () => {
		await inRollback(async (tx) => {
			const [row] = await tx
				.insert(location)
				.values({ nameEn: 'Test', clueTextEn: 'A clue', lat: 1, lng: 2 })
				.returning();
			expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(row!.createdAt).toBeInstanceOf(Date);

			const noName = tx.insert(location).values({ nameSv: '  ', clueTextEn: 'x', lat: 0, lng: 0 });
			await expect(noName).rejects.toSatisfy((e) => pgCode(e) === '23514');
		});
		await inRollback(async (tx) => {
			const noClue = tx.insert(location).values({ nameEn: 'X', lat: 0, lng: 0 });
			await expect(noClue).rejects.toSatisfy((e) => pgCode(e) === '23514');
		});
		await inRollback(async (tx) => {
			const badLat = tx.insert(location).values({ nameEn: 'X', clueTextEn: 'x', lat: 91, lng: 0 });
			await expect(badLat).rejects.toSatisfy((e) => pgCode(e) === '23514');
		});
	});

	it('enforces the playlist timer range', async () => {
		await inRollback(async (tx) => {
			const bad = tx.insert(playlist).values({ nameEn: 'P', defaultTimerSeconds: 1 });
			await expect(bad).rejects.toSatisfy((e) => pgCode(e) === '23514');
		});
	});
});
