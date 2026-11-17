<!-- An on/off setting: label (and hint) next to a switch. Local state only; the form submits a hidden input. -->
<script lang="ts">
	type Props = { label: string; hint?: string; checked: boolean; testid?: string };
	let { label, hint, checked = $bindable(), testid }: Props = $props();
	const uid = $props.id();
</script>

<div class="toggle">
	<div class="text">
		<span class="label" id="{uid}-label">{label}</span>
		{#if hint}<p class="hint" id="{uid}-hint">{hint}</p>{/if}
	</div>
	<button
		type="button"
		role="switch"
		class="switch"
		aria-checked={checked}
		aria-labelledby="{uid}-label"
		aria-describedby={hint ? `${uid}-hint` : undefined}
		onclick={() => (checked = !checked)}
		data-testid={testid}
	>
		<span class="knob" aria-hidden="true"></span>
	</button>
</div>

<style>
	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		font-weight: var(--weight-bold);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.switch {
		flex: none;
		position: relative;
		width: 3.25rem;
		height: 2rem;
		padding: 0;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		cursor: pointer;
		transition:
			background-color var(--duration-fast),
			border-color var(--duration-fast);
	}
	.switch[aria-checked='true'] {
		border-color: var(--color-primary);
		background: var(--color-primary);
	}
	.switch:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.knob {
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 1.45rem;
		height: 1.45rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		transition: transform var(--duration-fast);
	}
	.switch[aria-checked='true'] .knob {
		transform: translateX(1.25rem);
	}
</style>
