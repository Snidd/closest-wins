/**
 * Builds the role snapshots streamed to clients.
 *
 * THE ANSWER NEVER LEAVES THE SERVER BEFORE REVEAL: target lat/lng, name and fact are only read
 * (`targets` in library.ts) into a `RoundResult`, which only exists in the `reveal` /
 * `standings` variants (so does the clue photo's credit, `revealedClues`). While a round runs,
 * nothing here selects those columns, and other players' guess coordinates are not read either
 * (only the caller's own cross and the list of who has locked in).
 *
 * The role-independent part of a game's state is built once per change (`gameVersion`) and
 * shared by every stream of that game; the per-player parts (who the caller is, own guess, own
 * result) are picked from it per snapshot without further queries. The model holds every
 * player's cross of the running round server-side; a snapshot only ever takes the caller's own.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { ORIGIN } from '$app/env/private';
import { revealSchedule } from '#lib/game/reveal.ts';
import { db, type Executor } from '#lib/server/db/index.ts';
import { game, guess, tvScreen, type Game, type GameRound, type Player, type TvScreen } from '#lib/server/db/schema.ts';
import {
	MAX_PLAYERS,
	type ActiveRound,
	type BilingualName,
	type GameInfo,
	type HostSnapshot,
	type HostTvStatus,
	type OwnGuess,
	type OwnResult,
	type PhaseState,
	type PlayerGate,
	type PlayerStateValue,
	type PlayerSummary,
	type RevealGuess,
	type RoundResult,
	type StandingRow,
	type TvGate,
	type TvSnapshot,
	type TvStateValue
} from '#lib/game/types.ts';
import { gameVersion, subscriberCount } from './events.ts';
import { connectedPlayerIds, isPresent } from './presence.ts';
import { deps } from './deps.ts';
import { clues, playlistNames, revealedClues, targets } from './library.ts';
import {
	activePlayers,
	currentRoundOf,
	eligibleIds,
	isEligible,
	loadPlayers,
	loadRounds,
	nextStepFor,
	regularRoundsStarted,
	roundNumber,
	roundOutcomes,
	standingsOf
} from './state.ts';
import { ensurePairingCode, findGameByCode, findPlayerByToken, GameError, resolveTv } from './engine.ts';
import { hashToken, isPlausibleToken } from '#lib/server/auth/crypto.ts';

// --- Shared game model -------------------------------------------------------------------------

interface GameModel {
	game: Game;
	info: GameInfo;
	/** All players, kicked ones included (resolves a phone's token without another query). */
	players: Player[];
	/**
	 * Every player's own cross in the running round, by player id. SERVER-SIDE ONLY: a player's
	 * snapshot takes exactly its own entry (`myGuess`); never spread this into a snapshot.
	 */
	guessesByPlayer: Map<string, OwnGuess>;
	summaries: PlayerSummary[];
	activeCount: number;
	roundsPlayed: number;
	tv: HostTvStatus;
	current: GameRound | null;
	phase: PhaseState;
}

export function joinUrl(joinCode: string): string {
	return `${ORIGIN}/join/${joinCode}`;
}

function competitionRanks(sortedValues: readonly number[]): number[] {
	const ranks: number[] = [];
	sortedValues.forEach((v, i) => ranks.push(i > 0 && v === sortedValues[i - 1] ? ranks[i - 1]! : i + 1));
	return ranks;
}

