<!-- Brand mark (a bullseye with a dropped pin) and optional wordmark. Sizes in em. -->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';

	let { wordmark = true, class: className }: { wordmark?: boolean; class?: string } = $props();
	const tc = useT(common);
</script>

<span class={['logo', className]}>
	<svg class="mark" viewBox="0 0 48 48" aria-hidden="true">
		<defs>
			<linearGradient id="tv-logo-g" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#ffd76a" />
				<stop offset="1" stop-color="#ff9f1c" />
			</linearGradient>
		</defs>
		<circle cx="24" cy="27" r="19" fill="none" stroke="url(#tv-logo-g)" stroke-width="3.5" />
		<circle cx="24" cy="27" r="11" fill="none" stroke="url(#tv-logo-g)" stroke-width="3.5" opacity="0.75" />
		<circle cx="24" cy="27" r="3.6" fill="url(#tv-logo-g)" />
		<path
			d="M24 2c-5 0-9 3.9-9 8.8 0 6.4 9 15.2 9 15.2s9-8.8 9-15.2C33 5.9 29 2 24 2z"
			fill="#ff4d5e"
			stroke="#0a1328"
			stroke-width="2"
		/>
		<circle cx="24" cy="10.6" r="3.2" fill="#fff" />
	</svg>
	{#if wordmark}<span class="word">{tc().appName}</span>{/if}
</span>

<style>
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		line-height: 1;
	}
	.mark {
		width: 1.25em;
		height: 1.25em;
		flex: none;
		overflow: visible;
		filter: drop-shadow(0 0.06em 0.12em rgb(0 0 0 / 0.4));
	}
	.word {
		font-weight: 850;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}
</style>
