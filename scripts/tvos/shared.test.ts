import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { common } from '../../src/lib/i18n/common.ts';
import { tv } from '../../src/lib/i18n/tv.ts';
import { buildShared, renderMessage, SHARED_JSON_PATH, serializeShared } from './shared.ts';

describe('tvos shared.json', () => {
	it('is up to date with the web code', () => {
		let committed: string;
		try {
			committed = readFileSync(resolve(import.meta.dirname, '../..', SHARED_JSON_PATH), 'utf8');
		} catch {
			throw new Error(`${SHARED_JSON_PATH} is missing: run pnpm tvos:export`);
		}
		expect(committed, `${SHARED_JSON_PATH} is out of date: run pnpm tvos:export`).toBe(serializeShared());
	});

	it('renders templates exactly like the web dictionaries', () => {
		const { strings } = buildShared();
		expect(renderMessage(strings.tv!.en.guessCount!, { n: 1 })).toBe(tv.en.guessCount(1));
		expect(renderMessage(strings.tv!.en.guessCount!, { n: 4 })).toBe(tv.en.guessCount(4));
		expect(renderMessage(strings.tv!.sv.roundsAndTimer!, { rounds: 1, seconds: 30 })).toBe(tv.sv.roundsAndTimer(1, 30));
		expect(renderMessage(strings.tv!.en.roundsAndTimer!, { rounds: 5, seconds: 45 })).toBe('5 rounds · 45 s each');
		expect(renderMessage(strings.tv!.sv.away!, { km: '1 234 km' })).toBe(tv.sv.away('1 234 km'));
		expect(renderMessage(strings.common!.sv.km!, { km: 3.25 }, 'sv')).toBe(common.sv.km(3.25));
	});

	it('exports every TV and common message in both languages (except the listed omissions)', () => {
		const shared = buildShared();
		const omitted = new Set(shared.omittedStrings.map((o) => `${o.dict}.${o.key}`));
		for (const [name, dict] of [
			['tv', tv],
			['common', common]
		] as const) {
			for (const locale of ['en', 'sv'] as const) {
				const expected = Object.keys(dict[locale]).filter((k) => !omitted.has(`${name}.${k}`));
				expect(Object.keys(shared.strings[name]![locale])).toEqual(expected);
			}
		}
	});
});
