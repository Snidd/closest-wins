<!--
  Ambient background: a deep gradient with slow light, and optionally a faint rotating
  wireframe globe (pairing / lobby). Purely decorative; frozen with prefers-reduced-motion.
-->
<script lang="ts">
	type Props = { globe?: 'center' | 'right' | null; tone?: 'normal' | 'danger' | 'gold' };
	let { globe = null, tone = 'normal' }: Props = $props();

	const R = 100;
	const MERIDIANS = 12;
	const PARALLELS = [-60, -30, 0, 30, 60];
</script>

<div class={['backdrop', `tone-${tone}`]} aria-hidden="true">
	<div class="glow g1"></div>
	<div class="glow g2"></div>
	{#if globe}
		<svg class={['globe', globe]} viewBox="-110 -110 220 220">
			<circle r={R} class="rim" />
			{#each PARALLELS as lat (lat)}
				{@const y = -Math.sin((lat * Math.PI) / 180) * R}
				{@const hw = Math.cos((lat * Math.PI) / 180) * R}
				<line x1={-hw} x2={hw} y1={y} y2={y} class="par" />
			{/each}
			{#each Array.from({ length: MERIDIANS }, (_, i) => i) as i (i)}
				<ellipse
					rx={R}
					ry={R}
					class="mer"
					style:animation-delay="{(-i * 48) / MERIDIANS}s"
				/>
			{/each}
		</svg>
	{/if}
	<div class="vignette"></div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background:
			radial-gradient(120% 90% at 50% 110%, var(--tv-bg-2) 0%, transparent 60%),
			linear-gradient(160deg, var(--tv-bg-1) 0%, var(--tv-bg-0) 70%);
		transition: background 1s;
	}
	.glow {
		position: absolute;
		border-radius: 50%;
		filter: blur(8vmin);
		opacity: 0.55;
		animation: drift 38s ease-in-out infinite alternate;
	}
	.g1 {
		width: 60vmax;
		height: 60vmax;
		left: -18vmax;
		top: -26vmax;
		background: radial-gradient(circle, var(--tv-glow-a) 0%, transparent 65%);
	}
	.g2 {
		width: 55vmax;
		height: 55vmax;
		right: -20vmax;
		bottom: -28vmax;
		background: radial-gradient(circle, var(--tv-glow-b) 0%, transparent 65%);
		animation-duration: 46s;
		animation-direction: alternate-reverse;
	}
	.tone-danger {
		--tv-glow-a: rgb(255 40 70 / 0.45);
		--tv-glow-b: rgb(140 20 60 / 0.6);
	}
	.tone-gold {
		--tv-glow-a: rgb(255 190 60 / 0.35);
		--tv-glow-b: rgb(255 120 40 / 0.3);
	}
	@keyframes drift {
		to {
			transform: translate(8vmax, 5vmax) scale(1.15);
		}
	}

	.globe {
		position: absolute;
		width: min(112vh, 90vw);
		height: min(112vh, 90vw);
		top: 50%;
		opacity: 0.13;
		overflow: visible;
	}
	.globe.center {
		left: 50%;
		transform: translate(-50%, -50%);
	}
	.globe.right {
		right: -14vw;
		transform: translateY(-46%);
	}
	.rim,
	.par,
	.mer {
		fill: none;
		stroke: var(--tv-ink);
		stroke-width: 0.55;
		vector-effect: non-scaling-stroke;
	}
	.rim {
		stroke-width: 1.4;
	}
	.mer {
		transform-box: view-box;
		transform-origin: 0 0;
		animation: spin 48s linear infinite;
	}
	/* Meridian at a rotating longitude: its x radius follows sin(t); eased keyframes approximate it. */
	@keyframes spin {
		0% {
			transform: scaleX(0);
			animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
		}
		25% {
			transform: scaleX(1);
			animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
		}
		50% {
			transform: scaleX(0);
			animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
		}
		75% {
			transform: scaleX(-1);
			animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
		}
		100% {
			transform: scaleX(0);
		}
	}
	.vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(120% 120% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55) 100%);
	}
</style>
