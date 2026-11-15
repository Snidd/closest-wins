/**
 * Shared game contracts, importable from client and server.
 *
 * - The three role snapshots (`PlayerSnapshot`, `HostSnapshot`, `TvSnapshot`) are what the
 *   `query.live` streams in `#lib/remote/game.remote.ts` yield. They are built on the server by
 *   `#lib/server/game/views.ts`.
 * - Valibot schemas for every game command input. Remote modules cannot export schemas, so
 *   they live here (and can be reused for `form.preflight(...)`).
 *
 * THE ANSWER NEVER LEAVES THE SERVER BEFORE REVEAL. Target coordinates, name and fact exist
 * only in `RoundResult`, which only appears in the `reveal` and `standings` phase variants.
 * The `round` variant declares `result?: never`, so attaching a result there is a type error.
 * The clue photo's credit and source URL (which often name the place) likewise only exist in
 * `RoundResult.round.clue`; a running round's `ClueView` declares them `never`.
 *
 * Times are epoch milliseconds on the server clock. Every snapshot carries `serverNow`; clients
 * compute `offsetMs = serverNow - Date.now()` when a snapshot arrives (see `clockOffset` in
 * `#lib/game/clock.ts`) and render countdowns as `endsAt - (Date.now() + offsetMs)`.
 */
import * as v from 'valibot';
import type { Locale } from '#lib/i18n/locale.ts';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const GAME_PHASES = ['lobby', 'round', 'reveal', 'standings', 'finished'] as const;
/**
 * Phase flow (engine is authoritative):
 * - `lobby`     → `startRound` → `round` (first regular round)
 * - `round`     → timer hits zero, all eligible connected players locked in, or `endRoundNow` → `reveal`
 * - `reveal`    → `nextRound` → `standings` (`skipReveal` only fast-forwards the choreography)
 * - `standings` → `nextRound` → `round` (next regular or sudden-death round) or `finished`
 * - any         → `endGame` → `finished`
 */
export type GamePhase = (typeof GAME_PHASES)[number];

export const MAX_PLAYERS = 40;
export const NICKNAME_MAX_LENGTH = 16;
/** Unambiguous letters for join codes (no I, L, O). */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const JOIN_CODE_LENGTH = 4;
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const TIMER_MIN_SECONDS = 5;
export const TIMER_MAX_SECONDS = 600;
export const MAX_ROUNDS = 100;
/** Suggested suspense before the TV flies to the answer; `answerVisibleAt` derives from it. */
export const REVEAL_SUSPENSE_MS = 3000;

