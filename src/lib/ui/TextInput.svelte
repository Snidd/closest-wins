<!--
  Labelled text input with hint and validation issues. Extra attributes go to the <input>, so
  remote form fields work: <TextInput label="Nickname" {...joinGame.fields.nickname.as('text')}
  issues={joinGame.fields.nickname.issues()} />
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = HTMLInputAttributes & {
		label: string;
		/** Visually hide the label (still read by screen readers). */
		hideLabel?: boolean;
		hint?: string;
		/** Validation issues, e.g. `form.fields.x.issues()`. */
		issues?: { message: string }[] | undefined;
		/** Large, centred, monospace (join / pairing codes). */
		code?: boolean;
		value?: HTMLInputAttributes['value'];
	};

	let {
		label,
		hideLabel = false,
		hint,
		issues,
		code = false,
		value = $bindable(),
		id: idProp,
		class: className,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const id = $derived(idProp ?? `input-${uid}`);
	const invalid = $derived(!!issues?.length);
</script>

<div class={['field', className]}>
	<label for={id} class={{ 'visually-hidden': hideLabel }}>{label}</label>
	<input
		{id}
		bind:value
		class={{ code, invalid }}
		aria-invalid={invalid || undefined}
		aria-describedby={hint || invalid ? `${id}-desc` : undefined}
		{...rest}
	/>
	{#if hint || invalid}
		<div id="{id}-desc" class="desc">
			{#if invalid}
				{#each issues as issue (issue.message)}
					<p class="issue">{issue.message}</p>
				{/each}
			{:else}
				<p class="hint">{hint}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	label {
		font-weight: var(--weight-medium);
		font-size: var(--text-sm);
	}
	input {
		min-height: var(--tap-target);
		padding: 0 var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		/* 16px+ prevents iOS from zooming into focused inputs. */
		font-size: max(1rem, 16px);
	}
	input:focus {
		border-color: var(--color-primary);
		outline: none;
	}
	input.invalid {
		border-color: var(--color-danger);
	}
	input.code {
		font-family: var(--font-mono);
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		letter-spacing: 0.3em;
		text-align: center;
		text-transform: uppercase;
		min-height: 3.75rem;
	}
	.issue {
		color: var(--color-danger);
		font-size: var(--text-sm);
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
