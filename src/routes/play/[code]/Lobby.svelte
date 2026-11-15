<!-- Waiting for the host: you're in, your colour, who else is here (live). -->
<script lang="ts">
	import { scale } from 'svelte/transition';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { player } from '#lib/i18n/player.ts';
	import PlayerChip from '#lib/ui/PlayerChip.svelte';
	import { textColorOn } from '#lib/ui/colors.ts';
	import Shell from './Shell.svelte';
	import Pin from './Pin.svelte';
	import type { Snap } from './types.ts';

	let { s }: { s: Snap<'lobby'> } = $props();
	const t = useT(player);
	const tc = useT(common);

	const others = $derived(s.players.filter((p) => p.id !== s.me.id));
	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<Shell testid="lobby">
	{#snippet label()}
		<span class="code-chip">{tc().joinCode} <strong class="code">{s.game.joinCode}</strong></span>
	{/snippet}

	<section class="hero">
		<div class="pin-wrap"><Pin color={s.me.color} size="3.25rem" /></div>
		<h1>{t().youreIn}</h1>
		<span
			class="me"
			style:--me={s.me.color}
			style:--me-text={textColorOn(s.me.color)}
			data-testid="me-name">{s.me.nickname}</span
		>
	</section>

	<section class="tv">
		<svg viewBox="0 0 48 48" aria-hidden="true"
			><rect x="5" y="9" width="38" height="25" rx="3" /><path d="M17 41h14M24 34v7" /></svg
		>
		<div>
			<p class="strong">{t().lookAtTv}</p>
			<p class="muted small">{t().keepOpen}</p>
		</div>
	</section>

	<section class="players" aria-labelledby="players-title">
		<h2 id="players-title" data-testid="player-count">{t().playersHere(s.players.length)}</h2>
		<ul>
			<li>
				<PlayerChip nickname="{s.me.nickname} ({t().you.toLowerCase()})" color={s.me.color} />
			</li>
			{#each others as p (p.id)}
				<li in:scale={{ duration: reduceMotion ? 0 : 260, start: 0.6 }} data-testid="lobby-player">
					<PlayerChip
						nickname={p.nickname}
						color={p.color}
						connected={p.connected}
						disconnectedLabel={tc().disconnected}
					/>
				</li>
			{/each}
		</ul>
		{#if others.length === 0}
			<p class="muted small waiting">{t().waitingForPlayers}</p>
		{/if}
	</section>

	<section class="how" aria-label={tc().howToPlay}>
		<ol>
			<li>{t().lobbyHow1}</li>
			<li>{t().lobbyHow2}</li>
			<li>{t().lobbyHow3}</li>
		</ol>
	</section>
</Shell>

<style>
	.code-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
		padding: 0.25em 0.75em;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-xs);
	}
	.code-chip .code {
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding-top: clamp(var(--space-2), 4vh, var(--space-6));
		text-align: center;
	}
	.pin-wrap {
		animation: drop 700ms var(--ease-out) both;
	}
	@keyframes drop {
		0% {
			transform: translateY(-1.5rem);
			opacity: 0;
		}
		60% {
			transform: translateY(0.2rem);
			opacity: 1;
		}
		100% {
			transform: none;
		}
	}
	h1 {
		font-size: clamp(2rem, 10vw, 2.75rem);
		letter-spacing: -0.02em;
	}
	.me {
		max-width: 100%;
		padding: 0.3em 1em;
		border-radius: var(--radius-pill);
		background: var(--me);
		color: var(--me-text);
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tv {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.tv svg {
		flex: none;
		width: 2.75rem;
		height: 2.75rem;
		fill: none;
		stroke: var(--color-primary);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.strong {
		font-weight: var(--weight-medium);
		line-height: var(--leading-tight);
	}
	.small {
		font-size: var(--text-sm);
		margin-top: var(--space-1);
	}
	.players {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.players h2,
	.how {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.players ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.players li {
		max-width: 100%;
	}
	.waiting {
		margin: 0;
	}
	.how ol {
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		text-transform: none;
		letter-spacing: normal;
		font-size: var(--text-sm);
	}
	.how li {
		counter-increment: step;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}
	.how li::before {
		content: counter(step);
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		color: var(--color-primary);
		font-weight: var(--weight-bold);
		font-size: var(--text-xs);
		transform: translateY(-0.1rem);
	}
</style>
