/**
 * Database schema. Postgres is the source of truth for content and for every running game.
 *
 * Conventions:
 * - UUID primary keys (`gen_random_uuid()`), timestamps are `timestamptz`.
 * - Bilingual text is stored as `<field>_sv` / `<field>_en` columns (camelCase `<field>Sv` /
 *   `<field>En` in TypeScript) so that `localized(row, field, locale)` works on rows directly.
 * - Enumerations are `text` columns guarded by CHECK constraints (easier to evolve than pg enums).
 *
 * Changing this file requires `pnpm db:generate` (commit the migration) and `pnpm db:migrate`.
 * This file must stay importable from plain Node (the seed script): no `$app/*` or `#lib` imports.
 */
import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	check,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

/** SQL helper: column is not null and not blank. */
const filled = (column: string) => sql.raw(`(${column} IS NOT NULL AND btrim(${column}) <> '')`);

// ---------------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------------

/**
 * An imported/uploaded photo. Files live at `DATA_DIR/media/<fileKey>/<size>.webp` (see
 * `PHOTO_SIZES` in `#lib/game/types.ts`). `fileKey` is random and never derived from the answer.
 */
export const photo = pgTable(
	'photo',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		fileKey: text('file_key').notNull(),
		/** Dimensions of the largest stored variant. */
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		/** Where the image came from (page or file URL); null for direct uploads without a source. */
		sourceUrl: text('source_url'),
		/** Credit line shown with the photo, e.g. "Jane Doe / CC BY-SA 4.0". */
		attribution: text('attribution'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('photo_file_key_uq').on(t.fileKey),
		check('photo_dimensions_ck', sql`${t.width} > 0 AND ${t.height} > 0`)
	]
);

export const location = pgTable(
	'location',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		nameSv: text('name_sv'),
		nameEn: text('name_en'),
		clueTextSv: text('clue_text_sv'),
		clueTextEn: text('clue_text_en'),
		factSv: text('fact_sv'),
		factEn: text('fact_en'),
		lat: doublePrecision('lat').notNull(),
		lng: doublePrecision('lng').notNull(),
		photoId: uuid('photo_id').references(() => photo.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('location_photo_idx').on(t.photoId),
		index('location_updated_at_idx').on(t.updatedAt),
		check('location_name_ck', sql`${filled('name_sv')} OR ${filled('name_en')}`),
		check(
			'location_clue_ck',
			sql`${t.photoId} IS NOT NULL OR ${filled('clue_text_sv')} OR ${filled('clue_text_en')}`
		),
		check('location_lat_ck', sql`${t.lat} BETWEEN -90 AND 90`),
		check('location_lng_ck', sql`${t.lng} BETWEEN -180 AND 180`)
	]
);

export const playlist = pgTable(
	'playlist',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		nameSv: text('name_sv'),
		nameEn: text('name_en'),
		defaultTimerSeconds: integer('default_timer_seconds').notNull().default(30),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('playlist_name_ck', sql`${filled('name_sv')} OR ${filled('name_en')}`),
		check('playlist_timer_ck', sql`${t.defaultTimerSeconds} BETWEEN 5 AND 600`)
	]
);

/** Ordered membership of a location in a playlist. A location appears at most once per playlist. */
export const playlistItem = pgTable(
	'playlist_item',
	{
		playlistId: uuid('playlist_id')
			.notNull()
			.references(() => playlist.id, { onDelete: 'cascade' }),
		locationId: uuid('location_id')
			.notNull()
			.references(() => location.id, { onDelete: 'cascade' }),
		/** 0-based order within the playlist. Rewrite all positions when reordering. */
		position: integer('position').notNull()
	},
	(t) => [
		primaryKey({ name: 'playlist_item_pk', columns: [t.playlistId, t.locationId] }),
		uniqueIndex('playlist_item_position_uq').on(t.playlistId, t.position),
		index('playlist_item_location_idx').on(t.locationId),
		check('playlist_item_position_ck', sql`${t.position} >= 0`)
	]
);

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

export const GAME_PHASE_VALUES = ['lobby', 'round', 'reveal', 'standings', 'finished'] as const;
export const LANGUAGE_VALUES = ['sv', 'en'] as const;
export const ROUND_SELECTION_VALUES = ['first', 'random'] as const;

