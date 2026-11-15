import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import QRCode from 'qrcode';
import QrCode from './QrCode.svelte';

/** Rebuilds the module matrix from the rendered SVG path (runs of `M x y h w v1 h -w z`). */
function matrixFromSvg(html: string) {
	const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(html);
	const d = /<path d="([^"]*)"/.exec(html)?.[1];
	if (!viewBox || d === undefined) throw new Error('no QR svg in output');
	const total = Number(viewBox[1]);
	const grid: number[][] = Array.from({ length: total }, () => Array<number>(total).fill(0));
	for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
		const [x, y, w, back] = m.slice(1).map(Number) as [number, number, number, number];
		expect(back).toBe(w);
		for (let i = 0; i < w; i++) grid[y]![x + i] = 1;
	}
	return { total, grid };
}

describe('QrCode', () => {
	const value = 'https://example.test/join/ABCD';

	it.each(['L', 'M', 'Q', 'H'] as const)('renders exactly qrcode’s module matrix (level %s)', (level) => {
		const quietZone = 4;
		const { body } = render(QrCode, { props: { value, level, quietZone, label: 'Scan to join' } });
		const { total, grid } = matrixFromSvg(body);

		const { modules } = QRCode.create(value, { errorCorrectionLevel: level });
		expect(total).toBe(modules.size + quietZone * 2);
		for (let y = 0; y < total; y++) {
			for (let x = 0; x < total; x++) {
				const inside =
					x >= quietZone && y >= quietZone && x < quietZone + modules.size && y < quietZone + modules.size;
				const expected = inside ? modules.get(y - quietZone, x - quietZone) : 0;
				expect(grid[y]![x], `module ${x},${y}`).toBe(expected ? 1 : 0);
			}
		}
	});

	it('is an accessible, high-contrast image', () => {
		const { body } = render(QrCode, { props: { value, label: 'Scan to join', size: 240 } });
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="Scan to join"');
		expect(body).toContain('fill="#ffffff"');
		expect(body).toContain('fill="#000000"');
		expect(body).toMatch(/width: 240px/);
	});

	it('honours the quiet zone', () => {
		const { body } = render(QrCode, { props: { value, quietZone: 0 } });
		const { total } = matrixFromSvg(body);
		expect(total).toBe(QRCode.create(value, { errorCorrectionLevel: 'M' }).modules.size);
	});
});
