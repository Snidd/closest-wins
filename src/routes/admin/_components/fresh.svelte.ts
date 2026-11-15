/**
 * Kit keeps remote query results cached on the client until the query object is garbage
 * collected, so a page reached again by client-side navigation can start from data that predates
 * a mutation made on another page. `fresh()` wraps a query created during component init: if the
 * instance already had data when it was created (i.e. it came from that cache) and we got here by
 * client-side navigation, it is refreshed in the background. Fresh fetches are not repeated.
 *
 * ```ts
 * const playlistsQuery = fresh(() => listPlaylists());
 * const playlists = $derived(await playlistsQuery());
 * ```
 */
import { untrack } from 'svelte';
import type { RemoteQuery } from '$app/server';

/** Set by the admin layout's `beforeNavigate`: false until the first client-side navigation. */
export const navState = { client: false };

export function fresh<Q extends RemoteQuery<unknown> | null>(make: () => Q): () => Q {
	const q = $derived.by(() => {
		const inst = make();
		return { inst, cached: inst ? untrack(() => inst.ready) : false };
	});
	$effect(() => {
		const { inst, cached } = q;
		if (inst && cached && navState.client) untrack(() => void inst.refresh());
	});
	return () => q.inst;
}
