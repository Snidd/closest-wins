<!--
  Countdown pill with a draining ring. `leftMs` / `totalMs` come from the server clock (the
  parent ticks). Turns urgent in the last 10 seconds.
-->
<script lang="ts">
	type Props = { leftMs: number; totalMs: number; label: string };
	let { leftMs, totalMs, label }: Props = $props();

	const seconds = $derived(Math.ceil(leftMs / 1000));
	const text = $derived(
		seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : String(seconds)
	);
	const fraction = $derived(totalMs > 0 ? Math.min(1, Math.max(0, leftMs / totalMs)) : 0);
	const urgent = $derived(seconds <= 10 && seconds > 0);
	const critical = $derived(seconds <= 5 && seconds > 0);
	const R = 20;
	const C = 2 * Math.PI * R;
</script>

<div
	class={['timer', { urgent, critical, done: seconds <= 0 }]}
	role="timer"
	aria-label="{label}: {text}"
	data-testid="round-timer"
	data-seconds={seconds}
>
	<svg viewBox="0 0 48 48" aria-hidden="true">
		<circle class="track" cx="24" cy="24" r={R} />
		<circle
			class="ring"
			cx="24"
			cy="24"
			r={R}
			stroke-dasharray={C}
			stroke-dashoffset={C * (1 - fraction)}
		/>
	</svg>
	<span class="num" aria-hidden="true">{text}</span>
</div>

<style>
	.timer {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(8px);
		transition: background-color var(--duration-normal);
	}
	svg {
		position: absolute;
		inset: 0.2rem;
		width: calc(100% - 0.4rem);
		height: calc(100% - 0.4rem);
		transform: rotate(-90deg);
	}
	circle {
		fill: none;
		stroke-width: 4;
	}
	.track {
		stroke: var(--color-surface-2);
	}
	.ring {
		stroke: var(--color-primary);
		stroke-linecap: round;
		transition:
			stroke-dashoffset 250ms linear,
			stroke var(--duration-normal);
	}
	.num {
		position: relative;
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.urgent .ring {
		stroke: var(--color-danger);
	}
	.urgent .num {
		color: var(--color-danger);
		font-size: var(--text-xl);
	}
	.critical {
		background: color-mix(in srgb, var(--color-danger) 16%, var(--color-surface));
		animation: beat 1s ease-in-out infinite;
	}
	.done .num {
		color: var(--color-text-muted);
	}
	@keyframes beat {
		0%,
		100% {
			transform: scale(1);
		}
		15% {
			transform: scale(1.12);
		}
	}
</style>
