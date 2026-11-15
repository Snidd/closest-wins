<!-- A labelled segmented control (one of a few options), built on native radio inputs. -->
<script lang="ts" generics="V extends string">
	type Props = {
		label: string;
		hint?: string;
		value: V;
		options: { value: V; label: string }[];
	};
	let { label, hint, value = $bindable(), options }: Props = $props();
	const uid = $props.id();
</script>

<fieldset class="seg">
	<legend class="label">{label}</legend>
	<div class="track">
		{#each options as o (o.value)}
			<label class={['opt', { on: value === o.value }]}>
				<!-- `form` points nowhere: keeps the radio out of any surrounding remote form's data. -->
				<input type="radio" form="seg-detached" name="seg-{uid}" value={o.value} bind:group={value} />
				<span>{o.label}</span>
			</label>
		{/each}
	</div>
	{#if hint}<p class="hint">{hint}</p>{/if}
</fieldset>

<style>
	.seg {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.label {
		padding: 0;
		font-weight: var(--weight-bold);
	}
	.track {
		display: flex;
		gap: var(--space-1);
		padding: var(--space-1);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
	}
	.opt {
		flex: 1 1 0;
		min-width: 0;
		display: grid;
		place-items: center;
		min-height: 2.75rem;
		padding: var(--space-1) var(--space-2);
		border-radius: calc(var(--radius-md) - 0.15rem);
		font-weight: var(--weight-medium);
		text-align: center;
		line-height: var(--leading-tight);
		cursor: pointer;
		color: var(--color-text-muted);
		transition:
			background-color var(--duration-fast),
			color var(--duration-fast);
	}
	.opt.on {
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		box-shadow: var(--shadow-sm);
	}
	.opt:has(:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 1px;
	}
	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 1px;
		height: 1px;
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
</style>
