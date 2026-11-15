<!--
  Whole-number setting: −/+ buttons around a numeric input, with quick-pick chips below.
  `value` is the raw text (so a half-typed number is not clobbered); the parent validates.
-->
<script lang="ts">
	type Preset = { value: string; label: string; sub?: string };
	type Props = {
		id: string;
		label: string;
		value: string;
		min: number;
		max: number;
		step?: number;
		presets?: Preset[];
		error?: string | null;
		decreaseLabel: string;
		increaseLabel: string;
	};

	let {
		id,
		label,
		value = $bindable(),
		min,
		max,
		step = 1,
		presets = [],
		error = null,
		decreaseLabel,
		increaseLabel
	}: Props = $props();

	const n = $derived(/^\s*\d+\s*$/.test(value) ? Number.parseInt(value, 10) : NaN);

	function bump(dir: 1 | -1) {
		if (Number.isNaN(n) || n > max || n < min) {
			// Out of range: step back into it first.
			value = String(Number.isNaN(n) ? (dir > 0 ? min : max) : n > max ? max : min);
			return;
		}
		const base = n;
		// Snap to the step grid first (32 → 35 / 30), then move.
		const snapped = dir > 0 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step;
		value = String(Math.min(max, Math.max(min, step === 1 ? base + dir : snapped)));
	}
</script>

<div class="stepper">
	<div class="head">
		<label for={id} class="label">{label}</label>
		<div class={['control', { invalid: !!error }]}>
			<button type="button" class="bump" aria-label={decreaseLabel} disabled={!Number.isNaN(n) && n <= min} onclick={() => bump(-1)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
			</button>
			<input
				{id}
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				autocomplete="off"
				bind:value
				aria-invalid={!!error || undefined}
				aria-describedby={error ? `${id}-error` : undefined}
				onfocus={(e) => e.currentTarget.select()}
			/>
			<button type="button" class="bump" aria-label={increaseLabel} disabled={!Number.isNaN(n) && n >= max} onclick={() => bump(1)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
			</button>
		</div>
	</div>
	{#if presets.length}
		<div class="presets">
			{#each presets as p (p.value)}
				<button
					type="button"
					class={['chip', { on: String(n) === p.value }]}
					aria-pressed={String(n) === p.value}
					onclick={() => (value = p.value)}
				>
					{p.label}
					{#if p.sub}<span class="sub">{p.sub}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
	{#if error}<p id="{id}-error" class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.stepper {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.label {
		font-weight: var(--weight-bold);
	}
	.control {
		display: flex;
		align-items: stretch;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		overflow: hidden;
	}
	.control:focus-within {
		border-color: var(--color-primary);
	}
	.control.invalid {
		border-color: var(--color-danger);
	}
	.bump {
		display: grid;
		place-items: center;
		width: 2.75rem;
		min-height: 2.75rem;
		border: 0;
		background: var(--color-surface-2);
		color: var(--color-text);
		cursor: pointer;
	}
	.bump:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.bump svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	input {
		width: 3.75rem;
		border: 0;
		background: transparent;
		text-align: center;
		font-size: max(1.125rem, 16px);
		font-weight: var(--weight-bold);
		font-variant-numeric: tabular-nums;
		outline: none;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		font-weight: var(--weight-bold);
		font-variant-numeric: tabular-nums;
		align-items: center;
		cursor: pointer;
	}
	.chip.on {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-primary-contrast);
	}
	.sub {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		opacity: 0.8;
	}
	.error {
		color: var(--color-danger);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
</style>