/** WebP variants stored for every photo, by longest-edge width in pixels. */
export const PHOTO_SIZES = { sm: 480, md: 1024, lg: 1920 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZES;

/** Public URL of a stored photo variant. Files live at `DATA_DIR/media/<fileKey>/<size>.webp`. */
export function photoUrl(fileKey: string, size: PhotoSize): string {
	return `/media/${fileKey}/${size}.webp`;
}

/**
 * Pixel width of a stored variant, from the largest variant's dimensions. Variants are resized
 * to a longest edge of `PHOTO_SIZES[size]` without enlarging, so a 1600×1000 upload has
 * `lg` = 1600 wide and a portrait's `sm` is narrower than 480.
 */
export function photoVariantWidth(photo: { width: number; height: number }, size: PhotoSize): number {
	const longest = Math.max(photo.width, photo.height);
	if (longest <= 0) return PHOTO_SIZES[size];
	return Math.max(1, Math.round((photo.width * Math.min(PHOTO_SIZES[size], longest)) / longest));
}

/**
 * `srcset` for a photo with the variants' real widths. Declaring the nominal sizes instead
 * (`1920w` for a 1600 px file) makes the browser under-report and upscale the image.
 */
export function photoSrcset(
	photo: { width: number; height: number; urls: Record<PhotoSize, string> },
	sizes: readonly PhotoSize[] = ['sm', 'md', 'lg']
): string {
	const seen = new Set<number>();
	const parts: string[] = [];
	for (const size of sizes) {
		const w = photoVariantWidth(photo, size);
		// Small originals make several variants identical; list each width once.
		if (seen.has(w)) continue;
		seen.add(w);
		parts.push(`${photo.urls[size]} ${w}w`);
	}
	return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** Epoch milliseconds, server clock. */
export type EpochMs = number;

/**
 * A clue photo as sent while a round runs: the image only. Its credit and source can name the
 * place ("Eiffel Tower by Jane Doe", `…/Sagrada_Familia.jpg`), so they are answer material and
 * arrive with the reveal (`RoundRef.clue`). The `never` fields make attaching them a type error.
 * Image URLs carry only the random `fileKey`.
 */
export interface CluePhotoView {
	/** Dimensions of the largest variant; use for aspect ratio. */
	width: number;
	height: number;
	urls: Record<PhotoSize, string>;
	attribution?: never;
	sourceUrl?: never;
}

/** Credit of a clue photo. Only sent once the round has ended. */
export interface PhotoCredit {
	attribution: string | null;
	sourceUrl: string | null;
}

/** A photo with its credit (revealed rounds). */
export type PhotoView = Omit<CluePhotoView, keyof PhotoCredit> & PhotoCredit;

/** A clue: optional photo and optional text (at least one is present). Both languages are sent;
 *  render with `localized(clue, 'text', locale)`. Never carries the photo credit. */
export interface ClueView {
	textSv: string | null;
	textEn: string | null;
	photo: CluePhotoView | null;
}

/** The clue of an ended round, now with the photo credit (show it with the answer). */
export interface RevealedClueView {
	textSv: string | null;
	textEn: string | null;
	photo: PhotoView | null;
}

/** Bilingual name (e.g. playlist name). Render with `localized(x, 'name', locale)`. */
export interface BilingualName {
	nameSv: string | null;
	nameEn: string | null;
}

export interface PlayerSummary {
	id: string;
	nickname: string;
	/** `#rrggbb` from `PLAYER_COLORS`. */
	color: string;
	/** Has at least one open live stream. Disconnected players are shown greyed out. */
	connected: boolean;
	/** Joined after the game started (informational; starts at 0 points). */
	lateJoiner: boolean;
}

export interface GameInfo {
	id: string;
	joinCode: string;
	/** Absolute URL players open to join, e.g. `https://host/join/ABCD` (for the QR code). */
	joinUrl: string;
	/** The big screen's language, chosen by the host. */
	language: Locale;
	playlistName: BilingualName;
	timerSeconds: number;
	/** Planned regular rounds (excludes sudden death). */
	totalRounds: number;
}

/** The round currently being played. Contains the clue but never the answer. */
export interface ActiveRound {
	/** 0-based index among all rounds of the game, including sudden-death rounds. */
	index: number;
	/** 1-based display number among regular rounds; for sudden death, 1-based SD round number. */
	number: number;
	isSuddenDeath: boolean;
	/**
	 * Players allowed to guess this round (non-kicked, in join order): in a regular round
	 * everyone who had joined when it started (a player joining mid-round watches it), in sudden
	 * death only the tied leaders. "N of M locked in" counts these players only.
	 */
	eligiblePlayerIds: string[];
	startedAt: EpochMs;
	endsAt: EpochMs;
	clue: ClueView;
}

/** A finished round as referenced by reveal/standings (same identity fields as `ActiveRound`). */
export type RoundRef = Omit<ActiveRound, 'startedAt' | 'endsAt' | 'clue'> & {
	startedAt: EpochMs;
	endedAt: EpochMs;
	/** Includes the photo credit; show it no earlier than the answer (`answerShownAt`). */
	clue: RevealedClueView;
};

/** The answer. Only ever present inside `RoundResult`. */
export interface RevealTarget {
	lat: number;
	lng: number;
	nameSv: string | null;
	nameEn: string | null;
	factSv: string | null;
	factEn: string | null;
}

export interface RevealGuess {
	playerId: string;
	lat: number;
	lng: number;
	distanceKm: number;
	/** 1-based, ties share a rank (1, 1, 3…). */
	rank: number;
	isWinner: boolean;
	/** Locked in explicitly (false: position under the cross when time ran out). */
	locked: boolean;
}

export interface RoundResult {
	round: RoundRef;
	target: RevealTarget;
	/** Counting guesses only, sorted by distance ascending. */
	guesses: RevealGuess[];
	/** Eligible players without a counting guess (never touched the map / not locked). */
	noGuessPlayerIds: string[];
	/** Closest player(s); several on an exact tie, empty if nobody guessed. */
	winnerPlayerIds: string[];
	revealStartedAt: EpochMs;
	/**
	 * End of the TV's suspense beat (all pins shown, no answer yet), or the skip time. The TV then
	 * flies to the answer and shows its name `REVEAL_FLY_MS` later: phones show the answer and
	 * their own result from `answerShownAt(result)` (`#lib/map/reveal.ts`), never earlier.
	 */
	answerVisibleAt: EpochMs;
	/** The host skipped the TV choreography. */
	skipped: boolean;
}

export interface StandingRow {
	playerId: string;
	nickname: string;
	color: string;
	connected: boolean;
	/** 1-based, ordered by roundsWon desc; equal roundsWon share a rank. */
	rank: number;
	roundsWon: number;
	/** Sum of distances over rounds with a counting guess (a stat, never decides the winner). */
	totalDistanceKm: number;
	/** Rounds in which the player had a counting guess. */
	guessedRounds: number;
}

/** What `nextRound` will do from the standings screen. */
export type NextStep =
	| { kind: 'round'; number: number }
	/** Tied leaders play an extra round; everyone else spectates. */
	| { kind: 'suddenDeath'; eligiblePlayerIds: string[] }
	/** Game over: one winner, or several on a shared win (library exhausted / ended early). */
	| { kind: 'finish'; winnerPlayerIds: string[] };

// ---------------------------------------------------------------------------------------------
// Phase states (shared by all roles)
// ---------------------------------------------------------------------------------------------

export interface LobbyState {
	phase: 'lobby';
	round?: never;
	result?: never;
}

export interface RoundState {
	phase: 'round';
	round: ActiveRound;
	/** Players who locked in this round. */
	lockedPlayerIds: string[];
	/** Type-level guard: the answer must not exist during a round. */
	result?: never;
}

export interface RevealState {
	phase: 'reveal';
	result: RoundResult;
	/** Standings including this round. */
	standings: StandingRow[];
	round?: never;
}

export interface StandingsState {
	phase: 'standings';
	/** The round that was just revealed. */
	result: RoundResult;
	standings: StandingRow[];
	next: NextStep;
	round?: never;
}

export interface FinishedState {
	phase: 'finished';
	standings: StandingRow[];
	/** One winner, several on a shared win, empty if nobody won a round. */
	winnerPlayerIds: string[];
	endedEarly: boolean;
	round?: never;
	result?: never;
}

export type PhaseState = LobbyState | RoundState | RevealState | StandingsState | FinishedState;

interface SnapshotCommon {
	/** Server clock when this snapshot was built. */
	serverNow: EpochMs;
	game: GameInfo;
	/** Non-kicked players in join order. */
	players: PlayerSummary[];
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

export interface PlayerSelf {
	id: string;
	nickname: string;
	color: string;
}

/** The player's own cross for the current round, to restore state after a refresh. */
export interface OwnGuess {
	lat: number;
	lng: number;
	touched: boolean;
	lockedAt: EpochMs | null;
}

/** The player's own outcome; show it once `serverNow + offset >= answerShownAt(result)`. */
export interface OwnResult {
	distanceKm: number | null;
	rank: number | null;
	won: boolean;
}

export type PlayerPhase =
	| LobbyState
	| (RoundState & {
			/** False when spectating (sudden death between others) or joined mid-round. */
			canGuess: boolean;
			myGuess: OwnGuess | null;
	  })
	| (RevealState & { myResult: OwnResult | null })
	| (StandingsState & { myResult: OwnResult | null })
	| FinishedState;

export type PlayerSnapshot = SnapshotCommon & {
	role: 'player';
	status: 'playing';
	me: PlayerSelf;
} & PlayerPhase;

/** What `playerState(code)` yields when the caller is not (or no longer) a player. */
export type PlayerGate =
	/** No unfinished game with this code. */
	| { role: 'player'; status: 'noGame' }
	/** No valid player token for this game: send to `/join/[code]`. */
	| { role: 'player'; status: 'notJoined'; joinable: boolean }
	| { role: 'player'; status: 'kicked' };

/** Value type of the `playerState(code)` live query. */
export type PlayerStateValue = PlayerSnapshot | PlayerGate;

// ---------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------

export interface HostTvStatus {
	paired: boolean;
	/** A paired TV has an open live stream. */
	connected: boolean;
}

export type HostSnapshot = SnapshotCommon & {
	role: 'host';
	tv: HostTvStatus;
	/** Number of regular rounds already started. */
	roundsPlayed: number;
} & PhaseState;

// ---------------------------------------------------------------------------------------------
// TV
// ---------------------------------------------------------------------------------------------

export type TvSnapshot = SnapshotCommon & {
	role: 'tv';
	status: 'paired';
	/**
	 * Only once the game is `finished`: the code that pairs this screen with the host's next
	 * game (show it small next to the final standings). Pairing moves the stream to the new
	 * game without a reconnect.
	 */
	nextPairing?: { pairingCode: string; codeExpiresAt: EpochMs };
} & PhaseState;

/** What `tvState()` yields when the screen is not paired with a game. */
export type TvGate =
	/** No TV cookie yet: call `registerTv()` (it sets the cookie), then the stream reconnects. */
	| { role: 'tv'; status: 'unregistered' }
	| {
			role: 'tv';
			status: 'pairing';
			serverNow: EpochMs;
			pairingCode: string;
			codeExpiresAt: EpochMs;
	  };

/** Value type of the `tvState()` live query. */
export type TvStateValue = TvSnapshot | TvGate;

// ---------------------------------------------------------------------------------------------
// Command input schemas
// ---------------------------------------------------------------------------------------------

const joinCodeRegex = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** Accepts any case and surrounding whitespace, outputs the canonical upper-case code. */
export const JoinCodeSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toUpperCase(),
	v.regex(joinCodeRegex, 'Invalid game code')
);

export const UuidSchema = v.pipe(v.string(), v.uuid());

export const NicknameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'Nickname is required'),
	v.maxGraphemes(NICKNAME_MAX_LENGTH, `At most ${NICKNAME_MAX_LENGTH} characters`),
	// Grapheme count is what users see; also cap UTF-16 length (emoji sequences are long).
	v.maxLength(64, `At most ${NICKNAME_MAX_LENGTH} characters`),
	// No control characters, line/paragraph separators or bidi overrides (emoji ZWJ is fine).
	v.regex(/^[^\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]+$/u, 'Invalid characters')
);

