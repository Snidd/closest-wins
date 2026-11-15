/**
 * Drift guard: the zod shapes the MCP tools advertise must accept and reject the same values as
 * the shared valibot schemas (`#lib/content/schemas.ts`) at every per-field boundary. (Known,
 * deliberate differences: MCP also accepts `null` for "empty/clear", which `schemas.ts` maps to
 * '', and only takes http(s) URLs, which the importer requires anyway.)
 */
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
	IdSchema,
	ImportPhotoSchema,
	ListQuerySchema,
	LocationFields,
	PlaylistFields,
	SetPlaylistItemsSchema,
	TEXT_MAX
} from '#lib/content/schemas.ts';
import * as S from './schemas.ts';

function same(name: string, zod: z.ZodType, valibot: v.GenericSchema, samples: unknown[]) {
	for (const sample of samples) {
		const z = zod.safeParse(sample).success;
		const vb = v.safeParse(valibot, sample).success;
		const shown = typeof sample === 'string' && sample.length > 40 ? `string(${sample.length})` : JSON.stringify(sample);
		expect(z, `${name} ${shown}: zod ${z} vs valibot ${vb}`).toBe(vb);
	}
}

const strings = (max: number) => ['', 'a', '  padded  ', 'x'.repeat(max), 'x'.repeat(max + 1), ` ${'x'.repeat(max)} `, undefined];
const nums = (min: number, max: number, int = false) => [
	min - 1,
	min,
	max,
	max + 1,
	int ? min + 0.5 : (min + max) / 2 + 0.123456,
	Number.POSITIVE_INFINITY,
	Number.NaN,
	'1'
];

describe('MCP zod shapes match the shared valibot schemas', () => {
	it('location fields', () => {
		const create = S.CreateLocationArgs.shape;
		const patch = S.UpdateLocationArgs.shape;
		for (const f of S.LOCATION_TEXT_FIELDS) {
			const max = f.startsWith('name') ? TEXT_MAX.name : f.startsWith('clue') ? TEXT_MAX.clue : TEXT_MAX.fact;
			same(f, create[f], LocationFields.entries[f], strings(max));
			same(`patch ${f}`, patch[f], LocationFields.entries[f], strings(max));
		}
		same('lat', create.lat, LocationFields.entries.lat, [...nums(-90, 90), -89.999999, 0]);
		same('lng', create.lng, LocationFields.entries.lng, [...nums(-180, 180), 179.999999, 0]);
	});

	it('playlist fields and lists', () => {
		const timer = S.CreatePlaylistArgs.shape.defaultTimerSeconds.unwrap();
		same('defaultTimerSeconds', timer, PlaylistFields.entries.defaultTimerSeconds, nums(5, 600, true));
		same('playlist nameSv', S.CreatePlaylistArgs.shape.nameSv, PlaylistFields.entries.nameSv, strings(TEXT_MAX.name));

		const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
		const one = randomUUID();
		same('locationIds', S.SetPlaylistLocationsArgs.shape.locationIds, SetPlaylistItemsSchema.entries.locationIds, [
			[],
			ids(3),
			ids(S.LIMITS.playlistLocations),
			ids(S.LIMITS.playlistLocations + 1),
			['nope']
		]);
		// Duplicates pass the zod shape but are rejected by the shared schema (and reported by it).
		expect(v.safeParse(SetPlaylistItemsSchema.entries.locationIds, [one, one]).success).toBe(false);

		same('limit', S.ListLocationsArgs.shape.limit, ListQuerySchema.entries.limit, [...nums(1, 200, true), undefined]);
		same('offset', S.ListLocationsArgs.shape.offset, ListQuerySchema.entries.offset, [-1, 0, 10, 1.5, undefined]);
		same('query', S.ListLocationsArgs.shape.query, ListQuerySchema.entries.query, strings(S.LIMITS.query));
	});

	it('ids and photo fields', () => {
		same('id', S.IdArgs('location').shape.id, IdSchema.entries.id, [
			randomUUID(),
			randomUUID().toUpperCase(),
			'6ba7b810-9dad-11d1-80b4-00c04fd430c8', // v1
			'00000000-0000-0000-0000-000000000000',
			'not-a-uuid',
			'',
			42
		]);
		const url = (n: number) => `https://example.com/${'a'.repeat(n - 'https://example.com/'.length)}`;
		same('url', S.AttachPhotoArgs.shape.url, ImportPhotoSchema.entries.url, [
			'https://upload.wikimedia.org/x.jpg',
			'http://example.com/a.png',
			url(S.LIMITS.url),
			url(S.LIMITS.url + 1),
			'not a url',
			''
		]);
		expect(S.AttachPhotoArgs.shape.url.safeParse('ftp://example.com/x.png').success).toBe(false);
		same('attribution', S.AttachPhotoArgs.shape.attribution, ImportPhotoSchema.entries.attribution, strings(TEXT_MAX.attribution));
		same('sourceUrl', S.AttachPhotoArgs.shape.sourceUrl, ImportPhotoSchema.entries.sourceUrl, [
			'https://commons.wikimedia.org/wiki/File:X.jpg',
			url(S.LIMITS.url + 1),
			'nope',
			undefined
		]);
	});
});
