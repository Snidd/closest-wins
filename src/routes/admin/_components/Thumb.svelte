<!-- Location thumbnail: the small photo variant, or a text-clue placeholder. -->
<script lang="ts">
	import { photoUrl } from '#lib/game/types.ts';

	type Props = { fileKey?: string | null; label: string; size?: 'sm' | 'md' };
	let { fileKey, label, size = 'sm' }: Props = $props();
</script>

<span class={['thumb', size]}>
	{#if fileKey}
		<img src={photoUrl(fileKey, 'sm')} alt="" loading="lazy" decoding="async" />
	{:else}
		<span class="text" aria-hidden="true">Aa</span>
		<span class="visually-hidden">{label}</span>
	{/if}
</span>

<style>
	.thumb {
		flex: none;
		display: inline-grid;
		place-items: center;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}
	.sm {
		width: 4rem;
		height: 3rem;
	}
	.md {
		width: 6rem;
		height: 4.5rem;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.text {
		font-weight: var(--weight-bold);
		font-family: Georgia, serif;
		font-size: var(--text-lg);
	}
</style>