export const LatSchema = v.pipe(v.number(), v.finite(), v.minValue(-90), v.maxValue(90));
/** MapLibre may report wrapped longitudes; the server normalises with `normalizeLng`. */
export const LngSchema = v.pipe(v.number(), v.finite(), v.minValue(-1080), v.maxValue(1080));

export const LocaleSchema = v.picklist(['sv', 'en']);

/** `playerState(code)` argument. */
export const PlayerStateArgSchema = JoinCodeSchema;
/** `hostState(gameId)` argument. */
export const HostStateArgSchema = UuidSchema;

/** `joinGame`. Sets the player cookie. Fields are form-compatible. */
export const JoinGameSchema = v.object({
	code: JoinCodeSchema,
	nickname: NicknameSchema
});

/** Shared by `updateGuess` (debounced while panning) and `lockIn` (final position). */
const GuessFields = {
	gameId: UuidSchema,
	/** `ActiveRound.index` the client is guessing for; stale updates are rejected. */
	roundIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
	lat: LatSchema,
	lng: LngSchema,
	/** The player panned or zoomed at least once this round. */
	touched: v.boolean()
};

export const UpdateGuessSchema = v.object(GuessFields);
export const LockInSchema = v.object(GuessFields);

/** `createGame` (admin). Booleans are optional so the schema also works for a remote `form`. */
export const CreateGameSchema = v.object({
	playlistId: UuidSchema,
	roundCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_ROUNDS)),
	/** Take the first N locations of the playlist, or N random ones. */
	selection: v.picklist(['first', 'random']),
	shuffle: v.optional(v.boolean(), false),
	timerSeconds: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(TIMER_MIN_SECONDS),
		v.maxValue(TIMER_MAX_SECONDS)
	),
	language: LocaleSchema
});

