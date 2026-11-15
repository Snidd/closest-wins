<!--
  A running round: countdown, who has locked in, and a compact view of the clue. The snapshot
  has no answer during a round (by contract), so there is nothing to leak here.
-->
<script lang="ts">
	import Countdown from '#lib/ui/Countdown.svelte';
	import { localized, type Locale } from '#lib/i18n/index.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import type { HostPhase } from './types.ts';

	type Props = { snap: HostPhase<'round'>; offsetMs: number; locale: Locale };
	let { snap, offsetMs, locale }: Props = $props();

	const t = useT(host);
	const c = useT(common);

	const round = $derived(snap.round);
	const eligibleIds = $derived(new Set(round.eligiblePlayerIds ?? snap.players.map((p) => p.id)));
	const lockedIds = $derived(new Set(snap.lockedPlayerIds));
	const eligible = $derived(snap.players.filter((p) => eligibleIds.has(p.id)));
	const locked = $derived(eligible.filter((p) => lockedIds.has(p.id)));
	const guessing = $derived(eligible.filter((p) => !lockedIds.has(p.id) && p.connected));
	const offline = $derived(eligible.filter((p) => !lockedIds.has(p.id) && !p.connected));
	const watching = $derived(snap.players.filter((p) => !eligibleIds.has(p.id)));
	const progress = $derived(eligible.length ? locked.length / eligible.length : 0);

	const clueText = $derived(localized(round.clue, 'text', locale));
	let clueOpen = $state(false);
</script>

<section class="timer-card" aria-label={c().timeLeft}>
	<div class="timer">
		<Countdown endsAt={round.endsAt} {offsetMs} size="xl" warnBelow={10} label={c().timeLeft} />
		<span class="unit">{c().timeLeft}</span>
	</div>
	<div class="lock-summary">
		<p class="lock-count" data-testid="lock-count" aria-hidden="true">
			<strong>{locked.length}</strong>
			<span>/ {eligible.length}</span>
		</p>
		<p class="lock-label">{t().lockedIn}</p>
		<span class="visually-hidden">{t().lockedCount(locked.length, eligible.length)}</span>
		<div class="bar" aria-hidden="true"><span style:transform="scaleX({progress})"></span></div>
	</div>
</section>

<section class="card" aria-label={c().players} data-testid="round-players">
	{#if guessing.length}
		<div class="group">
			<h3 class="group-title">{t().waitingOn} <span>{guessing.length}</span></h3>
			<ul class="chips">
				{#each guessing as p (p.id)}
					<li class="chip" data-testid="player-guessing" data-player={p.nickname}>
						<span class="dot" style:background={p.color}></span>{p.nickname}
						<span class="dots" aria-hidden="true">…</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if locked.length}
		<div class="group">
			<h3 class="group-title">{t().lockedIn} <span>{locked.length}</span></h3>
			<ul class="chips">
				{#each locked as p (p.id)}
					<li class="chip locked" data-testid="player-locked" data-player={p.nickname}>
						<span class="dot" style:background={p.color}></span>{p.nickname}
						<span class="check" aria-hidden="true">✓</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if offline.length}
		<div class="group">
			<h3 class="group-title">{t().offlinePlayers} <span>{offline.length}</span></h3>
			<ul class="chips">
				{#each offline as p (p.id)}
					<li class="chip offline" data-testid="player-offline" data-player={p.nickname}>
						<span class="dot" style:background={p.color}></span>{p.nickname}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if watching.length}
		<div class="group">
			<h3 class="group-title">{t().watching} <span>{watching.length}</span></h3>
			<ul class="chips">
				{#each watching as p (p.id)}
					<li class={['chip', 'watching', { offline: !p.connected }]}>
						<span class="dot" style:background={p.color}></span>{p.nickname}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if eligible.length > 0 && guessing.length === 0 && offline.length === 0}
		<p class="all-locked">{t().everyoneLocked}</p>
	{/if}
</section>

<section class="card clue" aria-labelledby="clue-title">
	<h2 id="clue-title" class="eyebrow">{t().clue}</h2>
	<button type="button" class={['clue-body', { open: clueOpen }]} onclick={() => (clueOpen = !clueOpen)} aria-expanded={clueOpen}>
		{#if round.clue.photo}
			<img
				src={round.clue.photo.urls.sm}
				alt=""
				width={round.clue.photo.width}
				height={round.clue.photo.height}
				class="photo"
			/>
		{/if}
		{#if clueText}<span class="clue-text">{clueText}</span>{/if}
	</button>
	<p class="hidden-note">{t().clueHidden}</p>
</section>

<style>
	.timer-card {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.timer {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 6.5rem;
	}
	.unit {
		margin-top: var(--space-1);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.lock-summary {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.lock-count {
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.lock-count strong {
		font-size: var(--text-4xl);
		color: var(--color-success);
	}
	.lock-count span {
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
	}
	.lock-label {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.bar {
		height: 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--color-success);
		transform-origin: left;
		transition: transform var(--duration-normal) var(--ease-out);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.group-title {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.group-title span {
		margin-left: 0.25em;
		color: var(--color-text);
	}
	.chips {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		max-width: 100%;
		padding: 0.35em 0.8em 0.35em 0.55em;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		font-weight: var(--weight-bold);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		flex: none;
		width: 0.8em;
		height: 0.8em;
		border-radius: 50%;
	}
	.chip.locked {
		background: color-mix(in oklab, var(--color-success) 18%, var(--color-surface));
	}
	.check {
		color: var(--color-success);
	}
	.dots {
		color: var(--color-text-muted);
		animation: blink 1.4s steps(2) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.chip.offline {
		opacity: 0.5;
		filter: grayscale(1);
	}
	.chip.watching {
		background: transparent;
		border: 1px dashed var(--color-border);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}
	.all-locked {
		font-weight: var(--weight-bold);
		color: var(--color-success);
	}
	.eyebrow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.clue-body {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.photo {
		flex: none;
		width: 5.5rem;
		height: 5.5rem;
		object-fit: cover;
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		transition:
			width var(--duration-normal),
			height var(--duration-normal);
	}
	.clue-text {
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--text-md);
	}
	.open {
		flex-direction: column;
	}
	.open .photo {
		width: 100%;
		height: auto;
		max-height: 60vh;
		object-fit: contain;
	}
	.open .clue-text {
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}
	.hidden-note {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
