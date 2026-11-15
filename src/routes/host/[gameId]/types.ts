import type { HostSnapshot, PlayerSummary, StandingRow } from '#lib/game/types.ts';

export type HostPhase<P extends HostSnapshot['phase']> = Extract<HostSnapshot, { phase: P }>;

/** Nickname and colour for any player id seen in a snapshot (standings also cover kicked rows). */
export function playerLookup(players: PlayerSummary[], standings: StandingRow[] = []) {
	const map = new Map<string, { nickname: string; color: string; connected: boolean }>();
	for (const r of standings) map.set(r.playerId, { nickname: r.nickname, color: r.color, connected: r.connected });
	for (const p of players) map.set(p.id, { nickname: p.nickname, color: p.color, connected: p.connected });
	return (id: string) => map.get(id) ?? { nickname: '?', color: '#888888', connected: false };
}

/** "Alice", "Alice and Bob", "Alice, Bob and Cleo" (locale-aware conjunction). */
export function listNames(names: string[], locale: string): string {
	try {
		return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
	} catch {
		return names.join(', ');
	}
}

