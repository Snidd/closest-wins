<!--
  Button (or link styled as a button when `href` is set). Extra attributes are passed through,
  so remote form helpers work: <Button {...myForm.fields.action.as('submit', 'go')}>Go</Button>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = HTMLButtonAttributes & {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** Stretch to the container width. */
		block?: boolean;
		/** Render an <a> instead of a <button>. */
		href?: string;
		/** Shows a busy state and disables the button. */
		busy?: boolean;
		children: Snippet;
	};

	let {
		variant = 'primary',
		size = 'md',
		block = false,
		href,
		busy = false,
		type = 'button',
		disabled,
		children,
		class: className,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a {href} class={['btn', variant, size, { block }, className]} aria-busy={busy || undefined}>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class={['btn', variant, size, { block, busy }, className]}
		disabled={disabled || busy}
		aria-busy={busy || undefined}
		{...rest}
	>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--tap-target);
		padding: 0 var(--space-5);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		font-weight: var(--weight-bold);
		font-size: var(--text-md);
		line-height: 1;
		text-decoration: none;
		cursor: pointer;
		user-select: none;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out),
			opacity var(--duration-fast);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.busy {
		cursor: progress;
	}

	.primary {
		background: var(--color-primary);
		color: var(--color-primary-contrast);
	}
	.primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-border);
	}
	.secondary:hover:not(:disabled) {
		background: var(--color-surface-2);
	}
	.danger {
		background: var(--color-danger);
		color: var(--color-danger-contrast);
	}
	.ghost {
		background: transparent;
		color: var(--color-primary);
	}
	.ghost:hover:not(:disabled) {
		background: var(--color-surface-2);
	}

	.sm {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
	}
	.lg {
		min-height: 3.5rem;
		font-size: var(--text-lg);
	}
	.xl {
		min-height: 4.25rem;
		font-size: var(--text-xl);
		border-radius: var(--radius-lg);
	}
	.block {
		display: flex;
		width: 100%;
	}
</style>
