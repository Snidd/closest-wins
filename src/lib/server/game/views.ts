/**
 * Builds the role snapshots streamed to clients. STUB (Wave 0): signatures are final.
 *
 * THE ANSWER NEVER LEAVES THE SERVER BEFORE REVEAL: target lat/lng, name and fact may only be
 * read into a `RoundResult`, which only exists in the `reveal` / `standings` variants. Do not
 * select those columns at all while the phase is `round`.
 *
 * Connected flags come from presence.ts; photos are mapped with `toPhotoView` from
 * `#lib/server/content/photos.ts`; `joinUrl` is `${ORIGIN}/join/${joinCode}`.
 */
import type { HostSnapshot, PlayerStateValue, TvStateValue } from '#lib/game/types.ts';
import { notImplemented } from '../not-implemented.ts';

/** Snapshot for the phone with `token` in the unfinished game with `code`. */
export async function buildPlayerState(code: string, token: string | null): Promise<PlayerStateValue> {
	return notImplemented('buildPlayerState');
}

/** Snapshot for the host controller (caller already verified as admin). */
export async function buildHostSnapshot(gameId: string): Promise<HostSnapshot> {
	return notImplemented('buildHostSnapshot');
}

/** Snapshot for the TV with `token` (pairing screen until paired). */
export async function buildTvState(token: string | null): Promise<TvStateValue> {
	return notImplemented('buildTvState');
}
