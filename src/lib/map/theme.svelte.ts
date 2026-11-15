import { systemTheme, watchSystemTheme } from './base.ts';
import type { MapTheme } from './style.ts';

/**
 * Reactive map theme for a component: the `theme` prop if it is 'light' / 'dark', otherwise the
 * page theme (`<html data-theme>` or the OS preference), updated live. Call during init.
 */
export function useMapTheme(prop: () => MapTheme | 'auto' | undefined): () => MapTheme {
	let sys = $state<MapTheme>('light');
	$effect.pre(() => {
		sys = systemTheme();
		return watchSystemTheme((t) => (sys = t));
	});
	return () => {
		const p = prop();
		return p === 'light' || p === 'dark' ? p : sys;
	};
}
