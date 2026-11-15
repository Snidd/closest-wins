<!-- Location editor route: `/admin/locations/new` creates, `/admin/locations/<uuid>` edits. -->
<script lang="ts">
	import { getLocation } from '#lib/remote/content.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '../../_components/EmptyState.svelte';
	import LocationEditor from './LocationEditor.svelte';
	import { fresh } from '../../_components/fresh.svelte.ts';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const t = useT(admin);

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const isNew = $derived(params.id === 'new');
	const valid = $derived(!isNew && UUID.test(params.id));
	const locationQuery = fresh(() => (valid ? getLocation(params.id) : null));
	const location = $derived(await locationQuery());
</script>

{#if location}
	{#key location.id}<LocationEditor {location} />{/key}
{:else if isNew}
	{#key 'new'}<LocationEditor location={null} />{/key}
{:else}
	<EmptyState title={t().notFoundLocation}>
		<Button href="/admin/locations" variant="secondary">← {t().locations}</Button>
	</EmptyState>
{/if}
