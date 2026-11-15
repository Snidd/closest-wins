<!--
  The big screen (display only). One live stream (`tvState`) drives everything:
  unregistered → registerTv() + reconnect → pairing code → (host pairs) game snapshots on the
  same connection → finished (+ next pairing code) → next game.

  Language: the game's language once paired, the browser's before. Always dark (TV look).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';
	import { registerTv, tvState } from '#lib/remote/game.remote.ts';
	import { clockOffset } from '#lib/game/clock.ts';
	import type { TvSnapshot, TvStateValue } from '#lib/game/types.ts';
	import { provideLocale, useLocale, useT } from '#lib/i18n/context.ts';
	import type { Locale } from '#lib/i18n/locale.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import Backdrop from './Backdrop.svelte';
	import FinishedScreen from './FinishedScreen.svelte';
	import LobbyScreen from './LobbyScreen.svelte';
	import PairingScreen from './PairingScreen.svelte';
	import RevealScreen from './RevealScreen.svelte';
	import RoundScreen from './RoundScreen.svelte';
	import StandingsScreen from './StandingsScreen.svelte';
	import { serverClock, useWakeLock } from './tv.svelte.ts';

	// Contexts must be set before the first `await`.
	// Game language once paired, device language before.
	const deviceLocale = useLocale();
	let gameLocale = $state<Locale | null>(null);
	provideLocale(() => gameLocale ?? deviceLocale());
	const t = useT(tvDict);
	const tc = useT(common);

	const tv = tvState();
	// SSR renders the first value; on the client this resolves at once from the hydrated data.
	const initial: TvStateValue = await tv;
	const value = $derived<TvStateValue>(tv.current ?? initial);
	const snap = $derived<TvSnapshot | null>(value.status === 'paired' ? value : null);
	$effect.pre(() => {
		gameLocale = snap?.game.language ?? null;
	});
	gameLocale = untrack(() => (initial.status === 'paired' ? initial.game.language : null));

	// --- Clock --------------------------------------------------------------------------------
	let offsetMs = $state(0);
	$effect.pre(() => {
		const v = tv.current;
		if (v && 'serverNow' in v) offsetMs = clockOffset(v.serverNow);
	});
	const clock = serverClock(() => offsetMs, 200);

	// --- Registration and stream recovery ------------------------------------------------------
	let registering = false;
	let registerAttempt = $state(0);
	$effect(() => {
		void registerAttempt;
		if (value.status !== 'unregistered' || registering) return;
		registering = true;
		registerTv()
			.then(() => tv.reconnect())
			.then(() => (registering = false))
			.catch(() => {
				// Server unreachable: try again shortly.
				setTimeout(() => {
					registering = false;
					registerAttempt++;
				}, 3000);
			});
	});

	// Kit retries network drops itself; if the stream ends or fails for good, reopen it.
	let recoverAttempt = $state(0);
	$effect(() => {
		void recoverAttempt;
		if (value.status === 'unregistered') return;
		if (!tv.done && !tv.error) return;
		const delay = Math.min(30_000, 2000 * 2 ** untrack(() => recoverAttempt));
		const id = setTimeout(() => {
			recoverAttempt++;
			void tv.reconnect().catch(() => {});
		}, delay);
		return () => clearTimeout(id);
	});
	$effect(() => {
		if (tv.connected) recoverAttempt = 0;
	});

	// Only show the indicator for a real outage, not the first connect after load.
	let offline = $state(false);
	$effect(() => {
		if (tv.connected) {
			offline = false;
			return;
		}
		const id = setTimeout(() => (offline = true), 2500);
		return () => clearTimeout(id);
	});

	// --- Screen ---------------------------------------------------------------------------------
	useWakeLock();
	$effect(() => {
		const html = document.documentElement;
		const prev = html.dataset.theme;
		html.dataset.theme = 'dark';
		return () => {
			if (prev) html.dataset.theme = prev;
			else delete html.dataset.theme;
		};
	});

	const host = $derived(page.url.host);
	const phase = $derived(snap?.phase ?? value.status);
	/** One key per visual screen; a change crossfades. */
	const screenKey = $derived.by(() => {
		if (!snap) return 'pairing';
		if (snap.phase === 'round') return `round-${snap.round.index}`;
		if (snap.phase === 'reveal' || snap.phase === 'standings') return `${snap.phase}-${snap.result.round.index}`;
		return `${snap.phase}-${snap.game.id}`;
	});
	const sd = $derived(
		(snap?.phase === 'round' && snap.round.isSuddenDeath) ||
			(snap?.phase === 'standings' && snap.next.kind === 'suddenDeath')
	);
	const tone = $derived(sd ? 'danger' : snap?.phase === 'finished' ? 'gold' : 'normal');
	const globe = $derived(!snap ? 'center' : snap.phase === 'lobby' ? 'right' : null);
