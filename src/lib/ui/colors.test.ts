import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS, nextPlayerColor, textColorOn } from './colors.ts';
import { MAX_PLAYERS } from '#lib/game/types.ts';

describe('PLAYER_COLORS', () => {
	it('has a distinct colour for every possible player', () => {
		expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
		expect(new Set(PLAYER_COLORS).size).toBe(PLAYER_COLORS.length);
		for (const c of PLAYER_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('is mirrored exactly in app.css', () => {
		const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
		const vars = [...css.matchAll(/--player-(\d+):\s*(#[0-9a-f]{6});/g)].map((m) => [Number(m[1]), m[2]]);
		expect(vars).toEqual(PLAYER_COLORS.map((c, i) => [i, c]));
	});

	it('nextPlayerColor skips used colours', () => {
		expect(nextPlayerColor([])).toBe(PLAYER_COLORS[0]);
		expect(nextPlayerColor([PLAYER_COLORS[0], PLAYER_COLORS[1]])).toBe(PLAYER_COLORS[2]);
	});

	it('textColorOn picks a readable text colour', () => {
		expect(textColorOn('#ffffff')).toBe('#000000');
		expect(textColorOn('#000000')).toBe('#ffffff');
	});
});
