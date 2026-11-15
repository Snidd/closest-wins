<!--
  The clue, as large as possible: a photo is letterboxed (never cropped) on a blurred, darkened
  copy of itself; a text clue gets big type scaled to its length; photo + text sit side by
  side (text below for very wide photos on narrow screens). The photo fades in once decoded;
  a missing file shows a quiet placeholder instead. No photo credit here: it can name the place,
  so it only arrives (and is shown) with the answer.
-->
<script lang="ts">
	import { photoSrcset, type ClueView } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { localized } from '#lib/i18n/localized.ts';

	let { clue }: { clue: ClueView } = $props();
	const t = useT(tvDict);
	const locale = useLocale();

	const text = $derived(localized(clue, 'text', locale()));
	const photo = $derived(clue.photo);
	const kind = $derived(photo && text ? 'both' : photo ? 'photo' : 'text');

	let photoState = $state<'loading' | 'ready' | 'error'>('loading');
	let img = $state<HTMLImageElement>();

	// Reset only when the photo itself changes (every snapshot brings a new `clue` object).
	const photoKey = $derived(photo?.urls.lg ?? '');
	$effect.pre(() => {
		void photoKey;
		photoState = 'loading';
	});
	// Covers images that finished loading before hydration attached the handlers.
	$effect(() => {
		if (img?.complete) photoState = img.naturalWidth > 0 ? 'ready' : 'error';
	});

	/** Text size by length; smaller in the side panel next to a photo. */
	const textSize = $derived.by(() => {
		const n = text.length;
		const base = n <= 40 ? 3.6 : n <= 80 ? 3 : n <= 140 ? 2.5 : n <= 240 ? 2.05 : n <= 400 ? 1.7 : 1.4;
		return kind === 'both' ? Math.max(1.2, base * 0.62) : base;
	});
	const portrait = $derived(photo ? photo.height > photo.width * 1.05 : false);
</script>

<div class={['clue', `k-${kind}`, { portrait }]} data-testid="clue" data-kind={kind}>
	{#if photo}
		<figure class="photo" data-state={photoState}>
			<div class="bg" style:background-image="url({photo.urls.sm})"></div>
			<!-- Both are always rendered; CSS shows one by data-state (robust across hydration). -->
			<div class="missing" data-testid="photo-missing" aria-hidden={photoState !== 'error'}>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path
						d="M21 5v10.6l-2-2V5H7.4l-2-2H19a2 2 0 0 1 2 2zM2.8 2.8 1.4 4.2 3 5.8V19a2 2 0 0 0 2 2h13.2l1.6 1.6 1.4-1.4L2.8 2.8zM5 19V7.8l4.6 4.6L7 16h8.2l2 2H5z"
					/></svg
				>
				<span>{t().photoMissing}</span>
			</div>
			<img
				bind:this={img}
				class="pic"
				src={photo.urls.md}
				srcset={photoSrcset(photo)}
				sizes={kind === 'both' ? '65vw' : '100vw'}
				width={photo.width}
				height={photo.height}
				alt=""
				fetchpriority="high"
				decoding="async"
				onload={() => (photoState = 'ready')}
				onerror={() => (photoState = 'error')}
			/>
		</figure>
	{/if}
	{#if text}
		<div class="text-wrap">
			<p class="text" style:font-size="{textSize}rem" data-testid="clue-text">
				<span class="q" aria-hidden="true">“</span>{text}
			</p>
		</div>
	{/if}
</div>

<style>
	.clue {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		display: grid;
		gap: 1.2rem;
	}
	.clue.k-both {
		grid-template-columns: minmax(0, 1.9fr) minmax(16rem, 1fr);
	}
	.clue.k-both.portrait {
		grid-template-columns: minmax(0, 1.15fr) minmax(16rem, 1fr);
	}

	/* --- Photo ----------------------------------------------------------------------------- */
	.photo {
		position: relative;
		margin: 0;
		min-width: 0;
		min-height: 0;
		border-radius: 1.4rem;
		overflow: hidden;
		background: #050a14;
		box-shadow:
			0 0 0 1px rgb(255 255 255 / 0.08),
			0 1.4rem 3rem rgb(0 0 0 / 0.45);
		isolation: isolate;
	}
	.bg {
		position: absolute;
		inset: -8%;
		background-size: cover;
		background-position: center;
		filter: blur(36px) brightness(0.45) saturate(1.3);
		transform: scale(1.1);
		z-index: -1;
		opacity: 0;
		transition: opacity 900ms;
	}
	.pic {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		max-width: none;
		opacity: 0;
		transform: scale(1.02);
		transition:
			opacity 700ms var(--ease-out),
			transform 1400ms var(--ease-out);
	}
	[data-state='ready'] .pic {
		opacity: 1;
		transform: none;
	}
	[data-state='ready'] .bg {
		opacity: 1;
	}
	[data-state='error'] .missing {
		display: flex;
	}
	[data-state='error'] .pic {
		display: none;
	}
	.missing {
		position: absolute;
		inset: 0;
		display: none;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		color: var(--tv-ink-3);
		font-size: 1.2rem;
		font-weight: 600;
		background: repeating-linear-gradient(135deg, rgb(255 255 255 / 0.03) 0 1.2rem, transparent 1.2rem 2.4rem);
	}
	.missing svg {
		width: 4rem;
		height: 4rem;
		fill: currentColor;
		opacity: 0.7;
	}

	/* --- Text ------------------------------------------------------------------------------ */
	.text-wrap {
		display: grid;
		place-items: center;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		padding: 0 4%;
	}
	.k-both .text-wrap {
		place-items: center start;
		padding: 1.5rem 1.8rem;
		border-radius: 1.4rem;
		background: rgb(255 255 255 / 0.05);
		border: 1px solid var(--tv-line);
	}
	.text {
		position: relative;
		max-width: 26ch;
		font-weight: 750;
		line-height: 1.22;
		letter-spacing: -0.015em;
		text-wrap: balance;
		text-align: center;
		color: var(--tv-ink);
		animation: text-in 900ms var(--ease-out) both;
	}
	.k-both .text {
		max-width: none;
		text-align: left;
		font-weight: 700;
	}
	.q {
		display: inline-block;
		margin-right: 0.08em;
		font-size: 1.7em;
		line-height: 0;
		vertical-align: -0.38em;
		color: var(--tv-gold);
		opacity: 0.9;
		font-family: Georgia, 'Times New Roman', serif;
	}
	.k-both .q {
		position: static;
		display: block;
		height: 0.5em;
		margin-bottom: 0.1em;
		font-size: 2em;
	}
	@keyframes text-in {
		from {
			opacity: 0;
			transform: translateY(1.2rem);
		}
	}
</style>