/** `pairTv` (admin): attach the TV showing `pairingCode` to the game. */
export const PairTvSchema = v.object({
	gameId: UuidSchema,
	pairingCode: v.pipe(v.string(), v.trim(), v.regex(/^[0-9]{6}$/, 'Enter the 6-digit code'))
});

/**
 * The state the host was looking at when it sent a command that moves the game on. The engine
 * acts only if the game is still in exactly this state and otherwise ignores the command (a
 * successful no-op), so a second host tab or device, or a retried request, can never advance
 * twice (e.g. skip the standings, or end the next round). Build it with `expectedStateOf`.
 */
export const ExpectedStateSchema = v.object({
	phase: v.picklist(GAME_PHASES),
	/** The round on screen: `round.index` in `round`, `result.round.index` in `reveal` /
	 *  `standings`; null in `lobby` / `finished` (not compared there). */
	roundIndex: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))
});
export type ExpectedState = v.InferOutput<typeof ExpectedStateSchema>;

/** The `ExpectedState` of a snapshot (what a command sent from it expects). */
export function expectedStateOf(s: PhaseState): ExpectedState {
	switch (s.phase) {
		case 'round':
			return { phase: s.phase, roundIndex: s.round.index };
		case 'reveal':
		case 'standings':
			return { phase: s.phase, roundIndex: s.result.round.index };
		default:
			return { phase: s.phase, roundIndex: null };
	}
}

