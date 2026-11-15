<!-- Lobby: pair the TV first, then the join code (QR on demand) and the live player list. -->
<script lang="ts">
	import QrCode from '#lib/ui/QrCode.svelte';
	import { useT } from '#lib/i18n/context.ts';
	import { host } from '#lib/i18n/host.ts';
	import PairTv from './PairTv.svelte';
	import PlayerList from './PlayerList.svelte';
	import TvStatus from './TvStatus.svelte';
	import type { HostPhase } from './types.ts';

	type Props = {
		snap: HostPhase<'lobby'>;
		tvUrl: string;
		kicking: ReadonlySet<string>;
		onkick: (playerId: string) => void;
	};
	let { snap, tvUrl, kicking, onkick }: Props = $props();

	const t = useT(host);
	let repair = $state(false);
	let showQr = $state(false);

	const joinHost = $derived(snap.game.joinUrl.replace(/^https?:\/\//, '').replace(/\/join\/[A-Z]+$/, ''));
</script>

<section class="card" aria-labelledby="tv-title" data-testid="tv-card">
	<h2 id="tv-title" class="eyebrow">{t().tvTitle}</h2>
	{#if snap.tv.paired && !repair}
		<TvStatus tv={snap.tv} />
		<button type="button" class="link" onclick={() => (repair = true)}>{t().pairAnother}</button>
	{:else}
		<PairTv
			gameId={snap.game.id}
			{tvUrl}
			onpaired={() => (repair = false)}
			oncancel={snap.tv.paired ? () => (repair = false) : undefined}
		/>
	{/if}
</section>

<section class="card join" aria-labelledby="join-title">
	<h2 id="join-title" class="eyebrow">{t().joinTitle}</h2>
	<p class="join-line">
		{t().joinAt} <strong class="host">{joinHost}</strong>
		{t().joinWithCode}
	</p>
	<p class="code" data-testid="join-code">{snap.game.joinCode}</p>
	<button type="button" class="link" aria-expanded={showQr} onclick={() => (showQr = !showQr)}>
		{showQr ? t().hideQr : t().showQr}
	</button>
	{#if showQr}
		<div class="qr">
			<QrCode value={snap.game.joinUrl} label={t().scanToJoin} size="min(16rem, 70vw)" />
		</div>
	{/if}
</section>

<section class="card" aria-labelledby="players-title">
	<h2 id="players-title" class="eyebrow">
		{t().playersTitle}
		<span class="count" data-testid="player-count">{snap.players.length}</span>
	</h2>
	{#if snap.players.length === 0}
		<p class="waiting">
			<span class="pulse" aria-hidden="true"></span>
			{t().noPlayersYet}
		</p>
	{:else}
		<PlayerList players={snap.players} {kicking} {onkick} />
	{/if}
</section>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.count {
		display: inline-grid;
		place-items: center;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--color-primary);
		color: var(--color-primary-contrast);
		font-size: var(--text-xs);
		letter-spacing: 0;
	}
	.link {
		align-self: flex-start;
		min-height: 2.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-primary);
		font-weight: var(--weight-medium);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.join {
		align-items: center;
		text-align: center;
	}
	.join .eyebrow {
		align-self: flex-start;
	}
	.join .link {
		align-self: center;
	}
	.join-line {
		color: var(--color-text-muted);
	}
	.host {
		color: var(--color-text);
		font-family: var(--font-mono);
		word-break: break-all;
	}
	.code {
		font-family: var(--font-mono);
		font-weight: var(--weight-bold);
		font-size: clamp(3rem, 18vw, 4.5rem);
		line-height: 1;
		letter-spacing: 0.15em;
		padding-left: 0.15em;
		color: var(--color-text);
	}
	.qr {
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: #fff;
	}
	.waiting {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 3rem;
		color: var(--color-text-muted);
	}
	.pulse {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--color-primary);
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.25;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
