<!--
  Renders the current `PlayerStateValue`. One component per phase; the round screen is keyed by
  round index so every round starts with a fresh map at the world view.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { RemoteLiveQuery } from '$app/server';
	import type { PlayerStateValue } from '#lib/game/types.ts';
	import { ServerClock, useWakeLock } from './play.svelte.ts';
	import ConnectionBadge from './ConnectionBadge.svelte';
	import Gate from './Gate.svelte';
	import Lobby from './Lobby.svelte';
	import RoundScreen from './RoundScreen.svelte';
	import RevealScreen from './RevealScreen.svelte';
	import StandingsScreen from './StandingsScreen.svelte';
	import FinishedScreen from './FinishedScreen.svelte';

	type Props = { live: RemoteLiveQuery<PlayerStateValue>; code: string };
	let { live, code }: Props = $props();

	const s = $derived(await live);

	const clock = new ServerClock();
	$effect.pre(() => {
		if (s.status === 'playing') clock.observe(s.serverNow);
	});

	const kicked = $derived(s.status === 'kicked');
	const phase = $derived(s.status === 'playing' ? s.phase : s.status);

	// Not joined (no or invalid token): the join page. Replace, so Back does not bounce here.
	$effect(() => {
		if (s.status === 'notJoined') void goto(`/join/${code}`, { replaceState: true });
	});

	/** Asks the server for a fresh snapshot (after a failed command, or waking up). */
	function resync() {
		void live.reconnect().catch(() => {});
	}

	// The stream only ends for good when the player is kicked. If it ends any other way (server
	// restart, proxy timeout), open it again.
	$effect(() => {
		if (!live.done || kicked) return;
		const id = setTimeout(resync, 1000);
		return () => clearTimeout(id);
	});

	// Phones suspend pages while locked or in the background; the connection may be dead without
	// anyone noticing. Coming back after more than a moment: reopen the stream for a fresh
	// snapshot (the countdown recomputes from the clock by itself).
	$effect(() => {
		let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				hiddenAt = Date.now();
			} else if (hiddenAt && Date.now() - hiddenAt > 2000 && !kicked) {
				hiddenAt = 0;
				resync();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	});

	useWakeLock(() => phase === 'round' || phase === 'reveal');
</script>

{#if s.status === 'playing'}
	<div class="app" data-phase={s.phase} data-testid="player-app">
		{#if s.phase === 'lobby'}
			<Lobby {s} />
		{:else if s.phase === 'round'}
			{#key `${s.game.id}:${s.round.index}`}
				<RoundScreen {s} {clock} onresync={resync} />
			{/key}
		{:else if s.phase === 'reveal'}
			<RevealScreen {s} {clock} />
		{:else if s.phase === 'standings'}
			<StandingsScreen {s} />
		{:else}
			<FinishedScreen {s} />
		{/if}
	</div>
{:else if s.status === 'notJoined'}
	<Gate kind="redirecting" {code} />
{:else}
	<Gate kind={s.status} {code} />
{/if}

{#if !kicked}
	<ConnectionBadge connected={live.connected} />
{/if}

<style>
	.app {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
	}
</style>
