<!--
  Host controller for one game, driven entirely by the `hostState` live query.

  One primary action per phase lives in the dock at the bottom (thumb reach); destructive actions
  (kick, end game) are in the menu sheet, and "End round now" is hold-to-confirm.

  Double taps: the engine has no guard against a repeated `nextRound`, so every action button
  disables itself from the tap until the snapshot's phase signature changes (or the command
  fails), and a freshly shown primary button ignores taps for a moment (ARM_MS) so the second
  tap of a double tap cannot land on the next phase's button. A 409 (the state already moved on)
  is resolved quietly by trusting the next snapshot; other failures show a retry.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import {
		endGame,
		endRoundNow,
		hostState,
		kickPlayer,
		nextRound,
		skipReveal,
		startRound
	} from '#lib/remote/game.remote.ts';
	import type { HostSnapshot } from '#lib/game/types.ts';
	import { clockOffset } from '#lib/game/clock.ts';
	import { revealDoneAt } from '#lib/map/reveal.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import Button from '#lib/ui/Button.svelte';
	import mark from '#lib/assets/favicon.svg';
	import HoldButton from './HoldButton.svelte';
	import LobbyView from './LobbyView.svelte';
	import RoundView from './RoundView.svelte';
	import RevealView from './RevealView.svelte';
	import StandingsView from './StandingsView.svelte';
	import FinishedView from './FinishedView.svelte';
	import MenuSheet from './MenuSheet.svelte';
	import { listNames, playerLookup } from './types.ts';

	const t = useT(host);
	const c = useT(common);
	const locale = useLocale();

	/** A new primary button ignores taps this long after the phase changed. */
	const ARM_MS = 650;
	/** If a command succeeded but no new snapshot arrived by then, unlock and resync. */
	const SETTLE_MS = 6000;
	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	const gameId = $derived(page.params.gameId ?? '');
	const validId = $derived(UUID.test(gameId));
	const live = $derived(validId ? hostState(gameId) : null);

	// Render the live state only after mount, so SSR and hydration agree (the stream's first
	// value may already be in the hydration data).
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	const snap = $derived(mounted ? (live?.current ?? null) : null);
	const errorStatus = $derived(
		mounted && live?.error ? ((live.error as { status?: number }).status ?? 500) : null
	);
	const connected = $derived(mounted && !!live?.connected);
	const offsetMs = $derived(snap ? clockOffset(snap.serverNow) : 0);
	const tvUrl = $derived(snap ? `${new URL(snap.game.joinUrl).origin}/tv` : `${page.url.origin}/tv`);

	let sessionExpired = $state(false);
	const fatal = $derived<'notFound' | 'session' | null>(
		!validId || errorStatus === 404 || errorStatus === 400
			? 'notFound'
			: errorStatus === 401 || errorStatus === 403 || sessionExpired
				? 'session'
				: null
	);

	// --- Phase signature + action guard ------------------------------------------------------

	function signature(x: HostSnapshot): string {
		switch (x.phase) {
			case 'round':
				return `round:${x.round.index}`;
			case 'reveal':
				return `reveal:${x.result.round.index}:${x.result.skipped}`;
			case 'standings':
				return `standings:${x.result.round.index}`;
			default:
				return x.phase;
		}
	}
	const sig = $derived(snap ? signature(snap) : '');

	type Action = 'start' | 'endRound' | 'skip' | 'next' | 'endGame';
	let pending = $state<{ action: Action; sig: string } | null>(null);
	let failure = $state<{ message: string; retry: () => void } | null>(null);
	let armed = $state(false);

	$effect(() => {
		void sig;
		untrack(() => {
			if (pending && pending.sig !== sig) pending = null;
			failure = null;
		});
		armed = false;
		const timer = setTimeout(() => (armed = true), ARM_MS);
		return () => clearTimeout(timer);
	});

	function statusOf(e: unknown): number | undefined {
		const err = e as { status?: number; body?: { status?: number } } | null;
		return err?.status ?? err?.body?.status;
	}

	function failed(e: unknown, retry: () => void) {
		const status = statusOf(e);
		if (status === 409) {
			// The state already moved on (another tab, the timer, a race): trust the stream.
			if (!live?.connected) void live?.reconnect();
			return;
		}
		if (status === 401) {
			sessionExpired = true;
			return;
		}
		failure = {
			message: typeof navigator !== 'undefined' && !navigator.onLine ? t().commandFailedOffline : t().commandFailed,
			retry
		};
	}

	async function act(action: Action, run: () => Promise<void>, { needsArm = true } = {}) {
		if (pending || (needsArm && !armed) || !snap) return;
		const at = sig;
		pending = { action, sig: at };
		failure = null;
		try {
			await run();
			setTimeout(() => {
				if (pending?.action === action && pending.sig === at) {
					pending = null;
					void live?.reconnect();
				}
			}, SETTLE_MS);
		} catch (e) {
			if (pending?.action === action && pending.sig === at) pending = null;
			failed(e, () => act(action, run, { needsArm: false }));
		}
	}
	const busy = (action: Action) => pending?.action === action;

	const onStart = () => act('start', () => startRound({ gameId }));
	const onEndRound = () => act('endRound', () => endRoundNow({ gameId }), { needsArm: false });
	const onSkip = () => act('skip', () => skipReveal({ gameId }));
	const onNext = () => act('next', () => nextRound({ gameId }));
	const onEndGame = () => act('endGame', () => endGame({ gameId }), { needsArm: false });

	// Kicks are per player; a row stays busy until the player disappears from the snapshot.
	const kicking = new SvelteSet<string>();
	$effect(() => {
		const ids = new Set(snap?.players.map((p) => p.id) ?? []);
		for (const id of untrack(() => [...kicking])) if (!ids.has(id)) kicking.delete(id);
	});
	async function kick(playerId: string) {
		if (kicking.has(playerId)) return;
		kicking.add(playerId);
		failure = null;
		try {
			await kickPlayer({ gameId, playerId });
			setTimeout(() => kicking.delete(playerId), SETTLE_MS);
		} catch (e) {
			kicking.delete(playerId);
			if (statusOf(e) === 404) return; // already gone
			failed(e, () => kick(playerId));
		}
	}

	// --- Reveal progress (the TV's choreography, from server timestamps) ----------------------

	let now = $state(Date.now());
	$effect(() => {
		if (snap?.phase !== 'reveal') return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});
	const reveal = $derived.by(() => {
		if (snap?.phase !== 'reveal') return { done: true, progress: 1 };
		const r = snap.result;
		const doneAt = revealDoneAt(r);
		const serverNow = now + offsetMs;
		const span = Math.max(1, doneAt - r.revealStartedAt);
		return {
			done: serverNow >= doneAt,
			progress: Math.min(1, Math.max(0, (serverNow - r.revealStartedAt) / span))
		};
	});

	// --- Connection: indicator and recovery --------------------------------------------------

	let showOffline = $state(false);
	$effect(() => {
		if (connected || !snap) {
			showOffline = false;
			return;
		}
		// Brief reconnects (e.g. after a command) should not flash the indicator.
		const timer = setTimeout(() => (showOffline = true), 1500);
		return () => clearTimeout(timer);
	});

	// A stream that failed (5xx) or ended stops by itself; retry with backoff unless it is fatal.
	let retryAttempt = 0;
	$effect(() => {
		if (!mounted || !live || fatal) return;
		const broken = !!live.error || (live.done && !live.connected);
		if (!broken) {
			if (live.connected) retryAttempt = 0;
			return;
		}
		const delay = Math.min(15_000, 1000 * 2 ** retryAttempt++);
		const timer = setTimeout(() => void live.reconnect(), delay);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		// After the phone slept or the tab was in the background the stream may be stale or
		// silently dead: reconnect for a fresh snapshot.
		let hiddenAt = 0;
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				hiddenAt = Date.now();
			} else if (hiddenAt && Date.now() - hiddenAt > 1500) {
				hiddenAt = 0;
				void live?.reconnect();
			}
		};
		const onOnline = () => {
			if (!live?.connected) void live?.reconnect();
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('online', onOnline);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('online', onOnline);
		};
	});

	// --- Menu ------------------------------------------------------------------------------

	let menuOpen = $state(false);
	$effect(() => {
		if (snap?.phase === 'finished') untrack(() => (menuOpen = false));
	});

	// --- Labels ------------------------------------------------------------------------------

	const title = $derived.by(() => {
		if (!snap) return c().appName;
		switch (snap.phase) {
			case 'lobby':
				return t().phase_lobby;
			case 'round':
				return snap.round.isSuddenDeath
					? t().suddenDeathN(snap.round.number)
					: t().roundOf(snap.round.number, snap.game.totalRounds);
			case 'reveal':
				return snap.result.round.isSuddenDeath
					? t().suddenDeathN(snap.result.round.number)
					: t().roundOf(snap.result.round.number, snap.game.totalRounds);
			case 'standings':
				return t().standingsTitle;
			case 'finished':
				return t().phase_finished;
		}
	});
	const isSuddenDeath = $derived(
		(snap?.phase === 'round' && snap.round.isSuddenDeath) ||
			((snap?.phase === 'reveal' || snap?.phase === 'standings') && snap.result.round.isSuddenDeath)
	);

	const nextLabel = $derived.by(() => {
		if (snap?.phase !== 'standings') return '';
		const next = snap.next;
		if (next.kind === 'round') return t().nextRoundN(next.number);
		if (next.kind === 'suddenDeath') {
			const who = playerLookup(snap.players, snap.standings);
			return `${t().startSuddenDeath}: ${listNames(next.eligiblePlayerIds.map((id) => who(id).nickname), locale())}`;
		}
		return t().showFinalResult;
	});

	const conn = $derived(!snap ? 'connecting' : connected || !showOffline ? 'live' : 'offline');
