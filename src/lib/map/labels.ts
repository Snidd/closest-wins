/**
 * Greedy collision-free placement of pin labels (pure; unit tested).
 *
 * Every pin keeps its dot at the exact position; its label tries a few anchor positions
 * around the dot in priority order and takes the first that overlaps neither another label,
 * another dot nor the viewport edge. Labels that do not fit are hidden (the dot stays), so
 * 40 pins on one spot stay readable: the most important labels win.
 */

export const LABEL_POSITIONS = ['n', 'e', 'w', 's', 'ne', 'nw', 'se', 'sw'] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];

export interface LabelItem {
	id: string;
	/** Dot centre in px. */
	x: number;
	y: number;
	/** Label size in px. */
	w: number;
	h: number;
	/** Previous position (kept when still free, so labels do not jump around while moving). */
	prev?: LabelPosition | null;
	/** Always show this label (e.g. the winner): if no free spot, take the least crowded one. */
	force?: boolean;
}

export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Label box for a position; `gap` is the distance from the dot centre to the label. */
export function labelBox(item: LabelItem, pos: LabelPosition, gap: number): Box {
	const { x, y, w, h } = item;
	const d = gap * 0.75;
	switch (pos) {
		case 'n':
			return { x0: x - w / 2, y0: y - gap - h, x1: x + w / 2, y1: y - gap };
		case 's':
			return { x0: x - w / 2, y0: y + gap, x1: x + w / 2, y1: y + gap + h };
		case 'e':
			return { x0: x + gap, y0: y - h / 2, x1: x + gap + w, y1: y + h / 2 };
		case 'w':
			return { x0: x - gap - w, y0: y - h / 2, x1: x - gap, y1: y + h / 2 };
		case 'ne':
			return { x0: x + d, y0: y - d - h, x1: x + d + w, y1: y - d };
		case 'nw':
			return { x0: x - d - w, y0: y - d - h, x1: x - d, y1: y - d };
		case 'se':
			return { x0: x + d, y0: y + d, x1: x + d + w, y1: y + d + h };
		case 'sw':
			return { x0: x - d - w, y0: y + d, x1: x - d, y1: y + d + h };
	}
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Places labels for `items` (already sorted by priority, most important first).
 * `dotRadius` blocks the area around every dot; `viewport` keeps labels on screen.
 * `obstacles` are extra boxes to avoid (e.g. the target marker).
 */
export function placeLabels(
	items: LabelItem[],
	opts: { dotRadius: number; gap: number; viewport: { width: number; height: number }; obstacles?: Box[] }
): Map<string, LabelPosition | null> {
	const { dotRadius: r, gap, viewport } = opts;
	const placed: Box[] = [...(opts.obstacles ?? [])];
	const dots = items.map((i) => ({ id: i.id, box: { x0: i.x - r, y0: i.y - r, x1: i.x + r, y1: i.y + r } }));
	const result = new Map<string, LabelPosition | null>();
	for (const item of items) {
		const order = item.prev ? [item.prev, ...LABEL_POSITIONS.filter((p) => p !== item.prev)] : LABEL_POSITIONS;
		let chosen: LabelPosition | null = null;
		let fallback: { pos: LabelPosition; hits: number } | null = null;
		for (const pos of order) {
			const b = labelBox(item, pos, gap);
			if (b.x0 < 0 || b.y0 < 0 || b.x1 > viewport.width || b.y1 > viewport.height) continue;
			const hits =
				placed.filter((p) => overlaps(p, b)).length +
				dots.filter((d) => d.id !== item.id && overlaps(d.box, b)).length;
			if (hits === 0) {
				chosen = pos;
				break;
			}
			if (item.force && (!fallback || hits < fallback.hits)) fallback = { pos, hits };
		}
		chosen ??= fallback?.pos ?? null;
		if (chosen) placed.push(labelBox(item, chosen, gap));
		result.set(item.id, chosen);
	}
	return result;
}
