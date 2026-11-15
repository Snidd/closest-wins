<!--
  Player phone. Everything is driven by the `playerState(code)` live query: gates (not joined,
  no game, kicked) and the five phases. This file owns the stream's lifecycle (error screen,
  recovery after sleep); `PlayerApp` renders the states.
-->
<script lang="ts">
	import { playerState } from '#lib/remote/game.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { player } from '#lib/i18n/player.ts';
	import PlayerApp from './PlayerApp.svelte';
	import Gate from './Gate.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = useT(player);
	const tc = useT(common);
</script>

<svelte:head>
	<title>{t().gameCode(data.code)} · {tc().appName}</title>
	<meta name="theme-color" content="#0b1622" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#f4f7fb" media="(prefers-color-scheme: light)" />
</svelte:head>

{#if !data.valid}
	<Gate kind="noGame" code={data.code} />
{:else}
	{#key data.code}
		{@const live = playerState(data.code)}
		<svelte:boundary>
			<PlayerApp {live} code={data.code} />

			{#snippet failed(_error, reset)}
				<Gate
					kind="error"
					code={data.code}
					onretry={async () => {
						await live.reconnect().catch(() => {});
						reset();
					}}
				/>
			{/snippet}
		</svelte:boundary>
	{/key}
{/if}
