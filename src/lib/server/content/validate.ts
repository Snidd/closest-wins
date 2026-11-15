/**
 * Validation helpers shared by the content services (and usable by the MCP tools to validate
 * raw input with the same schemas before calling a service).
 */
import * as v from 'valibot';
import { TEXT_MAX } from '#lib/content/schemas.ts';
import type { Locale } from '#lib/i18n/locale.ts';
import { ContentError } from './errors.ts';

/**
 * Parses `data` with a schema from `#lib/content/schemas.ts`; throws `ContentError('INVALID')`
 * listing every issue (`field: message`).
 */
export function parseContent<const S extends v.GenericSchema>(schema: S, data: unknown): v.InferOutput<S> {
	const result = v.safeParse(schema, data);
	if (result.success) return result.output;
	const message = result.issues
		.map((issue) => {
			const path = v.getDotPath(issue);
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join('; ');
	throw new ContentError('INVALID', message);
}

type Text = string | null | undefined;
export const filled = (s: Text): s is string => typeof s === 'string' && s.trim() !== '';

/** Trim, '' → null (services may be called with untrimmed strings by MCP tools). */
export const clean = (s: Text): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

/**
 * Languages to translate for a bilingual field: the missing language when exactly one is filled,
 * [] when both are filled or both are empty (an unused optional field needs no translation).
 */
export function translationGap(sv: Text, en: Text): Locale[] {
	const hasSv = filled(sv);
	const hasEn = filled(en);
	if (hasSv === hasEn) return [];
	return hasSv ? ['en'] : ['sv'];
}

export function checkLength(label: string, value: string | null, max: number): void {
	if (value && value.length > max) {
		throw new ContentError('INVALID', `${label} must be at most ${max} characters`);
	}
}

export interface LocationShapeForCheck {
	nameSv: string | null;
	nameEn: string | null;
	clueTextSv: string | null;
	clueTextEn: string | null;
	factSv: string | null;
	factEn: string | null;
	lat: number;
	lng: number;
	photoId: string | null;
}

/** The location rules (mirrors the schema and the DB CHECKs) on a complete, merged row. */
export function checkLocation(l: LocationShapeForCheck): void {
	if (!filled(l.nameSv) && !filled(l.nameEn)) {
		throw new ContentError('INVALID', 'A name in at least one language is required');
	}
	if (!l.photoId && !filled(l.clueTextSv) && !filled(l.clueTextEn)) {
		throw new ContentError('INVALID', 'A photo or a clue text is required');
	}
	if (!Number.isFinite(l.lat) || l.lat < -90 || l.lat > 90) {
		throw new ContentError('INVALID', 'Latitude must be between -90 and 90');
	}
	if (!Number.isFinite(l.lng) || l.lng < -180 || l.lng > 180) {
		throw new ContentError('INVALID', 'Longitude must be between -180 and 180');
	}
	checkLength('nameSv', l.nameSv, TEXT_MAX.name);
	checkLength('nameEn', l.nameEn, TEXT_MAX.name);
	checkLength('clueTextSv', l.clueTextSv, TEXT_MAX.clue);
	checkLength('clueTextEn', l.clueTextEn, TEXT_MAX.clue);
	checkLength('factSv', l.factSv, TEXT_MAX.fact);
	checkLength('factEn', l.factEn, TEXT_MAX.fact);
}

/** postgres.js error code of a failed drizzle query (drizzle wraps it in `cause`). */
export function pgCode(e: unknown): string | undefined {
	return (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
}

/** Escapes `%`, `_` and `\` for ILIKE patterns. */
export function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids from untrusted callers: anything that is not a uuid can never match a row. */
export const isUuid = (id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id);
