<!--
  Before a game: the pairing code, huge, and how the host uses it. Also used after a reload
  while the TV is registering (code still null). A rotated code swaps only the digits that
  changed, in place (no remount, no flash).
-->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import Logo from './Logo.svelte';

	let { code, host }: { code: string | null; host: string } = $props();
	const t = useT(tvDict);
	const tc = useT(common);

	const digits = $derived((code ?? '      ').padEnd(6, ' ').slice(0, 6).split(''));
</script>

<section class="pairing" data-testid="pairing-screen">
	<header class="brand">
		<Logo class="brand-logo" />
		<p class="tagline">{tc().tagline}</p>
	</header>

	<div class="panel">
		<p class="eyebrow">{t().pairingTitle}</p>
		<div
			class={['code', 'u-code', { pending: !code }]}
			data-testid="pairing-code"
			data-code={code ?? ''}
			role="img"
			aria-label={code ? `${t().pairingCodeLabel}: ${code.split('').join(' ')}` : t().registering}
		>
			{#each digits as d, i (i)}
				{#if i === 3}<span class="gap" aria-hidden="true"></span>{/if}
				<span class="tile" aria-hidden="true">
					{#key d}
						<span class="digit">{d.trim() || ' '}</span>
					{/key}
				</span>
			{/each}
		</div>
		{#if code}
			<p class="how">
				{t().pairingOpen}
				<span class="url">{host}/host</span>
				{t().pairingEnter}
			</p>
			<p class="rotates">{t().pairingRotates}</p>
		{:else}
			<p class="how muted-line">{t().registering}</p>
		{/if}
	</div>
</section>

<style>
	.pairing {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		justify-items: center;
		align-items: center;
		padding: 6vh 4vw 8vh;
		text-align: center;
	}
	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		animation: rise 900ms var(--ease-out) both;
	}
	.brand :global(.brand-logo) {
		font-size: clamp(2.6rem, 7.5vh, 4.6rem);
	}
	.tagline {
		font-size: 1.15rem;
		color: var(--tv-ink-2);
		font-weight: 500;
	}
	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3.2vh;
		animation: rise 900ms 150ms var(--ease-out) both;
	}
	.eyebrow {
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--tv-gold);
	}
	.code {
		display: flex;
		align-items: center;
		gap: min(1.2vw, 2vh);
		/* Six tiles + gap must fit narrow screens too. */
		font-size: min(10.5vw, 21vh);
	}
	.tile {
		position: relative;
		display: grid;
		place-items: center;
		width: 0.78em;
		height: 1.08em;
		border-radius: 0.14em;
		background: linear-gradient(180deg, rgb(255 255 255 / 0.11), rgb(255 255 255 / 0.04));
		border: 1px solid rgb(255 255 255 / 0.14);
		box-shadow:
			inset 0 0.02em 0 rgb(255 255 255 / 0.12),
			0 0.06em 0.18em rgb(0 0 0 / 0.45);
		overflow: hidden;
		perspective: 4em;
	}
	.tile::after {
		/* split-flap seam */
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background: rgb(0 0 0 / 0.35);
	}
	.digit {
		grid-area: 1 / 1;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--tv-ink);
		text-shadow: 0 0.03em 0.08em rgb(0 0 0 / 0.5);
		animation: flip 520ms var(--ease-out) both;
		transform-origin: 50% 50%;
	}
	.gap {
		width: 0.22em;
	}
	.pending .tile {
		animation: pulse 1.4s ease-in-out infinite;
	}
	.pending .tile:nth-child(2n) {
		animation-delay: 0.2s;
	}
	.how {
		font-size: 1.55rem;
		font-weight: 550;
		color: var(--tv-ink-2);
		max-width: 40ch;
		line-height: 1.5;
		text-wrap: balance;
	}
	.url {
		display: inline-block;
		margin: 0 0.15em;
		padding: 0.05em 0.45em;
		border-radius: 0.4em;
		background: rgb(255 255 255 / 0.1);
		color: var(--tv-ink);
		font-weight: 800;
		white-space: nowrap;
	}
	.rotates {
		font-size: 0.95rem;
		color: var(--tv-ink-3);
	}
	.muted-line {
		color: var(--tv-ink-3);
	}
	@keyframes flip {
		from {
			opacity: 0;
			transform: rotateX(-80deg) translateY(-0.1em);
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(2vh);
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
</style>
