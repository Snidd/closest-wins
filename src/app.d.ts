// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Locale } from '#lib/i18n/locale.ts';

declare global {
	namespace App {
		interface Locals {
			/** Valid admin session cookie (set in hooks.server.ts). */
			admin: boolean;
			/** Device locale from Accept-Language (set in hooks.server.ts). */
			locale: Locale;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
