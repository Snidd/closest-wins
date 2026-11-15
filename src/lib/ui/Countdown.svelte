<!--
  Countdown to `endsAt` (epoch ms, server clock). `offsetMs` is `serverNow - Date.now()` taken
  when the snapshot arrived (see clockOffset in #lib/game/clock.ts). Renders whole seconds
  (m:ss from one minute up) and calls `onexpire` once when it reaches zero.
-->
<script lang="ts">
	import { remainingMs } from '#lib/game/clock.ts';

	type Props = {
		endsAt: number;
		offsetMs?: number;
		/** Seconds left at which the warning style kicks in. */
		warnBelow?: number;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** Accessible label, e.g. t().timeLeft. */
		label?: string;
		onexpire?: () => void;
	};

	let { endsAt, offsetMs = 0, warnBelow = 10, size = 'md', label, onexpire }: Props = $props();

	let now = $state(Date.now());

	$effect(() => {
		let frame = 0;
		let timer: ReturnType<typeof setTimeout>;
		const tick = () => {
			now = Date.now();
			const left = remainingMs(endsAt, offsetMs, now);
			if (left <= 0) return;
			// Wake just after the next whole-second boundary.
			timer = setTimeout(() => (frame = requestAnimationFrame(tick)), (left % 1000) + 15);
		};
		tick();
		return () => {
			clearTimeout(timer);
			cancelAnimationFrame(frame);
		};
	});

	const left = $derived(remainingMs(endsAt, offsetMs, now));
	const seconds = $derived(Math.ceil(left / 1000));
	const text = $derived(
		seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : String(seconds)
	);

	let expired = false;
	$effect(() => {
		if (left <= 0 && !expired) {
			expired = true;
			onexpire?.();
		} else if (left > 0) {
			expired = false;
		}
	});
</script>

<span
	class={['countdown', size, { warn: seconds <= warnBelow && seconds > 0, done: seconds <= 0 }]}
	role="timer"
	aria-label={label ? `${label}: ${text}` : text}
>
	{text}
</span>

<style>
	.countdown {
		display: inline-block;
		min-width: 2ch;
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-bold);
		line-height: 1;
		text-align: center;
		transition: color var(--duration-normal);
	}
	.sm {
		font-size: var(--text-lg);
	}
	.md {
		font-size: var(--text-2xl);
	}
	.lg {
		font-size: var(--text-4xl);
	}
	.xl {
		font-size: var(--text-5xl);
	}
	.warn {
		color: var(--color-danger);
		animation: pulse 1s ease-in-out infinite;
	}
	.done {
		color: var(--color-text-muted);
	}
	@keyframes pulse {
		50% {
			transform: scale(1.08);
		}
	}
</style>
