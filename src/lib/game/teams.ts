/**
 * Team display names, shared by every surface (client and server). A team without a custom
 * name is "Team 2" / "Lag 2" (1-based). The TV passes the game language, phones and the host
 * the device locale.
 */
import type { GameInfo } from '#lib/game/types.ts';
import { common } from '#lib/i18n/common.ts';
import type { Locale } from '#lib/i18n/locale.ts';

/** The custom name of team `index` (0-based), or the default name. */
export function teamName(index: number, name: string | null | undefined, locale: Locale): string {
	const custom = name?.trim();
	return custom ? custom : common[locale].teamDefault(index + 1);
}

/** The display name of team `index` of a game (from `GameInfo.teams`). */
export function gameTeamName(game: Pick<GameInfo, 'teams'>, index: number, locale: Locale): string {
	return teamName(index, game.teams?.find((t) => t.index === index)?.name, locale);
}

/** Display names of several teams of a game, joined for a sentence ("Red & Team 2"). */
export function gameTeamNames(game: Pick<GameInfo, 'teams'>, indexes: readonly number[], locale: Locale): string {
	return indexes.map((i) => gameTeamName(game, i, locale)).join(' & ');
}
