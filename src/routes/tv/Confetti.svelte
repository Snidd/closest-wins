<!--
  Falling confetti in the given colours, drawn on one canvas (cheap on a TV, and a single layer
  that always stays behind the content). Hidden with prefers-reduced-motion.
-->
<script lang="ts">
	let { colors, count = 80 }: { colors: string[]; count?: number } = $props();

	let canvas = $state<HTMLCanvasElement>();

	$effect(() => {
		const el = canvas;
		if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		const palette = colors.length ? colors : ['#ffc23d'];
		let w = 0;
		let h = 0;
		const resize = () => {
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			w = el.clientWidth;
			h = el.clientHeight;
			el.width = Math.round(w * dpr);
			el.height = Math.round(h * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		const unit = () => Math.max(6, Math.min(w, h) / 70);
		const pieces = Array.from({ length: count }, (_, i) => ({
			x: Math.random() * w,
			y: Math.random() * h * 1.2 - h * 0.2,
			vy: 0.6 + Math.random() * 0.9,
			sway: Math.random() * Math.PI * 2,
			swaySpeed: 0.6 + Math.random() * 1.2,
			rot: Math.random() * Math.PI * 2,
			vr: (Math.random() - 0.5) * 4,
			s: 0.6 + Math.random() * 0.7,
			round: Math.random() > 0.72,
			color: palette[i % palette.length]!
		}));
		let raf = 0;
		let last = performance.now();
		const frame = (t: number) => {
			const dt = Math.min(0.05, (t - last) / 1000);
			last = t;
			const u = unit();
			ctx.clearRect(0, 0, w, h);
			for (const p of pieces) {
				p.y += p.vy * u * 6 * dt;
				p.sway += p.swaySpeed * dt;
				p.rot += p.vr * dt;
				if (p.y > h + u * 2) {
					p.y = -u * 2;
					p.x = Math.random() * w;
				}
				const x = p.x + Math.sin(p.sway) * u * 2.2;
				ctx.save();
				ctx.translate(x, p.y);
				ctx.rotate(p.rot);
				ctx.globalAlpha = 0.9;
				ctx.fillStyle = p.color;
				const size = u * p.s;
				if (p.round) {
					ctx.beginPath();
					ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
					ctx.fill();
				} else {
					// Flip around one axis for a tumbling look.
					const sy = Math.abs(Math.cos(p.rot * 1.3));
					ctx.fillRect(-size * 0.5, -size * 0.8 * sy, size, size * 1.6 * sy);
				}
				ctx.restore();
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		window.addEventListener('resize', resize);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', resize);
		};
	});
</script>

<canvas class="confetti" bind:this={canvas} aria-hidden="true"></canvas>

<style>
	.confetti {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		pointer-events: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.confetti {
			display: none;
		}
	}
</style>