/** Only for a round that has ended (reads the answer). */
async function buildResult(
	ex: Executor,
	g: Game,
	round: GameRound,
	rounds: readonly GameRound[],
	players: readonly Player[]
): Promise<RoundResult> {
	const [targetMap, clueMap, rows] = await Promise.all([
		targets([round.locationId], ex),
		revealedClues([round.locationId], ex),
		ex
			.select()
			.from(guess)
			.where(and(eq(guess.roundId, round.id), isNotNull(guess.distanceKm)))
	]);
	const target = targetMap.get(round.locationId);
	if (!target) throw new Error(`Location ${round.locationId} is missing`);
	const active = new Set(activePlayers(players).map((p) => p.id));
	const counted = rows
		.filter((r) => active.has(r.playerId))
		.sort((a, b) => a.distanceKm! - b.distanceKm! || (a.playerId < b.playerId ? -1 : 1));
	const ranks = competitionRanks(counted.map((r) => r.distanceKm!));
	const winners = round.winnerPlayerIds.filter((id) => active.has(id));
	const endedAt = round.endedAt!.getTime();
	const revealStartedAt = g.revealStartedAt?.getTime() ?? endedAt;
	const skippedAt = g.revealSkippedAt?.getTime() ?? null;
	const schedule = revealSchedule(
		revealStartedAt,
		counted.map((r) => r.playerId),
		round.id
	);
	// A skip ends the build-up at once: nothing is scheduled after it.
	const answerVisibleAt =
		skippedAt === null ? schedule.answerVisibleAt : Math.min(schedule.answerVisibleAt, skippedAt);
	const guesses: RevealGuess[] = counted.map((r, i) => ({
		playerId: r.playerId,
		lat: r.lat,
		lng: r.lng,
		distanceKm: r.distanceKm!,
		rank: ranks[i]!,
		isWinner: winners.includes(r.playerId),
		locked: r.lockedAt !== null,
		revealAt: Math.min(schedule.revealAt[i]!, answerVisibleAt)
	}));
	const guessed = new Set(counted.map((r) => r.playerId));
	return {
		round: {
			index: round.index,
			number: roundNumber(round, rounds),
			isSuddenDeath: round.isSuddenDeath,
			eligiblePlayerIds: eligibleIds(round, players),
			clue: clueMap.get(round.locationId) ?? { textSv: null, textEn: null, photo: null },
			startedAt: round.startedAt?.getTime() ?? endedAt,
			endedAt
		},
		target,
		guesses,
		noGuessPlayerIds: eligibleIds(round, players).filter((id) => !guessed.has(id)),
		winnerPlayerIds: winners,
		revealStartedAt,
		answerVisibleAt,
		skipped: skippedAt !== null
	};
}

/**
 * Reads the game in one snapshot: a read-only REPEATABLE READ transaction, so the game row,
 * its rounds, guesses and players all come from the same committed state (separate queries
 * could see the game still in `round` but its round already ended by a concurrent transition).
 */
function loadModel(gameId: string): Promise<GameModel | null> {
	return db.transaction((tx) => loadModelIn(tx, gameId), {
		isolationLevel: 'repeatable read',
		accessMode: 'read only'
	});
}

