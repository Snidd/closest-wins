/**
 * Direct Postgres access for tests: fixtures the UI cannot create quickly, reads that prove
 * what the engine did (and the answer of a running round, which the UIs must never see), and
 * cleanup of exactly the rows a test created. Other tests share the database: never truncate,
 * never assert on global counts.
 */
import postgres from 'postgres';

let sql: postgres.Sql | null = null;
export const db = () => (sql ??= postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} }));
export async function closeDb() {
	await sql?.end();
	sql = null;
}

/** Seeded locations (scripts/seed-data.ts), fixed ids. */
export const SEED = {
	eiffel: 'c0ffee00-0000-4000-8000-000000000001',
	liberty: 'c0ffee00-0000-4000-8000-000000000002',
	sydney: 'c0ffee00-0000-4000-8000-000000000003',
	giza: 'c0ffee00-0000-4000-8000-000000000004',
	machuPicchu: 'c0ffee00-0000-4000-8000-000000000005'
} as const;

/** Seeded playlist (`pnpm seed`): 8 locations, default timer 30 s. */
export const LANDMARKS = { id: 'c0ffee00-0000-4000-9000-000000000001', en: 'Famous landmarks', sv: 'Kända landmärken', size: 8 };

export interface LocationRow {
	id: string;
	nameSv: string | null;
	nameEn: string | null;
	factSv: string | null;
	factEn: string | null;
	clueTextSv: string | null;
	clueTextEn: string | null;
	lat: number;
	lng: number;
}

export async function loadLocation(id: string): Promise<LocationRow> {
	const [row] = await db()<LocationRow[]>`
		select id, name_sv as "nameSv", name_en as "nameEn", fact_sv as "factSv", fact_en as "factEn",
			clue_text_sv as "clueTextSv", clue_text_en as "clueTextEn", lat, lng
		from location where id = ${id}`;
	if (!row) throw new Error(`location ${id} not found (run pnpm seed)`);
	return row;
}

/** Phase and settings of a game straight from the database (what the engine did, not the UI). */
export async function dbGame(gameId: string) {
	const [row] = await db()`
		select phase, round_count, selection, shuffle, timer_seconds, language, current_round,
			(select count(*)::int from game_round r where r.game_id = g.id and r.started_at is not null) as started
		from game g where id = ${gameId}`;
	return row as {
		phase: string;
		round_count: number;
		selection: string;
		shuffle: boolean;
		timer_seconds: number;
		language: string;
		current_round: number | null;
		started: number;
	};
}

export async function playerIdByNickname(gameId: string, nickname: string): Promise<string> {
	const [p] = await db()<{ id: string }[]>`select id from player where game_id = ${gameId} and nickname = ${nickname}`;
	if (!p) throw new Error(`No player ${nickname}`);
	return p.id;
}

export async function currentRoundIndex(gameId: string): Promise<number> {
	const [g] = await db()<{ current_round: number | null }[]>`select current_round from game where id = ${gameId}`;
	if (g?.current_round == null) throw new Error('No current round');
	return g.current_round;
}

/** The answer of the game's current round (test-side only). */
export async function currentTarget(gameId: string): Promise<LocationRow> {
	const [row] = await db()<{ locationId: string }[]>`
		select r.location_id as "locationId" from game_round r join game g on g.id = r.game_id
		where g.id = ${gameId} and r.index = g.current_round`;
	if (!row) throw new Error('No current round');
	return loadLocation(row.locationId);
}

/** The player's guess in the game's current round, if any. */
export async function currentGuess(gameId: string, playerId: string) {
	const [g] = await db()<{ lat: number; lng: number; touched: boolean; locked_at: Date | null; distance_km: number | null }[]>`
		select g.lat, g.lng, g.touched, g.locked_at, g.distance_km
		from guess g join game_round r on r.id = g.round_id join game on game.id = r.game_id
		where game.id = ${gameId} and r.index = game.current_round and g.player_id = ${playerId}`;
	return g ?? null;
}

export async function deleteGames(ids: Iterable<string>) {
	const list = [...ids];
	if (list.length) await db()`delete from game where id = any(${list}::uuid[])`;
}

export async function deleteTvs(ids: Iterable<string>) {
	const list = [...ids];
	if (list.length) await db()`delete from tv_screen where id = any(${list}::uuid[])`;
}
