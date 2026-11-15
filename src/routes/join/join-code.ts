/**
 * Forgiving join-code input helpers, shared by the landing page (live, client side) and the
 * no-JS `/join?code=` fallback. The server still validates with `JoinCodeSchema`.
 */
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '#lib/game/types.ts';

/**
 * Upper-cases, drops whitespace and anything outside `JOIN_CODE_ALPHABET`, and caps the length.
 * `rejected` is true if a character other than whitespace/punctuation was thrown away (e.g. an
 * I, L, O or a digit), so the UI can explain which letters codes use.
 */
export function sanitizeJoinCode(raw: string): { code: string; rejected: boolean } {
	let code = '';
	let rejected = false;
	for (const ch of raw.toUpperCase()) {
		if (JOIN_CODE_ALPHABET.includes(ch)) {
			if (code.length < JOIN_CODE_LENGTH) code += ch;
		} else if (/[\p{L}\p{N}]/u.test(ch)) {
			rejected = true;
		}
	}
	return { code, rejected };
}

export function normalizeJoinCode(raw: string): string {
	return sanitizeJoinCode(raw).code;
}