async function loadModelIn(ex: Executor, gameId: string): Promise<GameModel | null> {
	const [g] = await ex.select().from(game).where(eq(game.id, gameId));
	if (!g) return null;
	const [players, rounds, tvs, names] = await Promise.all([
		loadPlayers(ex, gameId),
		loadRounds(ex, gameId),
		ex.select({ id: tvScreen.id }).from(tvScreen).where(eq(tvScreen.gameId, gameId)),
		g.playlistId ? playlistNames([g.playlistId], ex) : Promise.resolve(new Map<string, BilingualName>())
	]);
	const connected = connectedPlayerIds(gameId);
	const active = activePlayers(players);
	const summaries: PlayerSummary[] = active.map((p) => ({
		id: p.id,
		nickname: p.nickname,
		color: p.color,
		connected: connected.has(p.id),
		lateJoiner: g.startedAt !== null && p.joinedAt.getTime() > g.startedAt.getTime()
	}));
	const info: GameInfo = {
		id: g.id,
		joinCode: g.joinCode,
		joinUrl: joinUrl(g.joinCode),
		language: g.language,
		playlistName: (g.playlistId && names.get(g.playlistId)) || { nameSv: null, nameEn: null },
		timerSeconds: g.timerSeconds,
		totalRounds: g.roundCount
	};
	const current = currentRoundOf(g, rounds);
	const withConnected = (rows: Omit<StandingRow, 'connected'>[]): StandingRow[] =>
		rows.map((r) => ({ ...r, connected: connected.has(r.playerId) }));

	const guessesByPlayer = new Map<string, OwnGuess>();
	let phase: PhaseState;
	switch (g.phase) {
		case 'lobby':
			phase = { phase: 'lobby' };
			break;
		case 'round': {
			if (!current || !current.startedAt || !current.endsAt || current.endedAt) {
				throw new Error(`Game ${g.id} is in 'round' without a running round`);
			}
			const [clueMap, rows] = await Promise.all([
				clues([current.locationId], ex),
				ex
					.select({
						playerId: guess.playerId,
						lat: guess.lat,
						lng: guess.lng,
						touched: guess.touched,
						lockedAt: guess.lockedAt
					})
					.from(guess)
					.where(eq(guess.roundId, current.id))
			]);
			for (const r of rows) {
				guessesByPlayer.set(r.playerId, {
					lat: r.lat,
					lng: r.lng,
					touched: r.touched,
					lockedAt: r.lockedAt?.getTime() ?? null
				});
			}
			const locked = rows.filter((r) => r.lockedAt !== null);
			const activeIds = new Set(active.map((p) => p.id));
			const round: ActiveRound = {
				index: current.index,
				number: roundNumber(current, rounds),
				isSuddenDeath: current.isSuddenDeath,
				eligiblePlayerIds: eligibleIds(current, players),
				startedAt: current.startedAt.getTime(),
				endsAt: current.endsAt.getTime(),
				clue: clueMap.get(current.locationId) ?? { textSv: null, textEn: null, photo: null }
			};
			phase = {
				phase: 'round',
				round,
				lockedPlayerIds: locked.map((l) => l.playerId).filter((id) => activeIds.has(id))
			};
			break;
		}
		case 'reveal':
		case 'standings': {
			if (!current || !current.endedAt) {
				throw new Error(`Game ${g.id} is in '${g.phase}' without an ended round`);
			}
			const standingRows = standingsOf(players, await roundOutcomes(ex, rounds));
			const result = await buildResult(ex, g, current, rounds, players);
			phase =
				g.phase === 'reveal'
					? { phase: 'reveal', result, standings: withConnected(standingRows) }
					: {
							phase: 'standings',
							result,
							standings: withConnected(standingRows),
							next: await nextStepFor(g, rounds, standingRows)
						};
			break;
		}
		case 'finished': {
			const standingRows = standingsOf(players, await roundOutcomes(ex, rounds));
			const activeIds = new Set(active.map((p) => p.id));
			phase = {
				phase: 'finished',
				standings: withConnected(standingRows),
				winnerPlayerIds: g.winnerPlayerIds.filter((id) => activeIds.has(id)),
				endedEarly: g.endedEarly
			};
			break;
		}
	}

	return {
		game: g,
		info,
		players,
		guessesByPlayer,
		summaries,
		activeCount: active.length,
		roundsPlayed: regularRoundsStarted(rounds),
		tv: { paired: tvs.length > 0, connected: tvs.some((t) => isPresent(gameId, `tv:${t.id}`)) },
		current,
		phase
	};
}

const modelCache = new Map<string, { version: number; model: Promise<GameModel | null> }>();

/** The shared model for the game's current version (built once per change while streamed). */
function getModel(gameId: string): Promise<GameModel | null> {
	const version = gameVersion(gameId);
	const hit = modelCache.get(gameId);
	if (hit && hit.version === version) return hit.model;
	for (const key of modelCache.keys()) if (subscriberCount(key) === 0) modelCache.delete(key);
	const model = loadModel(gameId);
	if (subscriberCount(gameId) > 0) {
		modelCache.set(gameId, { version, model });
		model.catch(() => {
			if (modelCache.get(gameId)?.model === model) modelCache.delete(gameId);
		});
	}
	return model;
}

// --- Host --------------------------------------------------------------------------------------

/** Snapshot for the host controller (caller already verified as admin). */
export async function buildHostSnapshot(gameId: string): Promise<HostSnapshot> {
	const m = await getModel(gameId);
	if (!m) throw new GameError('NOT_FOUND', 'Game not found');
	return {
		serverNow: deps.now(),
		game: m.info,
		players: m.summaries,
		role: 'host',
		tv: m.tv,
		roundsPlayed: m.roundsPlayed,
		...m.phase
	};
}

// --- Player ------------------------------------------------------------------------------------

const NO_GAME: PlayerGate = { role: 'player', status: 'noGame' };

/** Snapshot for the phone with `token` in the unfinished game with `code`. */
export async function buildPlayerState(code: string, token: string | null): Promise<PlayerStateValue> {
	const g = await findGameByCode(code);
	if (!g) return NO_GAME;
	return buildPlayerStateForGame(g.id, token);
}

/**
 * Which game a phone means by `code`: the unfinished game with that code, unless the phone
 * holds a player token for a recently finished game with the same code that the unfinished one
 * does not know (so a player keeps seeing their final standings). `tokenFor(gameId)` reads the
 * per-game player cookie.
 */
