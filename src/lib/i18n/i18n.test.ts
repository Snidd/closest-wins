import { describe, expect, it } from 'vitest';
import { detectLocale } from './locale.ts';
import { localized, missingLocales } from './localized.ts';
import { common } from './common.ts';
import { player } from './player.ts';
import { host } from './host.ts';
import { tv } from './tv.ts';
import { admin } from './admin.ts';
import { map } from './map.ts';

describe('detectLocale', () => {
	it.each([
		[null, 'en'],
		['', 'en'],
		['sv', 'sv'],
		['sv-SE,sv;q=0.9,en;q=0.8', 'sv'],
		['sv-FI', 'sv'],
		['en-US,en;q=0.9,sv;q=0.8', 'en'],
		['de-DE,sv;q=0.9', 'en'],
		['en;q=0.5, sv;q=0.9', 'sv'],
		['nb-NO', 'en'],
		['*', 'en']
	] as const)('%s → %s', (header, expected) => {
		expect(detectLocale(header)).toBe(expected);
	});
});

describe('localized', () => {
	const loc = { nameSv: 'Eiffeltornet', nameEn: 'Eiffel Tower', factSv: null, factEn: 'Tall.', clueTextSv: '  ', clueTextEn: '' };

	it('returns the requested language', () => {
		expect(localized(loc, 'name', 'sv')).toBe('Eiffeltornet');
		expect(localized(loc, 'name', 'en')).toBe('Eiffel Tower');
	});

	it('falls back to the other language (sv → en and en → sv)', () => {
		expect(localized(loc, 'fact', 'sv')).toBe('Tall.');
		expect(localized({ factSv: 'Hög.', factEn: undefined }, 'fact', 'en')).toBe('Hög.');
	});

	it('treats blank as missing and returns empty string when both are missing', () => {
		expect(localized(loc, 'clueText', 'sv')).toBe('');
		expect(missingLocales(loc, 'clueText')).toEqual(['sv', 'en']);
		expect(missingLocales(loc, 'fact')).toEqual(['sv']);
	});
});

describe('dictionaries', () => {
	it.each([
		['common', common],
		['player', player],
		['host', host],
		['tv', tv],
		['admin', admin]
	] as const)('%s has identical keys and kinds in sv and en', (_name, dict) => {
		const en = dict.en as Record<string, unknown>;
		const sv = dict.sv as Record<string, unknown>;
		expect(Object.keys(sv).sort()).toEqual(Object.keys(en).sort());
		for (const key of Object.keys(en)) expect(typeof sv[key], key).toBe(typeof en[key]);
	});

	it('formats parameterised messages', () => {
		expect(common.en.roundOf(2, 10)).toBe('Round 2 of 10');
		expect(common.sv.roundOf(2, 10)).toBe('Runda 2 av 10');
		expect(common.sv.km(3.25)).toBe('3,3 km');
	});

	it('formats distances the same way on every surface', () => {
		for (const km of [0.004, 0.42, 3.25, 12.6, 1234.4]) {
			expect(common.en.km(km)).toBe(player.en.distance(km));
			expect(common.sv.km(km)).toBe(player.sv.distance(km));
			expect(common.en.km(km)).toBe(map.en.km(km));
			expect(common.sv.km(km)).toBe(map.sv.km(km));
		}
		expect(common.en.km(0.42)).toBe('420 m');
		expect(common.en.km(1234.4)).toBe('1,234 km');
		expect(common.sv.km(1234.4)).toBe('1\u00a0234 km');
	});
});
