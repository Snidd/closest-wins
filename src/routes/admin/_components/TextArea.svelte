<!--
  Labelled textarea with hint, validation issues and a character counter near the limit. Extra
  attributes go to the <textarea>, so remote form fields work:
  <TextArea label="…" {...form.fields.x.as('text')} issues={form.fields.x.issues()} />
-->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type Props = Omit<HTMLTextareaAttributes, 'value'> & {
		label: string;
		hideLabel?: boolean;
		hint?: string;
		issues?: { message: string }[] | undefined;
		value?: string | number | null;
		max?: number;
	};

	let { label, hideLabel = false, hint, issues, max, value, id: idProp, class: className, ...rest }: Props = $props();
	const uid = $props.id();
	const id = $derived(idProp ?? `ta-${uid}`);
	const invalid = $derived(!!issues?.length);
	const length = $derived(String(value ?? '').length);
</script>

<div class={['field', className]}>
	<label for={id} class={{ 'visually-hidden': hideLabel }}>{label}</label>
	<textarea
		{id}
		{value}
		class={{ invalid }}
		aria-invalid={invalid || undefined}
		aria-describedby={hint || invalid ? `${id}-desc` : undefined}
		{...rest}
	></textarea>
	<div id="{id}-desc" class="desc">
		{#if invalid}
			{#each issues as issue (issue.message)}<p class="issue">{issue.message}</p>{/each}
		{:else if hint}
			<p class="hint">{hint}</p>
		{/if}
		{#if max && length > max * 0.8}
			<p class={['count', { over: length > max }]}>{length}/{max}</p>
		{/if}
	</div>
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
	textarea {
		min-height: 5.5rem;
		padding: var(--space-2) var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: max(1rem, 16px);
		line-height: var(--leading-normal);
		resize: vertical;
		field-sizing: content;
		max-height: 20rem;
	}
	textarea:focus {
		border-color: var(--color-primary);
		outline: none;
	}
	textarea.invalid {
		border-color: var(--color-danger);
	}
	.desc {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 1.25rem;
	}
	.issue {
		color: var(--color-danger);
		font-size: var(--text-sm);
	}
	.hint,
	.count {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.count {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	.count.over {
		color: var(--color-danger);
	}
</style>
