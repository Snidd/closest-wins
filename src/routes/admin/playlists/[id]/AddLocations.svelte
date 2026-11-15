<!-- Search the location library and add results to the playlist. -->
<script lang="ts">
	import { listLocations } from '#lib/remote/content.remote.ts';
	import type { LocationWithPhoto } from '#lib/server/content/locations.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import Thumb from '../../_components/Thumb.svelte';
	import MissingBadges from '../../_components/MissingBadges.svelte';
	import { fresh } from '../../_components/fresh.svelte.ts';

	type Props = { included: Set<string>; onadd: (location: LocationWithPhoto) => void };
	let { included, onadd }: Props = $props();
	const t = useT(admin);
	const locale = useLocale();

	let input = $state('');
	let query = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(() => (query = input.trim()), 200);
	}

	const resultsQuery = fresh(() => listLocations({ query: query || undefined, limit: 8 }));
	const results = $derived(await resultsQuery());
</script>

<div class="add">
	<label class="search">
		<span class="label">{t().addLocationsSearch}</span>
		<input
			type="search"
			bind:value={input}
			oninput={onInput}
			placeholder={t().searchLocations}
			onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
		/>
	</label>

	<ul class:stale={$effect.pending()} aria-busy={$effect.pending() > 0}>
		{#each results.items as l (l.id)}
			{@const inList = included.has(l.id)}
			{@const name = localized(l, 'name', locale()) || t().untitled}
			<li>
				<Thumb fileKey={l.photo?.fileKey} label={t().textClue} />
				<span class="name">
					<span class="title">{name}</span>
					<MissingBadges missing={l.missing} />
				</span>
				<Button
					size="sm"
					variant={inList ? 'ghost' : 'secondary'}
					disabled={inList}
					title={inList ? t().alreadyInPlaylist : undefined}
					aria-label={inList ? `${name}: ${t().alreadyInPlaylist}` : `${t().add}: ${name}`}
					onclick={() => onadd(l)}>{inList ? `✓ ${t().added}` : `+ ${t().add}`}</Button
				>
			</li>
		{:else}
			<li class="muted none">{t().noMatches}</li>
		{/each}
	</ul>
</div>

<style>
	.add {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.search {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	input {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: max(1rem, 16px);
	}
	input:focus {
		border-color: var(--color-primary);
		outline: none;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		transition: opacity var(--duration-fast);
	}
	.stale {
		opacity: 0.6;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-1);
		border-radius: var(--radius-md);
	}
	li:hover {
		background: var(--color-surface-2);
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}
	.title {
		font-weight: var(--weight-medium);
		overflow-wrap: anywhere;
	}
	.none {
		padding: var(--space-3);
	}
</style>
