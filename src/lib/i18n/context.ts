import { createContext } from 'svelte';
import type { Dict, Messages } from './dict.ts';
import { DEFAULT_LOCALE, type Locale } from './locale.ts';

const [getLocaleGetter, setLocaleGetter, hasLocaleGetter] = createContext<() => Locale>();

/**
 * Provides the locale to every descendant component. The root layout provides the device
 * locale (from `Accept-Language`); a subtree can override it, e.g. the TV provides the game's
 * language. Pass a getter so the value stays reactive. Call during component initialisation.
 */
export function provideLocale(get: () => Locale): void {
	setLocaleGetter(get);
}

/** Returns a getter for the current locale. Call during component initialisation. */
export function useLocale(): () => Locale {
	return hasLocaleGetter() ? getLocaleGetter() : () => DEFAULT_LOCALE;
}

/**
 * Typed translator for a component. Works in SSR and in the browser.
 *
 * ```svelte
 * <script lang="ts">
 * 	import { useT } from '#lib/i18n/index.ts';
 * 	import { player } from '#lib/i18n/player.ts';
 * 	const t = useT(player);
 * </script>
 * <button>{t().lockIn}</button>
 * ```
 */
export function useT<T>(dict: Dict<T>): () => Messages<T> {
	const locale = useLocale();
	return () => dict[locale()];
}