export const game = pgTable(
	'game',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** 4 letters from `JOIN_CODE_ALPHABET`; unique among games that are not finished. */
		joinCode: text('join_code').notNull(),
		/** Null if the playlist was deleted later; the rounds still reference their locations. */
		playlistId: uuid('playlist_id').references(() => playlist.id, { onDelete: 'set null' }),
		/** Language of the big screen. */
		language: text('language').$type<(typeof LANGUAGE_VALUES)[number]>().notNull(),
		timerSeconds: integer('timer_seconds').notNull(),
		/** Number of regular (non sudden-death) rounds planned at creation. */
		roundCount: integer('round_count').notNull(),
		selection: text('selection').$type<(typeof ROUND_SELECTION_VALUES)[number]>().notNull(),
		shuffle: boolean('shuffle').notNull().default(false),
		phase: text('phase')
			.$type<(typeof GAME_PHASE_VALUES)[number]>()
			.notNull()
			.default('lobby'),
		/** Index (into `game_round.index`) of the current / most recent round; null in the lobby. */
		currentRound: integer('current_round'),
		/** When the reveal of the current round started (server clock). Null outside reveal. */
		revealStartedAt: timestamp('reveal_started_at', { withTimezone: true }),
		/** When the host skipped the reveal choreography, if they did. */
		revealSkippedAt: timestamp('reveal_skipped_at', { withTimezone: true }),
		/** Final winners (several on a shared win). Empty until finished. */
		winnerPlayerIds: uuid('winner_player_ids')
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		/** True when the host ended the game before all rounds were played. */
		endedEarly: boolean('ended_early').notNull().default(false),
		createdAt: createdAt(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('game_join_code_active_uq')
			.on(t.joinCode)
			.where(sql`${t.phase} <> 'finished'`),
		index('game_join_code_idx').on(t.joinCode),
		index('game_phase_idx').on(t.phase),
		index('game_created_at_idx').on(t.createdAt),
		check('game_join_code_ck', sql`${t.joinCode} ~ '^[A-Z]{4}$'`),
		check('game_language_ck', sql`${t.language} IN ('sv', 'en')`),
		check('game_selection_ck', sql`${t.selection} IN ('first', 'random')`),
		check(
			'game_phase_ck',
			sql`${t.phase} IN ('lobby', 'round', 'reveal', 'standings', 'finished')`
		),
		check('game_timer_ck', sql`${t.timerSeconds} BETWEEN 5 AND 600`),
		check('game_round_count_ck', sql`${t.roundCount} >= 1`)
	]
);

/**
 * One round of a game. Regular rounds may be created up front (with `startedAt` null) when the
 * game is created; sudden-death rounds are appended as needed.
 */
