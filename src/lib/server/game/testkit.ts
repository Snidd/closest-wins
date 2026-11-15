/**
 * Test helpers for the engine suites (imported only by *.test.ts). Creates its own uniquely
 * named locations/playlist in the shared dev database and removes exactly what it created.
 * Fake clock + timers are injected through `setEngineDeps`, so nothing sleeps.
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { game, location, playlist, playlistItem, tvScreen } from '#lib/server/db/schema.ts';
import { setEngineDeps } from './deps.ts';
import { resetEngineMemory } from './engine.ts';

export interface FixtureLocation {
	id: string;
	lat: number;
	lng: number;
	name: string;
	fact: string;
	clue: string;
}

export class FakeTimers {
	now = Date.now();
	private seq = 0;
	timers = new Map<number, { at: number; fn: () => void | Promise<void> }>();

	setTimer = (fn: () => void | Promise<void>, ms: number) => {
		const id = ++this.seq;
		this.timers.set(id, { at: this.now + Math.max(0, ms), fn });
		return id;
	};
	clearTimer = (handle: unknown) => {
		this.timers.delete(handle as number);
	};

	/** Moves the clock forward, running (and awaiting) every timer that comes due, in order. */
	async advance(ms: number): Promise<void> {
		const target = this.now + ms;
		for (;;) {
			const due = [...this.timers.entries()]
				.filter(([, t]) => t.at <= target)
				.sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
			if (!due) break;
			this.timers.delete(due[0]);
			this.now = Math.max(this.now, due[1].at);
			await due[1].fn();
		}
		this.now = target;
	}
}

export interface Fixture {
	tag: string;
	locations: FixtureLocation[];
	playlistId: string;
	clock: FakeTimers;
	/** Location ids the sudden-death pool is limited to (default: all fixture locations). */
	library: string[];
	gameIds: string[];
	tvIds: string[];
	restore: () => void;
	cleanup: () => Promise<void>;
}

/** Distinctive coordinates/strings so leak assertions cannot match by accident. */
export async function createFixture(count = 6): Promise<Fixture> {
	const tag = `t${randomUUID().slice(0, 8)}`;
	const locations: FixtureLocation[] = [];
	for (let i = 0; i < count; i++) {
		const lat = Number((10 + i * 7 + 0.123457).toFixed(6));
		const lng = Number((20 + i * 11 + 0.654321).toFixed(6));
		const name = `Zqx${tag}Place${i}`;
		const fact = `Fact${tag}Secret${i}`;
		const clue = `Clue ${tag} number ${i}`;
		const [row] = await db
			.insert(location)
			.values({ nameEn: name, nameSv: `${name}Sv`, factEn: fact, factSv: `${fact}Sv`, clueTextEn: clue, lat, lng })
			.returning({ id: location.id });
		locations.push({ id: row!.id, lat, lng, name, fact, clue });
	}
	const [pl] = await db
		.insert(playlist)
		.values({ nameEn: `Engine test ${tag}`, defaultTimerSeconds: 30 })
		.returning({ id: playlist.id });
	await db
		.insert(playlistItem)
		.values(locations.map((l, position) => ({ playlistId: pl!.id, locationId: l.id, position })));

	const clock = new FakeTimers();
	const fx: Fixture = {
		tag,
		locations,
		playlistId: pl!.id,
		clock,
		library: locations.map((l) => l.id),
		gameIds: [],
		tvIds: [],
		restore: () => {},
		cleanup: async () => {
			resetEngineMemory();
			fx.restore();
			if (fx.tvIds.length) await db.delete(tvScreen).where(inArray(tvScreen.id, fx.tvIds));
			const games = await db.select({ id: game.id }).from(game).where(eq(game.playlistId, pl!.id));
			const ids = [...new Set([...fx.gameIds, ...games.map((g) => g.id)])];
			if (ids.length) await db.delete(game).where(inArray(game.id, ids));
			await db.delete(playlist).where(eq(playlist.id, pl!.id));
			await db.delete(location).where(
				inArray(
					location.id,
					locations.map((l) => l.id)
				)
			);
		}
	};
	fx.restore = setEngineDeps({
		now: () => clock.now,
		setTimer: clock.setTimer,
		clearTimer: clock.clearTimer,
		random: () => 0.42,
		libraryLocationIds: async () => [...fx.library]
	});
	return fx;
}
