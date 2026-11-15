<!--
  Hold-to-confirm button for actions that must not happen by accident (ending a round early).
  Press and hold for `duration` ms (pointer, or Space/Enter); letting go early cancels. A quick tap
  just nudges the hint.
-->
<script lang="ts">
	type Props = {
		label: string;
		busyLabel: string;
		hint?: string;
		busy?: boolean;
		disabled?: boolean;
		duration?: number;
		onconfirm: () => void;
		testid?: string;
	};
	let { label, busyLabel, hint, busy = false, disabled = false, duration = 1000, onconfirm, testid }: Props = $props();

	let holding = $state(false);
	let nudge = $state(0);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let startedAt = 0;

	function start() {
		if (busy || disabled || holding) return;
		holding = true;
		startedAt = performance.now();
		timer = setTimeout(() => {
			timer = null;
			holding = false;
			navigator.vibrate?.(30);
			onconfirm();
		}, duration);
	}

	function stop() {
		if (!holding) return;
		holding = false;
		if (timer) clearTimeout(timer);
		timer = null;
		if (performance.now() - startedAt < 250) nudge++;
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
	});
</script>

<div class="wrap">
	<button
		type="button"
		class={['hold', { holding, busy }]}
		style:--hold-ms="{duration}ms"
		disabled={disabled || busy}
		aria-busy={busy || undefined}
		aria-describedby={hint ? 'hold-hint' : undefined}
		data-testid={testid}
		onpointerdown={(e) => {
			if (e.button !== 0) return;
			e.currentTarget.setPointerCapture(e.pointerId);
			start();
		}}
		onpointerup={stop}
		onpointercancel={stop}
		onlostpointercapture={stop}
		onkeydown={(e) => {
			if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
				e.preventDefault();
				start();
			}
		}}
		onkeyup={(e) => {
			if (e.key === ' ' || e.key === 'Enter') stop();
		}}
		onblur={stop}
		oncontextmenu={(e) => e.preventDefault()}
	>
		<span class="text">{busy ? busyLabel : label}</span>
		<!-- The label comes from CSS so it is not part of the button's text twice. -->
		<span class="fill" aria-hidden="true" data-label={busy ? busyLabel : label}></span>
	</button>
	{#if hint}
		{#key nudge}
			<p id="hold-hint" class={['hint', { nudged: nudge > 0 }]}>{hint}</p>
		{/key}
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.hold {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 3.5rem;
		padding: 0 var(--space-5);
		border: 2px solid var(--color-danger);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-danger);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		cursor: pointer;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.hold:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* The filled layer repeats the label in the contrast colour and is revealed left to right. */
	.fill {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-danger);
		color: var(--color-danger-contrast);
		clip-path: inset(0 100% 0 0);
	}
	.fill::after {
		content: attr(data-label);
	}
	.holding .fill {
		clip-path: inset(0 0 0 0);
		transition: clip-path var(--hold-ms) linear;
	}
	.busy .fill {
		clip-path: inset(0 0 0 0);
	}
	.hint {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.hint.nudged {
		animation: nudge 0.4s;
		color: var(--color-danger);
	}
	@keyframes nudge {
		25% {
			transform: translateX(-4px);
		}
		75% {
			transform: translateX(4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.holding .fill {
			/* The global reduced-motion rule would make the fill instant; it is a timer, keep it. */
			transition-duration: var(--hold-ms) !important;
		}
	}
</style>
