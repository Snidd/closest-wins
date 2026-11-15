<!--
  The player's own outcome of the revealed round, the answer (name + fact in the phone's
  language) and, in full mode, a small final-state map with the player's pin highlighted.
  Only render this once the answer may be shown (`answerShownAt`).
-->
<script lang="ts">
	import RevealMap from '#lib/map/RevealMap.svelte';
	import { localized } from '#lib/i18n/localized.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';
	import type { Snap } from './types.ts';

	type Props = { s: Snap<'reveal'> | Snap<'standings'>; compact?: boolean };
	let { s, compact = false }: Props = $props();
	const t = useT(player);
	const locale = useLocale();

	const result = $derived(s.result);
	const mine = $derived(s.myResult);
	const name = $derived(localized(result.target, 'name', locale()));
	const fact = $derived(localized(result.target, 'fact', locale()));
	const nick = (id: string) => s.players.find((p) => p.id === id)?.nickname ?? '?';
	const winnersOthers = $derived(result.winnerPlayerIds.filter((id) => id !== s.me.id));
	const winnerDistance = $derived(result.guesses.find((g) => g.isWinner)?.distanceKm ?? null);
	const shared = $derived(result.winnerPlayerIds.length > 1);
	const kind = $derived(
		!mine ? 'spectator' : mine.distanceKm === null ? 'noGuess' : mine.won ? 'won' : 'placed'
	);
</script>

<section class={['outcome', kind, { compact }]} data-testid="own-result" data-kind={kind}>
	{#if kind === 'won'}
		<div class="trophy" aria-hidden="true">
			<svg viewBox="0 0 48 48"
				><path d="M14 6h20v10a10 10 0 0 1-20 0V6z" /><path d="M14 10H7v3a7 7 0 0 0 7 7M34 10h7v3a7 7 0 0 1-7 7" /><path
					d="M24 26v8M16 42h16M18 42c0-4 2.5-8 6-8s6 4 6 8"
				/></svg
			>
		</div>
		<h1>{shared ? t().youSharedRound : t().youWonRound}</h1>
		<p class="distance" data-testid="own-distance">{t().distance(mine!.distanceKm!)}</p>
	{:else if kind === 'placed'}
		<p class="eyebrow">{t().yourDistance}</p>
		<p class="distance" data-testid="own-distance">{t().distance(mine!.distanceKm!)}</p>
		<p class="eyebrow">{t().away}</p>
		<p class="place" data-testid="own-place">
			{t().placeOf(t().ordinal(mine!.rank!), result.guesses.length)}
		</p>
	{:else if kind === 'noGuess'}
		<h1 class="small">{t().noGuessRound}</h1>
		<p class="muted">{t().noGuessRoundBody}</p>
	{:else}
		<h1 class="small">{t().spectatedRound}</h1>
	{/if}

	{#if result.winnerPlayerIds.length === 0}
		<p class="winner muted">{t().nobodyGuessed}</p>
	{:else if winnersOthers.length > 0}
		<p class="winner" data-testid="round-winner">
			{t().roundWinner(t().list(winnersOthers.map(nick)))}{#if winnerDistance !== null}{` · ${t().distance(
					winnerDistance
				)}`}{/if}
		</p>
	{/if}
</section>

<section class={['answer', { compact }]} data-testid="answer">
	<p class="eyebrow">{t().theAnswer}</p>
	<h2 data-testid="answer-name">{name}</h2>
	{#if fact && !compact}<p class="fact">{fact}</p>{/if}
	{#if !compact}
		<div class="map" aria-label={t().mapOfGuesses}>
			<RevealMap
				players={s.players}
				{result}
				mode="final"
				highlightPlayerId={s.me.id}
				padding={{ top: 16, right: 16, bottom: 16, left: 16 }}
			/>
		</div>
	{/if}
</section>

<style>
	.outcome {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-1);
		padding-top: var(--space-4);
	}
	.outcome.compact {
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	h1 {
		font-size: clamp(1.75rem, 8.5vw, 2.4rem);
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	h1.small {
		font-size: clamp(1.4rem, 6.5vw, 1.75rem);
	}
	.compact h1 {
		font-size: var(--text-xl);
	}
	.eyebrow {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-weight: var(--weight-medium);
	}
	.distance {
		font-size: clamp(2.5rem, 14vw, 3.75rem);
		font-weight: var(--weight-bold);
		letter-spacing: -0.03em;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}
	.compact .distance {
		font-size: var(--text-3xl);
	}
	.won .distance {
		font-size: var(--text-2xl);
		color: var(--color-text-muted);
	}
	.place {
		margin-top: var(--space-2);
		padding: 0.25em 0.9em;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
	}
	.winner {
		margin-top: var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.trophy {
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		margin-bottom: var(--space-2);
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-accent) 30%, transparent);
		animation: pop 500ms var(--ease-out);
	}
	.trophy svg {
		width: 2.6rem;
		height: 2.6rem;
		fill: none;
		stroke: var(--color-accent-contrast);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@keyframes pop {
		0% {
			transform: scale(0.3) rotate(-12deg);
		}
		70% {
			transform: scale(1.1) rotate(4deg);
		}
	}
	.answer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.answer.compact {
		gap: 0;
		padding: var(--space-3) var(--space-4);
	}
	.answer h2 {
		font-size: var(--text-xl);
		text-wrap: balance;
	}
	.compact h2 {
		font-size: var(--text-lg);
	}
	.fact {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		text-wrap: pretty;
		-webkit-user-select: text;
		user-select: text;
	}
	.map {
		height: clamp(11rem, 32dvh, 16rem);
		margin: var(--space-2) calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
		border-radius: var(--radius-md);
		overflow: hidden;
	}
</style>