export async function resolvePlayerGame(
	code: string,
	tokenFor: (gameId: string) => string | null
): Promise<Game | null> {
	const canonical = code.trim().toUpperCase();
	const candidates = await db
		.select()
		.from(game)
		.where(eq(game.joinCode, canonical))
		.orderBy(desc(game.createdAt))
		.limit(6);
	const unfinished = candidates.find((g) => g.phase !== 'finished') ?? null;
	if (unfinished && (await findPlayerByToken(unfinished.id, tokenFor(unfinished.id)))) return unfinished;
	for (const g of candidates) {
		if (g.phase !== 'finished') continue;
		if (await findPlayerByToken(g.id, tokenFor(g.id))) return g;
	}
	return unfinished;
}

/** Snapshot for the phone with `token` in the game `gameId` (finished games included). */
export async function buildPlayerStateForGame(
	gameId: string,
	token: string | null
): Promise<PlayerStateValue> {
	const m = await getModel(gameId);
	if (!m) return NO_GAME;
	// The model holds every player (kicked included) with its token hash: no query per snapshot.
	const tokenHash = isPlausibleToken(token) ? hashToken(token) : null;
	const me = tokenHash ? (m.players.find((p) => p.tokenHash === tokenHash) ?? null) : null;
	if (!me) {
		if (m.game.phase === 'finished') return NO_GAME;
		return { role: 'player', status: 'notJoined', joinable: m.activeCount < MAX_PLAYERS };
	}
	if (me.kicked) return { role: 'player', status: 'kicked' };

	const base = {
		serverNow: deps.now(),
		game: m.info,
		players: m.summaries,
		role: 'player' as const,
		status: 'playing' as const,
		me: { id: me.id, nickname: me.nickname, color: me.color }
	};
	const phase = m.phase;
	switch (phase.phase) {
		case 'round': {
			const round = m.current!;
			const canGuess = isEligible(round, me);
			// The caller's own cross only.
			const myGuess = canGuess ? (m.guessesByPlayer.get(me.id) ?? null) : null;
			return { ...base, ...phase, canGuess, myGuess };
		}
		case 'reveal':
		case 'standings':
			return { ...base, ...phase, myResult: ownResult(phase.result, m, me) };
		default:
			return { ...base, ...phase };
	}
}

function ownResult(result: RoundResult, m: GameModel, me: Player): OwnResult | null {
	const mine = result.guesses.find((g) => g.playerId === me.id);
	if (mine) return { distanceKm: mine.distanceKm, rank: mine.rank, won: mine.isWinner };
	if (m.current && isEligible(m.current, me)) return { distanceKm: null, rank: null, won: false };
	return null;
}

// --- TV ----------------------------------------------------------------------------------------

/** Snapshot for the TV with `token` (pairing screen until paired). */
export async function buildTvState(token: string | null): Promise<TvStateValue> {
	const tv = await resolveTv(token);
	if (!tv) return { role: 'tv', status: 'unregistered' };
	return buildTvStateFor(tv);
}

/** Snapshot for a known TV row; rotates an expired pairing code. */
export async function buildTvStateFor(row: TvScreen): Promise<TvStateValue> {
	const m = row.gameId ? await getModel(row.gameId) : null;
	// Paired with a running game: nothing to rotate (and no query beyond the shared model). Free
	// (never paired, game gone or finished): make sure it shows a valid pairing code.
	const tv = m && m.game.phase !== 'finished' ? row : await ensurePairingCode(row, { free: true });
	if (m) {
		const snapshot: TvSnapshot = {
			serverNow: deps.now(),
			game: m.info,
			players: m.summaries,
			role: 'tv',
			status: 'paired',
			...m.phase
		};
		if (m.game.phase === 'finished' && tv.pairingCode && tv.codeExpiresAt) {
			snapshot.nextPairing = { pairingCode: tv.pairingCode, codeExpiresAt: tv.codeExpiresAt.getTime() };
		}
		return snapshot;
	}
	const gate: TvGate = {
		role: 'tv',
		status: 'pairing',
		serverNow: deps.now(),
		pairingCode: tv.pairingCode ?? '',
		codeExpiresAt: tv.codeExpiresAt?.getTime() ?? deps.now()
	};
	return gate;
}
