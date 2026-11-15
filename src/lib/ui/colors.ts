/**
 * 40 visually distinct player pin colours (generated in OKLab, greedy farthest-point order, so
 * the first N are the most distinct for N players). Assign in order, skipping colours already
 * used in the game. Mirrored as `--player-0` … `--player-39` in `src/app.css` (a unit test keeps
 * them in sync). Always draw pins with a dark/white outline so light colours read on any map.
 */
export const PLAYER_COLORS = [
	'#e6424a', '#2debf9', '#0867a9', '#519c03', '#d689f7', '#f5cc58', '#8c5500', '#993683',
	'#febccf', '#ff8950', '#5978fd', '#61b4ff', '#0498a2', '#22cd82', '#0a7648', '#b257d7',
	'#b0b70a', '#a38207', '#fd7eaa', '#694bb5', '#ac3036', '#a9e686', '#add6fd', '#16c5d0',
	'#656903', '#007178', '#008be3', '#cd4ab0', '#de4181', '#8d66f1', '#d75a07', '#079f62',
	'#eabdfe', '#b19cfe', '#7cc54d', '#f07fd4', '#f19601', '#d3a813', '#4158bd', '#a62f5f'
] as const;

/** The first palette colour not in `used` (wraps around if all 40 are taken). */
export function nextPlayerColor(used: Iterable<string>): string {
	const taken = new Set(used);
	return PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[taken.size % PLAYER_COLORS.length]!;
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function textColorOn(hex: string): '#000000' | '#ffffff' {
	const n = Number.parseInt(hex.slice(1), 16);
	const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	const lum = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
	return lum > 0.179 ? '#000000' : '#ffffff';
}
