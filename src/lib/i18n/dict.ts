import type { Locale } from './locale.ts';

type Message = string | ((...args: never[]) => string);

/** Widens literal strings to `string` and keeps function signatures. */
export type Messages<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string;
};

/** A dictionary for one surface: the same keys in both languages. */
export type Dict<T> = { readonly [L in Locale]: Messages<T> };

/**
 * Declares a dictionary. English is the reference: Swedish must have exactly the same keys
 * (a missing or extra key is a type error) and the same function signatures.
 *
 * ```ts
 * export const player = defineDict({
 * 	en: { lockIn: 'Lock in', roundOf: (n: number, total: number) => `Round ${n} of ${total}` },
 * 	sv: { lockIn: 'Lås', roundOf: (n, total) => `Runda ${n} av ${total}` }
 * });
 * ```
 */
export function defineDict<const T extends Record<string, Message>>(dict: {
	en: T;
	sv: Messages<T>;
}): Dict<T> {
	return dict as unknown as Dict<T>;
}

/** Non-component access (server code, plain modules): `translate(common, locale).appName`. */
export function translate<T>(dict: Dict<T>, locale: Locale): Messages<T> {
	return dict[locale];
}
