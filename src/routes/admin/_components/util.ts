/** Small helpers shared by the admin pages. */
import { isHttpError } from '@sveltejs/kit';
import type { Locale } from '#lib/i18n/locale.ts';

/** Status and message of a rejected remote command (`HttpError`) or any other error. */
export function errorInfo(e: unknown): { status: number | null; message: string } {
	if (isHttpError(e)) return { status: e.status, message: e.body.message };
	if (e instanceof Error) return { status: null, message: e.message };
	return { status: null, message: String(e) };
}

export function formatDate(value: Date | number | string, locale: Locale, withTime = false): string {
	const d = value instanceof Date ? value : new Date(value);
	return new Intl.DateTimeFormat(locale === 'sv' ? 'sv-SE' : 'en-GB', {
		dateStyle: 'medium',
		...(withTime ? { timeStyle: 'short' } : {})
	}).format(d);
}

/** Coordinates for display: 4 decimals is ~11 m. */
export const fmtCoord = (n: number) => (Math.round(n * 1e5) / 1e5).toString();

type Text = string | null | undefined;
const filled = (s: Text) => typeof s === 'string' && s.trim() !== '';

/** Client-side twin of the server's translation gaps (see `LocationListItem.missing`). */
export function missingOf(l: {
	nameSv: Text;
	nameEn: Text;
	clueTextSv: Text;
	clueTextEn: Text;
	factSv: Text;
	factEn: Text;
}): { name: Locale[]; clueText: Locale[]; fact: Locale[] } {
	const gap = (sv: Text, en: Text): Locale[] =>
		filled(sv) === filled(en) ? [] : filled(sv) ? ['en'] : ['sv'];
	return {
		name: gap(l.nameSv, l.nameEn),
		clueText: gap(l.clueTextSv, l.clueTextEn),
		fact: gap(l.factSv, l.factEn)
	};
}
