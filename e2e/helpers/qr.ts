import QRCode from 'qrcode';

/** The `d` of the QR path `QrCode.svelte` draws for `value` (same algorithm as its `qrPath`). */
export function expectedQrPath(value: string, quietZone: number): string {
	const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
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
	return d;
}
