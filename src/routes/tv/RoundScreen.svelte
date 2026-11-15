<!--
  A running round: the clue is the hero; round N of M (or the sudden-death duel) on top, the
  countdown ring top-right, and who has locked in along the bottom. No answer exists here.
-->
<script lang="ts">
	import type { RoundState, TvSnapshot } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import Avatar from './Avatar.svelte';
	import Clue from './Clue.svelte';
	import JoinBug from './JoinBug.svelte';
	import PlayersBar from './PlayersBar.svelte';
	import TimerRing from './TimerRing.svelte';

	type Props = { snap: TvSnapshot & RoundState; offsetMs: number; now: number };
	let { snap, offsetMs, now }: Props = $props();
	const t = useT(tvDict);
	const tc = useT(common);

	const round = $derived(snap.round);
	const sd = $derived(round.isSuddenDeath);
	const duellists = $derived(sd ? snap.players.filter((p) => round.eligiblePlayerIds.includes(p.id)) : []);
	const totalSec = $derived((round.endsAt - round.startedAt) / 1000);
	const urgentBelow = $derived(Math.min(10, Math.max(3, Math.floor(totalSec / 3))));
	const secondsLeft = $derived(Math.ceil(Math.max(0, round.endsAt - now) / 1000));
	const urgent = $derived(secondsLeft > 0 && secondsLeft <= urgentBelow);
	const timeUp = $derived(secondsLeft === 0);
	const showDots = $derived(!sd && snap.game.totalRounds <= 20);
</script>

<section class={['round', { sd, urgent }]} data-testid="round-screen" data-sudden-death={sd}>
	<header class="head">
		<div class="bug-slot"><JoinBug game={snap.game} /></div>

		<div class="title">
			{#if sd}
				<p class="eyebrow sd-eyebrow" data-testid="sudden-death-label">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
					{t().suddenDeath}{round.number > 1 ? ` ${round.number}` : ''}
				</p>
				<p class="duel" data-testid="duel">
					{#each duellists as p, i (p.id)}
						{#if i > 0}<span class="vs">{t().versus}</span>{/if}
						<span class="duellist" style:--c={p.color}>
							<Avatar nickname={p.nickname} color={p.color} size="1.2em" ring />
							<span class="dn">{p.nickname}</span>
						</span>
					{/each}
				</p>
			{:else}
				<p class="eyebrow">{tc().round}</p>
				<p class="round-no" data-testid="round-label">
					<b>{round.number}</b><span class="of">&thinsp;/&thinsp;{snap.game.totalRounds}</span>
				</p>
				{#if showDots}
					<span class="dots" aria-hidden="true">
						{#each Array.from({ length: snap.game.totalRounds }, (_, i) => i) as i (i)}
							<i class={{ past: i < round.number - 1, now: i === round.number - 1 }}></i>
						{/each}
					</span>
				{/if}
			{/if}
		</div>

		<div class="timer-slot">
			<TimerRing startedAt={round.startedAt} endsAt={round.endsAt} {offsetMs} {urgentBelow} {now} />
		</div>
	</header>

	<div class="stage">
		{#key round.index}
			<Clue clue={round.clue} />
		{/key}
		{#if timeUp}
			<div class="time-up" data-testid="time-up"><span>{t().timeUp}</span></div>
		{/if}
	</div>

	<footer class="foot">
		<PlayersBar players={snap.players} lockedIds={snap.lockedPlayerIds} eligibleIds={round.eligiblePlayerIds} duel={sd} />
	</footer>
</section>

<style>
	.round {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 2.2vh;
		padding: 2.6vh 2.4vw 2.8vh;
	}
	.round::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		box-shadow: inset 0 0 0 0 rgb(255 50 70 / 0);
		transition: box-shadow 600ms;
	}
	.round.urgent::after {
		animation: edge 1s ease-out infinite;
	}
	@keyframes edge {
		from {
			box-shadow: inset 0 0 12vmin 0 rgb(255 50 70 / 0.38);
		}
		to {
			box-shadow: inset 0 0 6vmin 0 rgb(255 50 70 / 0.05);
		}
	}

	.head {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 2vw;
		min-height: 0;
	}
	.bug-slot {
		justify-self: start;
		align-self: start;
	}
	.timer-slot {
		justify-self: end;
		width: clamp(6rem, 17vh, 9rem);
		font-size: clamp(1rem, 2.6vh, 1.5rem);
	}
	.title {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		text-align: center;
		animation: drop 700ms var(--ease-out) both;
	}
	.eyebrow {
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--tv-gold);
	}
	.round-no {
		font-size: 2.2rem;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.round-no b {
		font-size: 1.6em;
		font-weight: 900;
	}
	.of {
		color: var(--tv-ink-3);
	}
	.dots {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}
	.dots i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.18);
	}
	.dots i.past {
		background: rgb(255 255 255 / 0.55);
	}
	.dots i.now {
		background: var(--tv-gold);
		box-shadow: 0 0 0.6rem var(--tv-gold);
	}

	.sd-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.9rem;
		border-radius: 999px;
		background: var(--tv-red);
		color: #fff;
		font-size: 1.05rem;
		animation: sd-pulse 1.6s ease-in-out infinite;
	}
	.sd-eyebrow svg {
		width: 1.1em;
		height: 1.1em;
		fill: currentColor;
	}
	@keyframes sd-pulse {
		50% {
			box-shadow: 0 0 1.6rem rgb(255 77 94 / 0.8);
		}
	}
	.duel {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem 0.9rem;
		margin-top: 0.4rem;
		font-size: 2rem;
		font-weight: 850;
	}
	.duellist {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		color: color-mix(in srgb, var(--c) 55%, white);
	}
	.dn {
		max-width: 9em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vs {
		font-size: 0.6em;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--tv-ink-3);
	}

	.stage {
		position: relative;
		min-height: 0;
	}
	.time-up {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(5 10 20 / 0.55);
		border-radius: 1.4rem;
		animation: fade 300ms both;
	}
	.time-up span {
		font-size: clamp(3rem, 12vh, 6rem);
		font-weight: 900;
		letter-spacing: -0.03em;
		color: #fff;
		text-shadow: 0 0.3rem 2rem rgb(0 0 0 / 0.6);
		animation: slam 500ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	@keyframes slam {
		from {
			transform: scale(1.6);
			opacity: 0;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-1rem);
		}
	}
</style>
