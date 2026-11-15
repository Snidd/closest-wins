<!--
  Reveal. Until `answerVisibleAt` (server clock) the phone only says "look at the TV", so it
  never spoils the big screen's suspense; then the player's own outcome, the answer and a small
  map of everyone's guesses for those who cannot see the TV.
-->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';
	import { ticker, type ServerClock } from './play.svelte.ts';
	import Shell from './Shell.svelte';
	import RoundOutcome from './RoundOutcome.svelte';
	import type { Snap } from './types.ts';

	type Props = { s: Snap<'reveal'>; clock: ServerClock };
	let { s, clock }: Props = $props();
	const t = useT(player);

	const now = ticker(200);
	const visible = $derived(now() + clock.offset >= s.result.answerVisibleAt);

	const r = $derived(s.result.round);
	const roundLabel = $derived(
		r.isSuddenDeath
			? r.number > 1
				? t().suddenDeathN(r.number)
				: t().suddenDeath
			: t().roundOf(r.number, s.game.totalRounds)
	);
</script>

{#if !visible}
	<Shell center testid="reveal-holding">
		{#snippet label()}{roundLabel}{/snippet}
		<section class="holding">
			<div class="tv" aria-hidden="true">
				<svg viewBox="0 0 120 96">
					<rect class="screen" x="6" y="6" width="108" height="66" rx="8" />
					<path class="stand" d="M44 88h32M60 72v16" />
					<g class="pin"
						><path d="M60 22c-6 0-11 4.8-11 10.8C49 40.6 60 51 60 51s11-10.4 11-18.2C71 26.8 66 22 60 22z" /><circle
							cx="60"
							cy="33"
							r="4"
						/></g
					>
				</svg>
			</div>
			<h1>{t().eyesOnTv}</h1>
			<p class="muted">{t().eyesOnTvBody}</p>
		</section>
	</Shell>
{:else}
	<Shell tone={s.myResult?.won ? 'win' : 'default'} testid="reveal-result">
		{#snippet label()}{roundLabel}{/snippet}
		<RoundOutcome {s} />
	</Shell>
{/if}

<style>
	.holding {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
		padding-bottom: var(--space-7);
	}
	h1 {
		font-size: clamp(1.75rem, 8vw, 2.25rem);
		text-wrap: balance;
	}
	.tv svg {
		width: 9rem;
		height: auto;
		overflow: visible;
	}
	.screen {
		fill: var(--color-surface);
		stroke: var(--color-text);
		stroke-width: 4;
	}
	.stand {
		fill: none;
		stroke: var(--color-text);
		stroke-width: 4;
		stroke-linecap: round;
	}
	.pin path {
		fill: var(--color-danger);
	}
	.pin circle {
		fill: var(--color-surface);
	}
	.pin {
		animation: bob 1.6s var(--ease-out) infinite;
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-5px);
		}
	}
</style>
