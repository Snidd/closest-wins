<!--
  Round countdown synced to the server clock: whole seconds in the middle of a draining ring.
  The ring itself is a CSS animation (duration = round length, negative delay = elapsed), so it
  drains smoothly without per-frame JS; it is restarted whenever the clock offset changes.
  Turns urgent (red, pulsing) for the last `urgentBelow` seconds.
-->
<script lang="ts">
	import { remainingMs } from '#lib/game/clock.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';

	type Props = {
		startedAt: number;
		endsAt: number;
		offsetMs: number;
		urgentBelow: number;
		/** Server "now" (ticking). */
		now: number;
	};
	let { startedAt, endsAt, offsetMs, urgentBelow, now }: Props = $props();
	const tc = useT(common);

	const total = $derived(Math.max(1, endsAt - startedAt));
	// Never more than the round length (a slightly stale clock must not show 61 of 60).
	const left = $derived(Math.min(total, Math.max(0, endsAt - now)));
	const seconds = $derived(Math.ceil(left / 1000));
	const text = $derived(
		seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : String(seconds)
	);
	const urgent = $derived(seconds <= urgentBelow);
	// Elapsed at the moment the animation (re)starts; keyed on offset so it re-syncs.
	const elapsedAtStart = $derived.by(() => {
		void offsetMs;
		return total - remainingMs(endsAt, offsetMs);
	});

	const C = 2 * Math.PI * 45;
</script>

<div
	class={['timer', { urgent, done: seconds === 0 }]}
	role="timer"
	aria-label="{tc().timeLeft}: {text}"
	data-testid="countdown"
	data-seconds={seconds}
	style:--total="{total}ms"
	style:--elapsed="{-elapsedAtStart}ms"
>
	<svg viewBox="0 0 100 100" aria-hidden="true">
		<circle class="track" cx="50" cy="50" r="45" />
		{#key `${offsetMs}|${endsAt}`}
			<circle class="arc" cx="50" cy="50" r="45" style:stroke-dasharray={C} />
		{/key}
	</svg>
	{#key seconds}
		<span class="num">{text}</span>
	{/key}
</div>

<style>
	.timer {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(circle, rgb(10 20 42 / 0.9) 55%, rgb(10 20 42 / 0.4) 72%);
		box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.4);
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
		overflow: visible;
	}
	.track {
		fill: none;
		stroke: rgb(255 255 255 / 0.12);
		stroke-width: 7;
	}
	.arc {
		fill: none;
		stroke: var(--tv-gold);
		stroke-width: 7;
		stroke-linecap: round;
		stroke-dashoffset: 0;
		filter: drop-shadow(0 0 0.35rem rgb(255 194 61 / 0.55));
		animation: drain var(--total) linear var(--elapsed) both;
		transition:
			stroke 300ms,
			filter 300ms;
	}
	@keyframes drain {
		to {
			stroke-dashoffset: 282.743;
		}
	}
	.num {
		position: relative;
		font-size: 2.9em;
		font-weight: 850;
		line-height: 1;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
		color: var(--tv-ink);
	}
	.urgent .arc {
		stroke: var(--tv-red);
		filter: drop-shadow(0 0 0.5rem rgb(255 77 94 / 0.8));
	}
	.urgent .num {
		color: #ff7380;
		animation: beat 1s var(--ease-out) both;
	}
	.urgent {
		animation: glow 1s ease-out infinite;
	}
	.done .num {
		color: var(--tv-ink-3);
		animation: none;
	}
	.done {
		animation: none;
	}
	@keyframes beat {
		from {
			transform: scale(1.35);
		}
	}
	@keyframes glow {
		from {
			box-shadow:
				0 0 0 0 rgb(255 77 94 / 0.55),
				0 0.6rem 2rem rgb(0 0 0 / 0.4);
		}
		to {
			box-shadow:
				0 0 0 1.4rem rgb(255 77 94 / 0),
				0 0.6rem 2rem rgb(0 0 0 / 0.4);
		}
	}
</style>
