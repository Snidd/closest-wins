<!-- Surface container with optional heading. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = HTMLAttributes<HTMLElement> & {
		title?: string;
		padding?: 'none' | 'sm' | 'md' | 'lg';
		/** Elevated (shadow) instead of bordered. */
		raised?: boolean;
		children: Snippet;
	};

	let { title, padding = 'md', raised = false, children, class: className, ...rest }: Props = $props();
</script>

<section class={['card', `pad-${padding}`, { raised }, className]} {...rest}>
	{#if title}<h2 class="title">{title}</h2>{/if}
	{@render children()}
</section>

<style>
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.raised {
		border-color: transparent;
		box-shadow: var(--shadow-md);
	}
	.pad-none {
		padding: 0;
	}
	.pad-sm {
		padding: var(--space-3);
	}
	.pad-md {
		padding: var(--space-4);
	}
	.pad-lg {
		padding: var(--space-6);
	}
	.title {
		font-size: var(--text-lg);
	}
</style>
