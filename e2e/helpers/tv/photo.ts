/** Synthetic "photo" (a rendered mountain-lake scene) for clue-photo tests; no network needed. */
import sharp from 'sharp';

export async function makePhoto(shape: 'landscape' | 'portrait' = 'landscape'): Promise<Buffer> {
	const [w, h] = shape === 'landscape' ? [1600, 1000] : [900, 1350];
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 160 100" preserveAspectRatio="none">
	<defs>
		<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#2a5fa8"/><stop offset="0.55" stop-color="#9cc4e8"/><stop offset="1" stop-color="#f6d9b0"/>
		</linearGradient>
		<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#3c7fa6"/><stop offset="1" stop-color="#0f3550"/>
		</linearGradient>
	</defs>
	<rect width="160" height="100" fill="url(#sky)"/>
	<circle cx="122" cy="22" r="7" fill="#fff4d6" opacity="0.9"/>
	<path d="M0 62 L22 30 L34 44 L52 18 L70 46 L84 34 L104 58 L120 26 L140 48 L160 36 L160 70 L0 70Z" fill="#4b5a73"/>
	<path d="M52 18 L46 28 L52 26 L57 30 Z M120 26 L114 36 L121 33 L126 37 Z M22 30 L18 37 L23 35 L27 38Z" fill="#f4f7fb"/>
	<path d="M0 66 L30 52 L60 64 L90 50 L130 62 L160 54 L160 74 L0 74Z" fill="#2f5a3a"/>
	<rect y="72" width="160" height="28" fill="url(#lake)"/>
	<path d="M0 72 L160 72" stroke="#cfe6f5" stroke-width="0.4" opacity="0.7"/>
	<path d="M10 80 h30 M60 86 h40 M110 79 h25 M30 92 h35" stroke="#ffffff" stroke-width="0.3" opacity="0.35"/>
</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