/** `endGame` (admin): any phase → `finished`, idempotent. */
export const GameIdSchema = v.object({ gameId: UuidSchema });
/** `startRound`, `endRoundNow`, `skipReveal`, `nextRound` (admin): carry the state they expect. */
export const AdvanceGameSchema = v.object({ gameId: UuidSchema, expected: ExpectedStateSchema });
export const StartRoundSchema = AdvanceGameSchema;
export const EndRoundNowSchema = AdvanceGameSchema;
export const SkipRevealSchema = AdvanceGameSchema;
export const NextRoundSchema = AdvanceGameSchema;
export const EndGameSchema = GameIdSchema;

/** `kickPlayer` (admin). */
export const KickPlayerSchema = v.object({ gameId: UuidSchema, playerId: UuidSchema });

export type JoinGameInput = v.InferOutput<typeof JoinGameSchema>;
export type UpdateGuessInput = v.InferOutput<typeof UpdateGuessSchema>;
export type LockInInput = v.InferOutput<typeof LockInSchema>;
export type CreateGameInput = v.InferOutput<typeof CreateGameSchema>;
export type PairTvInput = v.InferOutput<typeof PairTvSchema>;
export type GameIdInput = v.InferOutput<typeof GameIdSchema>;
export type AdvanceGameInput = v.InferOutput<typeof AdvanceGameSchema>;
export type KickPlayerInput = v.InferOutput<typeof KickPlayerSchema>;

// ---------------------------------------------------------------------------------------------
// Command results
// ---------------------------------------------------------------------------------------------

export interface JoinGameResult {
	gameId: string;
	playerId: string;
	joinCode: string;
}

export interface CreateGameResult {
	gameId: string;
	joinCode: string;
}

export interface RegisterTvResult {
	tvId: string;
}

// ---------------------------------------------------------------------------------------------
// Game history (admin)
// ---------------------------------------------------------------------------------------------

export interface GameHistoryItem {
	id: string;
	joinCode: string;
	phase: GamePhase;
	playlistName: BilingualName | null;
	language: Locale;
	createdAt: EpochMs;
	finishedAt: EpochMs | null;
	playerCount: number;
	roundsPlayed: number;
	winners: Array<{ playerId: string; nickname: string; color: string }>;
	endedEarly: boolean;
}

export interface GameHistoryRound {
	index: number;
	isSuddenDeath: boolean;
	target: RevealTarget;
	winnerPlayerIds: string[];
	guesses: Array<{ playerId: string; distanceKm: number | null; locked: boolean }>;
}

export interface GameHistoryDetail extends GameHistoryItem {
	standings: StandingRow[];
	rounds: GameHistoryRound[];
}

/** `listGames` argument (admin). */
export const ListGamesSchema = v.object({
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
	offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0)
});
export type ListGamesInput = v.InferOutput<typeof ListGamesSchema>;