</script>

<svelte:head>
	<title>{snap ? `${snap.game.joinCode} · ${title}` : t().newGame} · {c().appName}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if fatal}
	<main class="state" data-testid="host-fatal" data-state={fatal}>
		<img src={mark} alt="" width="48" height="48" />
		{#if fatal === 'notFound'}
			<h1>{t().gameNotFoundTitle}</h1>
			<p class="muted">{t().gameNotFoundBody}</p>
			<Button href="/host" size="lg" block>{t().allGames}</Button>
		{:else}
			<h1>{t().sessionExpiredTitle}</h1>
			<p class="muted">{t().sessionExpiredBody}</p>
			<Button href="/login?next={encodeURIComponent(page.url.pathname)}" size="lg" block>{c().login}</Button>
		{/if}
	</main>
{:else if !snap}
	<main class="state" data-testid="host-loading">
		{#if errorStatus}
			<img src={mark} alt="" width="48" height="48" />
			<h1>{t().loadFailedTitle}</h1>
			<p class="muted">{t().loadFailedBody}</p>
			<Button size="lg" block onclick={() => live?.reconnect()}>{c().retry}</Button>
			<a class="back-link" href="/host">{t().allGames}</a>
		{:else}
			<span class="spinner" aria-hidden="true"></span>
			<p class="muted">{t().connecting}</p>
		{/if}
	</main>
{:else}
	<div class="ctl" data-phase={snap.phase} data-testid="host-controller">
		<header class="top">
			<a class="icon-btn" href="/host" aria-label={t().allGames}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
			</a>
			<div class="title">
				<h1 data-testid="phase-title">
					{#if isSuddenDeath}<span class="sd-mark" aria-hidden="true">⚡</span>{/if}{title}
				</h1>
				<p class="sub">
					<span class="code" data-testid="header-code">{snap.game.joinCode}</span>
					<span
						class={['conn', conn]}
						role="status"
						data-testid="connection"
						data-state={conn}
						title={conn === 'live' ? t().live : c().reconnecting}
					>
						<span class="conn-dot" aria-hidden="true"></span>
						{conn === 'live' ? t().live : c().reconnecting}
					</span>
					{#if snap.phase !== 'finished'}
						<span
							class={['tv-dot', snap.tv.paired ? (snap.tv.connected ? 'on' : 'lost') : 'none']}
							title={snap.tv.paired ? (snap.tv.connected ? t().tvConnected : t().tvDisconnected) : t().tvNotPaired}
							data-testid="tv-indicator"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></svg>
							<span class="visually-hidden">
								{snap.tv.paired ? (snap.tv.connected ? t().tvConnected : t().tvDisconnected) : t().tvNotPaired}
							</span>
						</span>
					{/if}
				</p>
			</div>
			<button type="button" class="icon-btn" aria-label={t().menu} aria-haspopup="dialog" onclick={() => (menuOpen = true)} data-testid="menu-button">
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg
				>
			</button>
		</header>

		<main class="body">
			{#if snap.phase === 'lobby'}
				<LobbyView {snap} {tvUrl} {kicking} onkick={kick} />
			{:else if snap.phase === 'round'}
				<RoundView {snap} {offsetMs} locale={locale()} />
			{:else if snap.phase === 'reveal'}
				<RevealView {snap} locale={locale()} revealDone={reveal.done} progress={reveal.progress} />
			{:else if snap.phase === 'standings'}
				<StandingsView {snap} locale={locale()} />
			{:else}
				<FinishedView {snap} locale={locale()} />
			{/if}
		</main>

		<footer class="dock" data-testid="dock">
			{#if failure}
				<div class="failure" role="alert" data-testid="command-failure">
					<span>{failure.message}</span>
					<button type="button" onclick={() => failure?.retry()}>{c().retry}</button>
				</div>
			{/if}

			{#key sig}
				<div class={['actions', { arming: !armed }]}>
					{#if snap.phase === 'lobby'}
						{#if !snap.tv.connected && snap.players.length > 0}
							<p class="note warn" data-testid="no-tv-warning">{t().startWithoutTv}</p>
						{/if}
						<Button
							size="xl"
							block
							disabled={snap.players.length === 0}
							busy={busy('start')}
							onclick={onStart}
							data-testid="primary-action"
						>
							{busy('start') ? t().starting : snap.players.length === 0 ? t().waitingForPlayers : t().startGame}
						</Button>
					{:else if snap.phase === 'round'}
						<HoldButton
							label={t().holdToEnd}
							busyLabel={t().ending}
							hint={t().endsByItself}
							busy={busy('endRound')}
							onconfirm={onEndRound}
							testid="end-round"
						/>
					{:else if snap.phase === 'reveal'}
						{#if !reveal.done}
							<Button variant="secondary" size="md" block busy={busy('skip')} disabled={!!pending} onclick={onSkip} data-testid="skip-reveal">
								{busy('skip') ? t().skipping : t().skipAnimation}
							</Button>
						{/if}
						<Button size="xl" block busy={busy('next')} disabled={!!pending} onclick={onNext} data-testid="primary-action">
							{t().showStandings}
						</Button>
					{:else if snap.phase === 'standings'}
						<Button
							size="xl"
							block
							variant="primary"
							class={snap.next.kind === 'suddenDeath' ? 'sd-button' : undefined}
							busy={busy('next')}
							onclick={onNext}
							data-testid="primary-action"
						>
							{nextLabel}
						</Button>
					{:else}
						<Button href="/host" size="xl" block data-testid="primary-action">{t().newGame}</Button>
					{/if}
				</div>
			{/key}
		</footer>
	</div>

	<MenuSheet
		bind:open={menuOpen}
		{snap}
		{tvUrl}
		{kicking}
		onkick={kick}
		onendgame={onEndGame}
		endPending={busy('endGame')}
	/>
{/if}

<style>
	.state {
		min-height: 100dvh;
		max-width: 26rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: calc(var(--space-5) + var(--safe-top)) calc(var(--space-5) + var(--safe-right))
			calc(var(--space-5) + var(--safe-bottom)) calc(var(--space-5) + var(--safe-left));
		text-align: center;
	}
	.state img {
		border-radius: 0.75rem;
	}
	.state h1 {
		font-size: var(--text-2xl);
	}
	.back-link {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.spinner {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		border: 4px solid var(--color-surface-2);
		border-top-color: var(--color-primary);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.ctl {
		max-width: 34rem;
		margin-inline: auto;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: calc(var(--space-2) + var(--safe-top)) calc(var(--space-2) + var(--safe-right)) var(--space-2)
			calc(var(--space-2) + var(--safe-left));
		background: color-mix(in oklab, var(--color-bg) 88%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
	}
	.icon-btn {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--tap-target);
		height: var(--tap-target);
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--color-surface-2);
	}
	.icon-btn svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.icon-btn circle {
		fill: currentColor;
		stroke: none;
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.title h1 {
		max-width: 100%;
		font-size: var(--text-lg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sd-mark {
		margin-right: 0.25em;
	}
	[data-phase='round'] .title h1,
	[data-phase='reveal'] .title h1 {
		font-variant-numeric: tabular-nums;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
	.code {
		font-family: var(--font-mono);
		font-weight: var(--weight-bold);
		letter-spacing: 0.12em;
		color: var(--color-text);
	}
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		font-weight: var(--weight-medium);
	}
	.conn-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--color-success);
	}
	.conn.offline {
		color: var(--color-warning);
	}
	.conn.offline .conn-dot {
		background: var(--color-warning);
		animation: blink 1s steps(2) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.2;
		}
	}
	.tv-dot {
		display: inline-flex;
	}
	.tv-dot svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
	}
	.tv-dot.on {
		color: var(--color-success);
	}
	.tv-dot.lost {
		color: var(--color-warning);
	}
	.tv-dot.none {
		opacity: 0.5;
	}

	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-2) calc(var(--space-4) + var(--safe-right)) var(--space-4)
			calc(var(--space-4) + var(--safe-left));
	}

	.dock {
		position: sticky;
		bottom: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-3) + var(--safe-bottom))
			calc(var(--space-4) + var(--safe-left));
		background: color-mix(in oklab, var(--color-bg) 92%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid var(--color-border);
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		animation: arrive 0.35s var(--ease-out);
	}
	.actions.arming {
		pointer-events: none;
	}
	@keyframes arrive {
		from {
			opacity: 0.35;
			transform: translateY(0.4rem);
		}
	}
	.note {
		font-size: var(--text-sm);
		text-align: center;
	}
	.note.warn {
		color: var(--color-text-muted);
	}
	.failure {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface));
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.failure button {
		flex: none;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--color-danger);
		color: var(--color-danger-contrast);
		font-weight: var(--weight-bold);
		cursor: pointer;
	}
	.dock :global(.sd-button),
	.dock :global(.sd-button:hover:not(:disabled)) {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		line-height: 1.2;
		padding-block: var(--space-2);
		text-wrap: balance;
	}
</style>
