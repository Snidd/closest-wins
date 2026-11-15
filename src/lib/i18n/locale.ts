/** UI and content locales. Swedish when the device locale is Swedish, otherwise English. */
export const LOCALES = ['sv', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
	return value === 'sv' || value === 'en';
}

/**
 * Picks the locale from an `Accept-Language` header: the most preferred language (highest q,
 * then header order) decides. Any tag starting with `sv` (sv, sv-SE, sv-FI…) gives Swedish,
 * everything else English.
 */
export function detectLocale(acceptLanguage: string | null | undefined): Locale {
	if (!acceptLanguage) return DEFAULT_LOCALE;
	let bestTag = '';
	let bestQ = 0;
	for (const part of acceptLanguage.split(',')) {
		const [rawTag = '', ...params] = part.trim().split(';');
		const tag = rawTag.trim().toLowerCase();
		if (!tag) continue;
		let q = 1;
		for (const p of params) {
			const [k, v] = p.trim().split('=');
			if (k === 'q') q = Number.parseFloat(v ?? '') || 0;
		}
		if (q > bestQ) {
			bestTag = tag;
			bestQ = q;
		}
	}
	return bestTag.startsWith('sv') ? 'sv' : 'en';
}
