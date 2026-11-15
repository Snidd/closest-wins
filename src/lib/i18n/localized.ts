import type { Locale } from './locale.ts';

type Text = string | null | undefined;

/** Objects carrying a bilingual field as `<field>Sv` / `<field>En` (DB rows and snapshots alike). */
export type Bilingual<F extends string> = { [K in `${F}Sv` | `${F}En`]: Text };

const filled = (s: Text): s is string => typeof s === 'string' && s.trim() !== '';

/**
 * Content fallback: the requested language if filled in, otherwise the other one, otherwise ''.
 *
 * ```ts
 * localized(location, 'name', 'sv'); // location.nameSv ?? location.nameEn
 * localized(round.clue, 'text', locale);
 * ```
 */
export function localized<F extends string>(obj: Bilingual<F>, field: F, locale: Locale): string {
	const sv = (obj as Record<string, Text>)[`${field}Sv`];
	const en = (obj as Record<string, Text>)[`${field}En`];
	const [first, second] = locale === 'sv' ? [sv, en] : [en, sv];
	if (filled(first)) return first;
	if (filled(second)) return second;
	return '';
}

/** Which languages are missing for a bilingual field (for translation badges). */
export function missingLocales<F extends string>(obj: Bilingual<F>, field: F): Locale[] {
	const missing: Locale[] = [];
	if (!filled((obj as Record<string, Text>)[`${field}Sv`])) missing.push('sv');
	if (!filled((obj as Record<string, Text>)[`${field}En`])) missing.push('en');
	return missing;
}
