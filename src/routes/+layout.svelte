<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { provideLocale } from '#lib/i18n/context.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Device locale for every page; the TV overrides it with the game language in its subtree.
	provideLocale(() => data.locale);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