</script>

<svelte:head>
	<title>{tc().appName} · {t().bigScreen}</title>
</svelte:head>

<div
	class={['tv', { sd }]}
	lang={snap?.game.language ?? deviceLocale()}
	data-testid="tv"
	data-status={value.status}
	data-phase={phase}
	data-game-id={snap?.game.id ?? ''}
	data-connected={tv.connected}
>
	<Backdrop {globe} {tone} />

	{#key screenKey}
		<!-- CSS fade-in only: no outros, so a burst of phase changes can never leave a stale screen behind. -->
		<div class="screen">
			{#if !snap}
				<PairingScreen code={value.status === 'pairing' ? value.pairingCode : null} {host} />
			{:else if snap.phase === 'lobby'}
				<LobbyScreen {snap} />
			{:else if snap.phase === 'round'}
				<RoundScreen {snap} {offsetMs} now={clock.now} />
			{:else if snap.phase === 'reveal'}
				<RevealScreen game={snap.game} players={snap.players} result={snap.result} standings={snap.standings} {offsetMs} />
			{:else if snap.phase === 'standings'}
				<StandingsScreen {snap} />
			{:else if snap.phase === 'finished'}
				<FinishedScreen {snap} {host} />
			{/if}
		</div>
	{/key}

	{#if offline}
		<div class="offline" role="status" data-testid="tv-offline" transition:fade={{ duration: 300 }}>
			<span class="pulse" aria-hidden="true"></span>{t().reconnecting}
		</div>
	{/if}
</div>

<style>
	.tv {
		/* TV palette (always dark, rich). Also overrides the app tokens so shared components match. */
		--tv-bg-0: #040914;
		--tv-bg-1: #0a1630;
		--tv-bg-2: #13265a;
		--tv-glow-a: rgb(46 112 255 / 0.35);
		--tv-glow-b: rgb(0 200 220 / 0.22);
		--tv-ink: #f4f7fc;
		--tv-ink-2: #c0cbe0;
		--tv-ink-3: #8593b0;
		--tv-gold: #ffc23d;
		--tv-gold-2: #ff9f1c;
		--tv-red: #ff4d5e;
		--tv-glass: rgb(14 26 52 / 0.78);
		--tv-line: rgb(255 255 255 / 0.11);

		--color-bg: var(--tv-bg-0);
		--color-surface: #0f1d3a;
		--color-surface-2: #172a50;
		--color-text: var(--tv-ink);
		--color-text-muted: var(--tv-ink-3);
		--color-border: #2a4058;
		--color-accent: var(--tv-gold);
		--color-accent-contrast: #1d1400;
		--color-danger: #ff5a67;
		--color-ocean: #0d2338;

		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--tv-bg-0);
		color: var(--tv-ink);
		color-scheme: dark;
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
		user-select: none;
	}
	.tv.sd {
		--tv-bg-0: #0d0410;
		--tv-bg-1: #2a0a1c;
		--tv-bg-2: #5a1230;
		--tv-glass: rgb(40 12 30 / 0.8);
	}
	.screen {
		position: absolute;
		inset: 0;
		animation: screen-in 550ms var(--ease-out) both;
	}
	@keyframes screen-in {
		from {
			opacity: 0;
		}
	}
	.tv :global(h1),
	.tv :global(p) {
		margin: 0;
	}

	.offline {
		position: absolute;
		z-index: 50;
		left: 50%;
		bottom: 1.2rem;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 1rem;
		border-radius: 999px;
		background: rgb(30 10 16 / 0.85);
		border: 1px solid rgb(255 90 103 / 0.5);
		color: #ffd0d5;
		font-size: 0.95rem;
		font-weight: 700;
		backdrop-filter: blur(8px);
	}
	.pulse {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--tv-red);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
			transform: scale(0.7);
		}
	}
</style>
