<!-- Playlist editor route: `/admin/playlists/new` creates, `/admin/playlists/<uuid>` edits. -->
<script lang="ts">
	import { getPlaylist } from '#lib/remote/content.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '../../_components/EmptyState.svelte';
	import PlaylistEditor from './PlaylistEditor.svelte';
	import { fresh } from '../../_components/fresh.svelte.ts';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const t = useT(admin);

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const isNew = $derived(params.id === 'new');
	const valid = $derived(!isNew && UUID.test(params.id));
	const playlistQuery = fresh(() => (valid ? getPlaylist(params.id) : null));
	const playlist = $derived(await playlistQuery());
</script>

{#if playlist}
	{#key playlist.id}<PlaylistEditor {playlist} />{/key}
{:else if isNew}
	{#key 'new'}<PlaylistEditor playlist={null} />{/key}
{:else}
	<EmptyState title={t().notFoundPlaylist}>
		<Button href="/admin/playlists" variant="secondary">← {t().playlists}</Button>
	</EmptyState>
{/if}