export const gameRound = pgTable(
	'game_round',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		gameId: uuid('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		/** 0-based order within the game, including sudden-death rounds. */
		index: integer('index').notNull(),
		/** Restrict: played locations are part of the game history. */
		locationId: uuid('location_id')
			.notNull()
			.references(() => location.id, { onDelete: 'restrict' }),
		isSuddenDeath: boolean('is_sudden_death').notNull().default(false),
		/** Players allowed to guess (sudden death). Null means every non-kicked player. */
		eligiblePlayerIds: uuid('eligible_player_ids').array(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		/** Server-authoritative deadline. */
		endsAt: timestamp('ends_at', { withTimezone: true }),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		/** Closest player(s); several on an exact tie, empty when nobody guessed. */
		winnerPlayerIds: uuid('winner_player_ids')
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`)
	},
	(t) => [
		uniqueIndex('game_round_game_index_uq').on(t.gameId, t.index),
		index('game_round_location_idx').on(t.locationId),
		// Fast lookup of rounds that are running (timer re-arming at boot).
		index('game_round_active_idx')
			.on(t.endsAt)
			.where(sql`${t.startedAt} IS NOT NULL AND ${t.endedAt} IS NULL`),
		check('game_round_index_ck', sql`${t.index} >= 0`)
	]
);

export const player = pgTable(
	'player',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		gameId: uuid('game_id')
			.notNull()
			.references(() => game.id, { onDelete: 'cascade' }),
		/** Trimmed, 1–16 graphemes (validated by NicknameSchema). Unique per game, case-insensitively. */
		nickname: text('nickname').notNull(),
		/** Pin colour as `#rrggbb`, taken from `PLAYER_COLORS`. */
		color: text('color').notNull(),
		/** SHA-256 (hex) of the reconnect token. The token itself only lives on the phone. */
		tokenHash: text('token_hash').notNull(),
		kicked: boolean('kicked').notNull().default(false),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('player_game_nickname_uq').on(t.gameId, sql`lower(${t.nickname})`),
		uniqueIndex('player_token_hash_uq').on(t.tokenHash),
		// Code points, not graphemes: emoji sequences are long, so this is only a sanity bound.
		check('player_nickname_ck', sql`char_length(${t.nickname}) BETWEEN 1 AND 64`),
		check('player_color_ck', sql`${t.color} ~ '^#[0-9a-f]{6}$'`)
	]
);

/**
 * A player's cross for a round. Upserted while the player pans (debounced), frozen at lock-in.
 * `distanceKm` is filled in when the round ends. A guess only counts if `lockedAt` is set or
 * `touched` is true.
 */
export const guess = pgTable(
	'guess',
	{
		roundId: uuid('round_id')
			.notNull()
			.references(() => gameRound.id, { onDelete: 'cascade' }),
		playerId: uuid('player_id')
			.notNull()
			.references(() => player.id, { onDelete: 'cascade' }),
		lat: doublePrecision('lat').notNull(),
		lng: doublePrecision('lng').notNull(),
		/** The player panned or zoomed at least once this round. */
		touched: boolean('touched').notNull().default(false),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		distanceKm: doublePrecision('distance_km'),
		updatedAt: updatedAt()
	},
	(t) => [
		primaryKey({ name: 'guess_pk', columns: [t.roundId, t.playerId] }),
		index('guess_player_idx').on(t.playerId),
		check('guess_lat_ck', sql`${t.lat} BETWEEN -90 AND 90`),
		check('guess_lng_ck', sql`${t.lng} BETWEEN -180 AND 180`),
		check('guess_distance_ck', sql`${t.distanceKm} IS NULL OR ${t.distanceKm} >= 0`)
	]
);

/** A big screen. Shows a pairing code until the host pairs it with a game. */
export const tvScreen = pgTable(
	'tv_screen',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** SHA-256 (hex) of the TV's token (kept in a cookie on the TV). */
		tokenHash: text('token_hash').notNull(),
		/** 6 digits; rotated every 10 minutes until paired. */
		pairingCode: text('pairing_code'),
		codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
		gameId: uuid('game_id').references(() => game.id, { onDelete: 'set null' }),
		pairedAt: timestamp('paired_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('tv_screen_token_hash_uq').on(t.tokenHash),
		uniqueIndex('tv_screen_pairing_code_uq')
			.on(t.pairingCode)
			.where(sql`${t.pairingCode} IS NOT NULL`),
		index('tv_screen_game_idx').on(t.gameId),
		check('tv_screen_pairing_code_ck', sql`${t.pairingCode} IS NULL OR ${t.pairingCode} ~ '^[0-9]{6}$'`)
	]
);

// ---------------------------------------------------------------------------------------------
// Relations (for `db.query.*`)
// ---------------------------------------------------------------------------------------------

export const photoRelations = relations(photo, ({ many }) => ({ locations: many(location) }));

export const locationRelations = relations(location, ({ one, many }) => ({
	photo: one(photo, { fields: [location.photoId], references: [photo.id] }),
	playlistItems: many(playlistItem)
}));

export const playlistRelations = relations(playlist, ({ many }) => ({
	items: many(playlistItem),
	games: many(game)
}));

export const playlistItemRelations = relations(playlistItem, ({ one }) => ({
	playlist: one(playlist, { fields: [playlistItem.playlistId], references: [playlist.id] }),
	location: one(location, { fields: [playlistItem.locationId], references: [location.id] })
}));

export const gameRelations = relations(game, ({ one, many }) => ({
	playlist: one(playlist, { fields: [game.playlistId], references: [playlist.id] }),
	rounds: many(gameRound),
	players: many(player),
	tvScreens: many(tvScreen)
}));

export const gameRoundRelations = relations(gameRound, ({ one, many }) => ({
	game: one(game, { fields: [gameRound.gameId], references: [game.id] }),
	location: one(location, { fields: [gameRound.locationId], references: [location.id] }),
	guesses: many(guess)
}));

export const playerRelations = relations(player, ({ one, many }) => ({
	game: one(game, { fields: [player.gameId], references: [game.id] }),
	guesses: many(guess)
}));

export const guessRelations = relations(guess, ({ one }) => ({
	round: one(gameRound, { fields: [guess.roundId], references: [gameRound.id] }),
	player: one(player, { fields: [guess.playerId], references: [player.id] })
}));

export const tvScreenRelations = relations(tvScreen, ({ one }) => ({
	game: one(game, { fields: [tvScreen.gameId], references: [game.id] })
}));

// ---------------------------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------------------------

export type Photo = typeof photo.$inferSelect;
export type NewPhoto = typeof photo.$inferInsert;
export type Location = typeof location.$inferSelect;
export type NewLocation = typeof location.$inferInsert;
export type Playlist = typeof playlist.$inferSelect;
export type NewPlaylist = typeof playlist.$inferInsert;
export type PlaylistItem = typeof playlistItem.$inferSelect;
export type NewPlaylistItem = typeof playlistItem.$inferInsert;
export type Game = typeof game.$inferSelect;
export type NewGame = typeof game.$inferInsert;
export type GameRound = typeof gameRound.$inferSelect;
export type NewGameRound = typeof gameRound.$inferInsert;
export type Player = typeof player.$inferSelect;
export type NewPlayer = typeof player.$inferInsert;
export type Guess = typeof guess.$inferSelect;
export type NewGuess = typeof guess.$inferInsert;
export type TvScreen = typeof tvScreen.$inferSelect;
export type NewTvScreen = typeof tvScreen.$inferInsert;
