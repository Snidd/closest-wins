<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { provideLocale } from '#lib/i18n/context.ts';
	import { applySurface, surfaceFor } from '#lib/surface.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Device locale for every page; the TV overrides it with the game language in its subtree.
	provideLocale(() => data.locale);

	// The server sets `<html data-surface>` and the viewport meta for the first page; keep them
	// right on client-side navigation (e.g. join form → /play). Before the DOM update, so the new
	// page never renders with the previous page's chrome.
	$effect.pre(() => {
		applySurface(document, surfaceFor(page.route.id));
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
