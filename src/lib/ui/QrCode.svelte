<!--
  QR code as crisp inline SVG, rendered on the server too (no flash on the TV).

  <QrCode value={game.joinUrl} label={t().scanToJoin} size="min(60vh, 30rem)" />

  Always dark modules on a white plate, in both themes, so a phone can scan it from across a
  room (inverted or low-contrast codes fail on many scanners). The white plate includes the
  quiet zone, so the code also works on a dark page.
-->
<script module lang="ts">
	import QRCode from 'qrcode';

	export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

	/**
	 * SVG path for the dark modules: one `h` run per horizontal stretch, in module units, offset
	 * by the quiet zone. Exported for tests.
	 */
	export function qrPath(value: string, level: QrErrorCorrection, quietZone: number) {
		const { modules } = QRCode.create(value, { errorCorrectionLevel: level });
		const n = modules.size;
		let d = '';
		for (let y = 0; y < n; y++) {
			let x = 0;
			while (x < n) {
				if (!modules.get(y, x)) {
					x++;
					continue;
				}
				const start = x;
				while (x < n && modules.get(y, x)) x++;
				d += `M${start + quietZone} ${y + quietZone}h${x - start}v1h${start - x}z`;
			}
		}
		return { d, size: n + quietZone * 2, modules: n };
	}
</script>

<script lang="ts">
	type Props = {
		/** Text to encode, usually an absolute URL. */
		value: string;
		/** CSS size of the square (number = px). Defaults to filling the container width. */
		size?: number | string;
		/** Accessible name, e.g. "Scan to join". Defaults to the encoded value. */
		label?: string;
		/** Error-correction level: L 7 %, M 15 %, Q 25 %, H 30 %. M suits short URLs on a screen. */
		level?: QrErrorCorrection;
		/** Light margin around the code in modules (the spec asks for 4; 2 is fine on a plain plate). */
		quietZone?: number;
		class?: string;
	};

	let { value, size = '100%', label, level = 'M', quietZone = 4, class: className }: Props = $props();

	const qr = $derived(qrPath(value, level, Math.max(0, Math.round(quietZone))));
	const cssSize = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<svg
	class={['qr', className]}
	viewBox="0 0 {qr.size} {qr.size}"
	style:width={cssSize}
	style:height={cssSize}
	role="img"
	aria-label={label ?? value}
	shape-rendering="crispEdges"
	data-modules={qr.modules}
>
	<rect width={qr.size} height={qr.size} fill="#ffffff" />
	<path d={qr.d} fill="#000000" />
</svg>

<style>
	.qr {
		display: block;
		max-width: 100%;
		aspect-ratio: 1;
		/* Keep the plate white even if a parent filters/inverts colours for dark mode. */
		color-scheme: light;
		forced-color-adjust: none;
		image-rendering: pixelated;
	}
</style>
