<!--
  A running round: full-screen map with the centre cross, the clue and the countdown on top,
  the lock-in button at the bottom (thumb reach). Mounted once per round (keyed by index), so
  the map starts at the world view, or at the player's own cross after a refresh.

  Guess rules mirrored here (the server is authoritative):
  - `updateGuess` on every debounced map change, retried on network errors until just past the
    deadline, plus one final send right before `endsAt`, so the timeout rule (an untouched map
    never counts, a touched one counts as is) protects players whose lock-in failed.
  - lock-in uses `getGuess()` (stops inertia) and freezes the map at once; 409 means the guess
    is already final or the round is over, so the screen just resyncs.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import GuessMap, { type GuessState } from '#lib/map/GuessMap.svelte';
	import { lockIn, updateGuess } from '#lib/remote/game.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';
	import { errorMessage, errorStatus, sleep, ticker, type ServerClock } from './play.svelte.ts';
	import ClueCard from './ClueCard.svelte';
	import RoundTimer from './RoundTimer.svelte';
	import type { Snap } from './types.ts';

	type Props = { s: Snap<'round'>; clock: ServerClock; onresync: () => void };
	let { s, clock, onresync }: Props = $props();
	const t = useT(player);

	// Identity of this round (the component is keyed by it).
	const { gameId, roundIndex, initialGuess } = untrack(() => ({
		gameId: s.game.id,
		roundIndex: s.round.index,
		initialGuess: s.myGuess
	}));

	const round = $derived(s.round);
	/** No reveal this long after `endsAt`: the stream may be stale. Then retry with backoff. */
	const STALE_AFTER_MS = 4000;
	const STALE_RETRY_MS = (attempt: number) => Math.min(30_000, STALE_AFTER_MS * 2 ** attempt);
	const me = $derived(s.me);
	const canGuess = $derived(s.canGuess);
	const isSuddenDeath = $derived(round.isSuddenDeath);

	// --- Clock ----------------------------------------------------------------------------------
	const now = ticker(250);
	const leftMs = $derived(Math.max(0, round.endsAt - (now() + clock.offset)));
	const totalMs = $derived(round.endsAt - round.startedAt);
	const timeUp = $derived(leftMs <= 0);
	const urgent = $derived(leftMs <= 10_000);

	// --- Map state ------------------------------------------------------------------------------
	const VIEW_KEY = `cw:view:${gameId}:${roundIndex}`;
	/** Zoom the player had (the server only keeps lat/lng), to restore after a refresh. */
	function savedZoom(): number | undefined {
		if (!initialGuess || typeof sessionStorage === 'undefined') return undefined;
		try {
			const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as GuessState | null;
			if (v && Math.abs(v.lat - initialGuess.lat) < 0.05 && Math.abs(v.lng - initialGuess.lng) < 0.05) return v.zoom;
		} catch {
			// ignore
		}
		return undefined;
	}
	const initialCenter = initialGuess ? { lat: initialGuess.lat, lng: initialGuess.lng } : null;
	const initialZoom = savedZoom();

	let map = $state<GuessMap>();
	let touched = $state(untrack(() => !!initialGuess?.touched || initialGuess?.lockedAt != null));

	type LockState = 'idle' | 'locking' | 'locked' | 'late';
	let lockState = $state<LockState>('idle');
	let lockError = $state('');

	const serverLocked = $derived(s.myGuess?.lockedAt != null || s.lockedPlayerIds.includes(me.id));
	const locked = $derived(canGuess && (serverLocked || lockState === 'locked' || lockState === 'locking'));
	const frozen = $derived(canGuess && (locked || lockState === 'late' || timeUp));
	/** Frozen with a pin (the cross counts); an untouched map is blocked without a pin. */
	const showPin = $derived(frozen && (locked || touched));
	const blocked = $derived(frozen && !showPin);

	// --- Sending the cross ------------------------------------------------------------------------
	let destroyed = false;
	let latest: GuessState | null = null;
	let sending = false;

	$effect(() => () => {
		destroyed = true;
	});

	async function send(g: GuessState) {
		if (!untrack(() => canGuess)) return;
		latest = g;
		if (sending) return;
		sending = true;
		try {
			while (latest && !destroyed) {
				const cur: GuessState = latest;
				latest = null;
				try {
					await updateGuess({ gameId, roundIndex, lat: cur.lat, lng: cur.lng, touched: cur.touched });
				} catch (e) {
					const status = errorStatus(e);
					if (status === null) {
						// Network: keep trying with the newest position until just past the deadline.
						latest ??= cur;
						if (clock.now() > untrack(() => round.endsAt) + 1500) break;
						await sleep(1500);
					} else if (status === 401 || status === 403) {
						onresync();
						break;
					}
					// 409 (stale round / already locked): nothing to do.
				}
			}
		} finally {
			sending = false;
		}
	}

	function onchange(g: GuessState) {
		try {
			sessionStorage.setItem(VIEW_KEY, JSON.stringify(g));
		} catch {
			// private mode
		}
		if (untrack(() => frozen)) return;
		void send(g);
	}

	/** The deadline as a number: effects keyed on it do not re-run for every new snapshot. */
	const endsAt = $derived(round.endsAt);

	// Final position right before the deadline (a pending debounced update may not make it).
	$effect(() => {
		if (!canGuess || locked) return;
		const due = endsAt - 250 - untrack(() => clock.now());
		const id = setTimeout(
			() => {
				if (map && untrack(() => touched && !locked)) void send(map.getGuess());
			},
			Math.max(0, due)
		);
		return () => clearTimeout(id);
	});

	// The server ends the round ~0.5 s after `endsAt`. If no reveal arrives a few seconds later,
	// the stream may be stale (sleeping phone, dead connection): ask for a fresh snapshot. If the
	// round is still running after that, the server is late (e.g. retrying a failed round end),
	// not this phone: back off (4 s, 8 s, … 30 s), or every phone would reconnect on every
	// snapshot and flap everyone's presence. Snapshots of the same overdue round (same `endsAt`)
	// neither re-run this nor reset the backoff.
	$effect(() => {
		const deadline = endsAt;
		let attempt = 0;
		let id: ReturnType<typeof setTimeout> | undefined;
		const arm = (delay: number) => {
			id = setTimeout(() => {
				onresync();
				arm(STALE_RETRY_MS(++attempt));
			}, delay);
		};
		arm(Math.max(0, deadline + STALE_AFTER_MS - untrack(() => clock.now())));
		return () => clearTimeout(id);
	});

	// --- Lock in ----------------------------------------------------------------------------------
	async function lock() {
		if (!map || !canGuess || locked || frozen || !touched) return;
		const g = map.getGuess();
		lockState = 'locking';
		lockError = '';
		try {
			await lockIn({ gameId, roundIndex, lat: g.lat, lng: g.lng, touched: g.touched });
			lockState = 'locked';
			navigator.vibrate?.(30);
		} catch (e) {
			const status = errorStatus(e);
			if (status === 409) {
				lockState = /already/i.test(errorMessage(e)) ? 'locked' : 'late';
				onresync();
			} else if (status === 401 || status === 403) {
				lockState = 'idle';
				onresync();
			} else {
				lockState = 'idle';
				lockError = t().lockFailed;
				void send(g);
			}
		}
	}

	// --- Others -----------------------------------------------------------------------------------
	// Who may guess (players who joined mid-round and sudden-death spectators are not counted).
	// In the engine's order, so names read the same on every screen (sudden death: standings order).
	const participants = $derived(
		round.eligiblePlayerIds.map((id) => s.players.find((p) => p.id === id)).filter((p) => p !== undefined)
	);
	const lockedIds = $derived(new Set(s.lockedPlayerIds));
	const lockedCount = $derived(participants.filter((p) => lockedIds.has(p.id)).length);
	const opponents = $derived(participants.filter((p) => p.id !== me.id));

	const roundLabel = $derived(
		isSuddenDeath
			? round.number > 1
				? t().suddenDeathN(round.number)
				: t().suddenDeath
			: t().roundOf(round.number, s.game.totalRounds)
	);

	let clueCollapsed = $state(false);
