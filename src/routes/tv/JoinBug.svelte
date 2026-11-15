<!--
  Persistent corner "bug" during a game (like a TV channel logo): brand mark plus how to join,
  so latecomers can still get in.
-->
<script lang="ts">
	import type { GameInfo } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import Logo from './Logo.svelte';
	import { shortJoinUrl } from './tv.svelte.ts';

	let { game }: { game: GameInfo } = $props();
	const t = useT(tvDict);
</script>

<div class="bug" data-testid="join-bug">
	<Logo wordmark={false} class="bug-mark" />
	<div class="text">
		<span class="label">{t().join}</span>
		<span class="url">{shortJoinUrl(game.joinUrl)}</span>
	</div>
	<span class="code u-code" aria-label="{t().joinCode} {game.joinCode}">{game.joinCode}</span>
</div>

<style>
	.bug {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.45rem 0.35rem 0.6rem;
		border-radius: 1.1rem;
		background: var(--tv-glass);
		border: 1px solid var(--tv-line);
		backdrop-filter: blur(12px);
		box-shadow: 0 0.3rem 1.2rem rgb(0 0 0 / 0.35);
		line-height: 1.1;
	}
	.bug :global(.bug-mark) {
		font-size: 1.9rem;
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.label {
		font-size: 0.8rem;
		font-weight: 750;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--tv-ink-2);
	}
	.url {
		font-size: 0.95rem;
		font-weight: 650;
		color: var(--tv-ink);
		white-space: nowrap;
	}
	.code {
		padding: 0.2rem 0.55rem;
		border-radius: 0.7rem;
		background: var(--tv-gold);
		color: #1d1400;
		font-size: 1.6rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
</style>