</script>

<div
	class={['round', { sd: isSuddenDeath, frozen }]}
	data-testid="round"
	data-locked={locked}
	data-touched={touched}
	data-can-guess={canGuess}
>
	<div class="map">
		<GuessMap
			bind:this={map}
			bind:touched
			{initialCenter}
			{initialZoom}
			locked={showPin}
			color={me.color}
			attributionPosition="bottom-left"
			{onchange}
		/>
		{#if blocked}
			<div class="blocker" aria-hidden="true"></div>
		{/if}
	</div>

	<div class="hud">
		<header class="top">
			<div class="clue-col">
				<ClueCard clue={round.clue} {roundIndex} bind:collapsed={clueCollapsed} />
			</div>
			<div class="timer-col">
				<RoundTimer {leftMs} {totalMs} label={t().timeLeft} />
				<span class={['round-label', { sd: isSuddenDeath }]} data-testid="round-label">{roundLabel}</span>
			</div>
		</header>

		<footer class="bottom">
			{#if !canGuess}
				<div class="panel spectator" data-testid="spectator">
					<p class="panel-title">
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg
						>
						{t().spectating}
					</p>
					<p class="panel-body">
						{#if isSuddenDeath}
							{t().spectatingSuddenDeath(t().list(participants.map((p) => p.nickname)))}
						{:else}
							{t().spectatingLate}
						{/if}
					</p>
					{@render progress()}
				</div>
			{:else if locked}
				<div class="panel locked" data-testid="locked-panel" style:--me={me.color}>
					<div class="locked-head">
						<span class="check" aria-hidden="true">
							<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
						</span>
						<div>
							<p class="panel-title">{lockState === 'locking' ? t().locking : t().lockedTitle}</p>
							<p class="panel-body">{timeUp ? t().revealSoon : t().waitingForOthers}</p>
						</div>
					</div>
					{@render progress()}
				</div>
			{:else if frozen}
				<div class="panel timeup" data-testid="timeup-panel">
					<p class="panel-title big">{lockState === 'late' ? t().lockStale : t().timeUp}</p>
					<p class="panel-body">{touched ? t().timeUpCounts : t().timeUpNoGuess}</p>
				</div>
			{:else}
				{#if isSuddenDeath}
					<p class="bubble sd-bubble" data-testid="sd-stakes">
						<strong>{t().suddenDeathStakes}</strong>
						{#if opponents.length}<span>{t().suddenDeathVs(t().list(opponents.map((p) => p.nickname)))}</span>{/if}
					</p>
				{/if}
				{#if lockError}
					<p class="bubble error" role="alert" data-testid="lock-error">{lockError}</p>
				{:else if !touched && urgent}
					<p class="bubble warn" role="alert" data-testid="untouched-hint">{t().untouchedWarning}</p>
				{/if}
				<button
					type="button"
					class={['lock', { ready: touched }]}
					disabled={!touched}
					onclick={lock}
					data-testid="lock-in"
				>
					{#if touched}
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg
						>
						{lockError ? t().tryAgain : t().lockIn}
					{:else}
						<svg class="move" viewBox="0 0 24 24" aria-hidden="true"
							><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg
						>
						<span>{t().moveMapFirst}</span>
						<span class="visually-hidden">. {t().untouchedHint}</span>
					{/if}
				</button>
			{/if}
		</footer>
	</div>
</div>

{#snippet progress()}
	<div class="progress" data-testid="locked-count">
		<ul aria-hidden="true">
			{#each participants as p (p.id)}
				<li
					class={{ on: lockedIds.has(p.id), off: !p.connected, me: p.id === me.id }}
					style:--c={p.color}
					title={p.nickname}
				></li>
			{/each}
		</ul>
		<span>{t().lockedCount(lockedCount, participants.length)}</span>
	</div>
{/snippet}

<style>
	.round {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--color-ocean);
	}
	.map {
		position: absolute;
		inset: 0;
	}
	.blocker {
		position: absolute;
		inset: 0;
		z-index: 6;
		background: color-mix(in srgb, var(--color-bg) 35%, transparent);
		touch-action: none;
	}
	.hud {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
		padding: calc(var(--safe-top) + var(--space-2)) calc(var(--safe-right) + var(--space-2)) 0
			calc(var(--safe-left) + var(--space-2));
	}
	.hud :global(button),
	.panel,
	.bubble {
		pointer-events: auto;
	}

	/* --- Top: clue + timer --- */
	.top {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		/* Keep everything above the centre cross (24px half-size + clearance). */
		--clue-max: min(17rem, calc(50dvh - var(--safe-top) - var(--space-2) - 2.75rem));
	}
	.clue-col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.clue-col > :global(*) {
		pointer-events: auto;
	}
	.timer-col {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		max-width: 7.5rem;
	}
	.round-label {
		max-width: 100%;
		padding: 0.15em 0.6em;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.round-label.sd {
		background: var(--color-danger);
		color: var(--color-danger-contrast);
	}
	/* Sudden death: the whole screen is framed in red. */
	.sd::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 20;
		pointer-events: none;
		box-shadow: inset 0 0 0 4px var(--color-danger);
	}

	/* --- Bottom --- */
	.bottom {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		width: 100%;
		max-width: 28rem;
		margin-inline: auto;
		padding: 0 var(--space-1) calc(var(--safe-bottom) + 1.25rem);
	}
	.lock {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 4.25rem;
		padding: 0 var(--space-5);
		border: 0;
		border-radius: var(--radius-lg);
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
		letter-spacing: -0.01em;
		cursor: pointer;
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		color: var(--color-text-muted);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(8px);
		transition:
			background-color var(--duration-normal) var(--ease-out),
			color var(--duration-normal),
			transform var(--duration-fast) var(--ease-out);
	}
	.lock:disabled {
		cursor: default;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
	}
	.lock.ready {
		background: var(--color-primary);
		color: var(--color-primary-contrast);
		box-shadow:
			0 6px 18px color-mix(in srgb, var(--color-primary) 45%, transparent),
			var(--shadow-md);
	}
	.lock.ready:active {
		transform: scale(0.97);
	}
	.lock svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.sd .lock.ready {
		background: var(--color-danger);
		color: var(--color-danger-contrast);
		box-shadow:
			0 6px 18px color-mix(in srgb, var(--color-danger) 45%, transparent),
			var(--shadow-md);
	}

	.bubble {
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 100%;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--color-surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(8px);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		line-height: 1.3;
		text-align: center;
		text-wrap: balance;
	}
	.warn {
		background: var(--color-danger);
		color: var(--color-danger-contrast);
		border-radius: var(--radius-lg);
		animation: nudge 1.6s var(--ease-out) infinite;
	}
	.lock .move {
		color: var(--color-primary);
		animation: wiggle 2.4s var(--ease-out) infinite;
	}
	@keyframes wiggle {
		0%,
		60%,
		100% {
			transform: none;
		}
		70% {
			transform: translate(-3px, 0);
		}
		80% {
			transform: translate(3px, -2px);
		}
		90% {
			transform: translate(0, 2px);
		}
	}
	@keyframes nudge {
		0%,
		70%,
		100% {
			transform: none;
		}
		80% {
			transform: translateX(-4px);
		}
		90% {
			transform: translateX(4px);
		}
	}
	.error {
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface));
		border: 2px solid var(--color-danger);
	}
	.sd-bubble {
		flex-direction: column;
		gap: 0;
		border-radius: var(--radius-lg);
		border: 2px solid var(--color-danger);
	}
	.sd-bubble strong {
		color: var(--color-danger);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-surface) 96%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(10px);
		animation: rise var(--duration-normal) var(--ease-out);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(0.75rem);
		}
	}
	.panel-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		line-height: var(--leading-tight);
	}
	.panel-title.big {
		font-size: var(--text-2xl);
	}
	.panel-title svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: var(--color-text-muted);
		stroke-width: 2;
	}
	.panel-body {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		line-height: 1.35;
	}
	.locked-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.check {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		background: var(--color-success);
		color: #fff;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--me) 70%, transparent);
		animation: pop 360ms var(--ease-out);
	}
	.check svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@keyframes pop {
		0% {
			transform: scale(0.4);
		}
		70% {
			transform: scale(1.12);
		}
	}
	.timeup {
		text-align: center;
		align-items: center;
	}

	.progress {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.progress ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
		flex: 1;
		min-width: 0;
	}
	.progress li {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 50%;
		border: 2px solid var(--c);
		background: transparent;
		transition: background-color var(--duration-normal);
	}
	.progress li.on {
		background: var(--c);
	}
	.progress li.off {
		opacity: 0.35;
	}
	.progress li.me {
		outline: 2px solid var(--color-text);
		outline-offset: 1px;
	}
	.progress span {
		flex: none;
		color: var(--color-text-muted);
	}
</style>
