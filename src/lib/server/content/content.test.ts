/**
 * Content services against the dev database (`docker compose up -d db && pnpm db:migrate`).
 * The database is shared with other agents/devs: every row created here has a unique tag, only
 * those rows are deleted, and nothing asserts on total row counts.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import * as v from 'valibot';
import { afterAll, describe, expect, it } from 'vitest';
import { LocationInputSchema, type LocationInput } from '#lib/content/schemas.ts';
import { client, db } from '#lib/server/db/index.ts';
import { game, gameRound, location, photo, playlist } from '#lib/server/db/schema.ts';
import { mediaDir } from '../files/paths.ts';
import {
	attachPhoto,
	cleanupOrphanPhotos,
	ContentError,
	createLocation,
	createPhotoFromBytes,
	createPlaylist,
	deleteLocation,
	deletePhoto,
	deletePlaylist,
	getLocation,
	getPhoto,
	getPlaylist,
	importPhotoFromUrl,
	listLocations,
	listPlaylists,
	locationUsage,
	parseContent,
	addPlaylistItems,
	removePlaylistItems,
	setPlaylistItems,
	toPhotoView,
	updateLocation,
	updatePlaylist,
	uploadPhoto
} from './index.ts';

const TAG = `zzt${randomUUID().slice(0, 8)}`;
const created = { locations: new Set<string>(), playlists: new Set<string>(), photos: new Set<string>(), games: new Set<string>() };

afterAll(async () => {
	if (created.games.size) await db.delete(game).where(inArray(game.id, [...created.games]));
	if (created.playlists.size) await db.delete(playlist).where(inArray(playlist.id, [...created.playlists]));
	if (created.locations.size) await db.delete(location).where(inArray(location.id, [...created.locations]));
	for (const id of created.photos) {
		const p = await getPhoto(id);
		if (p) {
			await db.delete(photo).where(eq(photo.id, id));
			await import('../media/store.ts').then((m) => m.deletePhotoFiles(p.fileKey));
		}
	}
	await client.end();
});

const input = (overrides: Partial<v.InferInput<typeof LocationInputSchema>> = {}): LocationInput =>
	parseContent(LocationInputSchema, {
		nameEn: `${TAG} Place`,
		clueTextEn: 'A clue',
		lat: 10,
		lng: 20,
		...overrides
	});

async function newLocation(overrides: Partial<v.InferInput<typeof LocationInputSchema>> = {}) {
	const row = await createLocation(input(overrides));
	created.locations.add(row.id);
	return row;
}

async function newPhoto(color = '#36c') {
	const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
		.jpeg()
		.withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '59/1 19/1 0/1' } })
		.toBuffer();
	const p = await createPhotoFromBytes(bytes, { sourceUrl: 'https://example.com/p', attribution: 'Test' });
	created.photos.add(p.id);
	return p;
}

const filesExist = (fileKey: string) =>
	['sm', 'md', 'lg'].every((s) => existsSync(path.join(mediaDir(), fileKey, `${s}.webp`)));

async function expectCode(p: Promise<unknown>, code: ContentError['code'], pattern?: RegExp) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err, 'expected a ContentError').toBeInstanceOf(ContentError);
	expect((err as ContentError).code).toBe(code);
	if (pattern) expect((err as ContentError).message).toMatch(pattern);
}

describe('parseContent', () => {
	it('returns the parsed value or throws INVALID with every issue', () => {
		expect(parseContent(LocationInputSchema, { nameSv: ' Hej ', clueTextSv: 'x', lat: 1, lng: 2 }).nameSv).toBe('Hej');
		expect(() => parseContent(LocationInputSchema, { lat: 100, lng: 2 })).toThrow(ContentError);
		try {
			parseContent(LocationInputSchema, { nameEn: 'x', clueTextEn: 'y', lat: 100, lng: 2 });
		} catch (e) {
			expect((e as ContentError).code).toBe('INVALID');
			expect((e as ContentError).message).toMatch(/^lat:/);
		}
	});
});

describe('locations', () => {
	it('creates, reads and lists with search in both languages', async () => {
		const a = await newLocation({ nameSv: `${TAG} Eiffeltornet`, nameEn: `${TAG} Eiffel Tower`, factEn: 'Tall' });
		const b = await newLocation({ nameSv: `${TAG} Kebnekaise`, nameEn: '', clueTextSv: 'Högsta berget', clueTextEn: '' });
		expect(a.nameSv).toBe(`${TAG} Eiffeltornet`);

		const got = await getLocation(a.id);
		expect(got?.photo).toBeNull();
		expect(await getLocation(randomUUID())).toBeNull();
		expect(await getLocation('not-a-uuid')).toBeNull();

		const sv = await listLocations({ query: `${TAG} eiffeltornet`, limit: 50, offset: 0 });
		expect(sv.items.map((i) => i.id)).toEqual([a.id]);
		const en = await listLocations({ query: `tower ${TAG}`, limit: 50, offset: 0 });
		expect(en.items.map((i) => i.id)).toEqual([a.id]);
		const clue = await listLocations({ query: `${TAG} BERGET`, limit: 50, offset: 0 });
		expect(clue.items.map((i) => i.id)).toEqual([b.id]);
		// LIKE wildcards are literal.
		expect((await listLocations({ query: `${TAG}%`, limit: 50, offset: 0 })).total).toBe(0);

		const all = await listLocations({ query: TAG, limit: 50, offset: 0 });
		expect(all.total).toBe(2);
		const itemA = all.items.find((i) => i.id === a.id)!;
		expect(itemA.missing).toEqual({ name: [], clueText: ['sv'], fact: ['sv'] });
		expect(itemA.playlistCount).toBe(0);
		const itemB = all.items.find((i) => i.id === b.id)!;
		expect(itemB.missing).toEqual({ name: ['en'], clueText: ['en'], fact: [] });
	});

	it('paginates newest first', async () => {
		const tag = `${TAG}page`;
		const rows = [];
		for (let i = 0; i < 3; i++) rows.push(await newLocation({ nameEn: `${tag} ${i}` }));
		const p1 = await listLocations({ query: tag, limit: 2, offset: 0 });
		const p2 = await listLocations({ query: tag, limit: 2, offset: 2 });
		expect(p1.total).toBe(3);
		expect(p1.items.map((i) => i.nameEn)).toEqual([`${tag} 2`, `${tag} 1`]);
		expect(p2.items.map((i) => i.nameEn)).toEqual([`${tag} 0`]);
	});

	it('enforces the content rules on create and on the merged row on update', async () => {
		await expectCode(createLocation({ ...input(), nameEn: null }), 'INVALID', /name/);
		await expectCode(createLocation({ ...input(), clueTextEn: null }), 'INVALID', /photo or a clue/);
		await expectCode(createLocation({ ...input(), lat: 91 }), 'INVALID', /Latitude/);
		// The map cannot show (nor a phone aim at) the poles.
		await expectCode(createLocation({ ...input(), lat: 85.5 }), 'INVALID', /Latitude/);
		await expectCode(createLocation({ ...input(), lat: -89 }), 'INVALID', /Latitude/);
		await expectCode(createLocation({ ...input(), nameEn: 'x'.repeat(121) }), 'INVALID', /at most/);
		await expectCode(createLocation({ ...input(), photoId: randomUUID() }), 'INVALID', /photo/);

		const l = await newLocation();
		await expectCode(updateLocation({ id: l.id, clueTextEn: null }), 'INVALID', /photo or a clue/);
		await expectCode(updateLocation({ id: l.id, nameEn: null }), 'INVALID', /name/);
		await expectCode(updateLocation({ id: l.id, lat: 86 }), 'INVALID', /Latitude/);
		await expectCode(updateLocation({ id: randomUUID(), nameEn: 'x' }), 'NOT_FOUND');

		const updated = await updateLocation({ id: l.id, nameSv: `  ${TAG} Ny  `, lat: -33.5 });
		expect(updated.nameSv).toBe(`${TAG} Ny`);
		expect(updated.nameEn).toBe(l.nameEn); // untouched
		expect(updated.lat).toBe(-33.5);
		expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(l.updatedAt.getTime());
	});

	it('refuses to delete a played location (IN_USE) and deletes unplayed ones', async () => {
		const played = await newLocation();
		const [g] = await db
			.insert(game)
			.values({ joinCode: 'ZZZZ', language: 'en', timerSeconds: 30, roundCount: 1, selection: 'first', phase: 'finished' })
			.returning();
		created.games.add(g!.id);
		await db.insert(gameRound).values({ gameId: g!.id, index: 0, locationId: played.id });

		expect(await locationUsage(played.id)).toEqual({ playlists: 0, games: 1 });
		await expectCode(deleteLocation(played.id), 'IN_USE', /game/);
		expect(await getLocation(played.id)).not.toBeNull();

		const free = await newLocation();
		await deleteLocation(free.id);
		expect(await getLocation(free.id)).toBeNull();
		await expectCode(deleteLocation(free.id), 'NOT_FOUND');
		await expectCode(locationUsage(free.id), 'NOT_FOUND');
	});
});

describe('playlists', () => {
	it('creates, orders items atomically, reorders and reports counts', async () => {
		const pl = await createPlaylist({ nameSv: `${TAG} Lista`, nameEn: null, defaultTimerSeconds: 45 });
		created.playlists.add(pl.id);
		const [a, b, c] = [
			await newLocation({ nameEn: `${TAG} A`, nameSv: `${TAG} A` }),
			await newLocation({ nameEn: `${TAG} B` }),
			await newLocation({ nameEn: `${TAG} C`, nameSv: `${TAG} C`, clueTextSv: 'C' })
		];

		await setPlaylistItems({ playlistId: pl.id, locationIds: [a!.id, b!.id, c!.id] });
		let got = await getPlaylist(pl.id);
		expect(got!.items.map((i) => [i.position, i.location.id])).toEqual([
			[0, a!.id],
			[1, b!.id],
			[2, c!.id]
		]);

		// Full reversal would collide on (playlist, position) without delete-then-insert.
		await setPlaylistItems({ playlistId: pl.id, locationIds: [c!.id, b!.id, a!.id] });
		got = await getPlaylist(pl.id);
		expect(got!.items.map((i) => i.location.id)).toEqual([c!.id, b!.id, a!.id]);
		expect(got!.items[0]!.location.photo).toBeNull();

		const summary = (await listPlaylists()).find((p) => p.id === pl.id)!;
		expect(summary.locationCount).toBe(3);
		// a: clue only in en; b: name + clue only in en; c: complete.
		expect(summary.missingTranslationCount).toBe(2);

		const usage = (await listLocations({ query: `${TAG} A`, limit: 5, offset: 0 })).items.find((i) => i.id === a!.id);
		expect(usage?.playlistCount).toBe(1);

		await expectCode(setPlaylistItems({ playlistId: pl.id, locationIds: [a!.id, a!.id] }), 'INVALID', /once/);
		await expectCode(setPlaylistItems({ playlistId: pl.id, locationIds: [randomUUID()] }), 'INVALID', /Unknown/);
		await expectCode(setPlaylistItems({ playlistId: randomUUID(), locationIds: [] }), 'NOT_FOUND');
		// A failed call leaves the order untouched.
		expect((await getPlaylist(pl.id))!.items.map((i) => i.location.id)).toEqual([c!.id, b!.id, a!.id]);

		// Deleting a location closes the gap in positions.
		await deleteLocation(b!.id);
		got = await getPlaylist(pl.id);
		expect(got!.items.map((i) => [i.position, i.location.id])).toEqual([
			[0, c!.id],
			[1, a!.id]
		]);

		await setPlaylistItems({ playlistId: pl.id, locationIds: [] });
		expect((await getPlaylist(pl.id))!.items).toEqual([]);
	});

	it('adds and removes items atomically, also when edits race', async () => {
		const pl = await createPlaylist({ nameSv: null, nameEn: `${TAG} Race`, defaultTimerSeconds: 30 });
		created.playlists.add(pl.id);
		const locs = [];
		for (let i = 0; i < 6; i++) locs.push(await newLocation({ nameEn: `${TAG} R${i}` }));
		const ids = locs.map((l) => l.id);

		await setPlaylistItems({ playlistId: pl.id, locationIds: [ids[0]!, ids[1]!] });
		expect(await addPlaylistItems(pl.id, [ids[2]!, ids[0]!], 1)).toEqual({ added: [ids[2]], alreadyInPlaylist: [ids[0]] });
		expect((await getPlaylist(pl.id))!.items.map((i) => i.location.id)).toEqual([ids[0], ids[2], ids[1]]);

		// Concurrent adds of different locations: none is lost (read-then-rewrite would drop some).
		await Promise.all([3, 4, 5].map((i) => addPlaylistItems(pl.id, [ids[i]!])));
		const after = (await getPlaylist(pl.id))!.items;
		expect(new Set(after.map((i) => i.location.id))).toEqual(new Set(ids));
		expect(after.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5]);

		const unknown = randomUUID();
		expect(await removePlaylistItems(pl.id, [ids[2]!, unknown])).toEqual({ removed: [ids[2]], notInPlaylist: [unknown] });
		await Promise.all([ids[3]!, ids[4]!].map((id) => removePlaylistItems(pl.id, [id])));
		expect((await getPlaylist(pl.id))!.items.map((i) => i.location.id).sort()).toEqual([ids[0], ids[1], ids[5]].sort());

		await expectCode(addPlaylistItems(pl.id, [randomUUID()]), 'INVALID', /Unknown/);
		await expectCode(addPlaylistItems(randomUUID(), [ids[0]!]), 'NOT_FOUND');
	});

	it('lists locations missing a translation', async () => {
		const svOnly = await newLocation({ nameEn: '', nameSv: `${TAG} Bara svenska`, clueTextEn: '', clueTextSv: 'Ledtråd' });
		const enFact = await newLocation({ nameEn: `${TAG} Fact gap`, nameSv: `${TAG} Fact gap`, clueTextSv: 'L', factEn: 'Only English' });
		const complete = await newLocation({ nameEn: `${TAG} Done`, nameSv: `${TAG} Klar`, clueTextSv: 'L' });
		const idsFor = async (missingTranslation: 'sv' | 'en' | 'any') =>
			(await listLocations({ query: TAG, missingTranslation, limit: 200, offset: 0 })).items.map((i) => i.id);
		const needSv = await idsFor('sv');
		const needEn = await idsFor('en');
		const any = await idsFor('any');
		expect(needEn).toContain(svOnly.id);
		expect(needSv).not.toContain(svOnly.id);
		expect(needSv).toContain(enFact.id);
		expect(any).toEqual(expect.arrayContaining([svOnly.id, enFact.id]));
		expect([...needSv, ...needEn, ...any]).not.toContain(complete.id);
	});

	it('validates, updates and deletes', async () => {
		await expectCode(createPlaylist({ nameSv: null, nameEn: '  ', defaultTimerSeconds: 30 }), 'INVALID', /name/);
		await expectCode(createPlaylist({ nameSv: 'x', nameEn: null, defaultTimerSeconds: 3 }), 'INVALID', /timer/);

		const pl = await createPlaylist({ nameSv: null, nameEn: `${TAG} List`, defaultTimerSeconds: 30 });
		created.playlists.add(pl.id);
		const up = await updatePlaylist({ id: pl.id, nameSv: `${TAG} Lista`, defaultTimerSeconds: 60 });
		expect([up.nameSv, up.nameEn, up.defaultTimerSeconds]).toEqual([`${TAG} Lista`, `${TAG} List`, 60]);
		await expectCode(updatePlaylist({ id: pl.id, nameSv: null, nameEn: null }), 'INVALID', /name/);
		await expectCode(updatePlaylist({ id: randomUUID(), nameEn: 'x' }), 'NOT_FOUND');

		await deletePlaylist(pl.id);
		expect(await getPlaylist(pl.id)).toBeNull();
		await expectCode(deletePlaylist(pl.id), 'NOT_FOUND');
	});
});

describe('photos', () => {
	it('stores processed variants and builds the photo view', async () => {
		const p = await newPhoto();
		expect([p.width, p.height]).toEqual([640, 480]);
		expect(filesExist(p.fileKey)).toBe(true);
		const view = toPhotoView(p);
		expect(view.urls.md).toBe(`/media/${p.fileKey}/md.webp`);
		const meta = await sharp(path.join(mediaDir(), p.fileKey, 'lg.webp')).metadata();
		expect(meta.exif).toBeUndefined();
	});

	it('attaches, replaces (deleting the unused old photo) and detaches', async () => {
		const l = await newLocation();
		const p1 = await newPhoto('#111');
		const p2 = await newPhoto('#222');

		await attachPhoto(l.id, p1.id);
		expect((await getLocation(l.id))!.photo?.id).toBe(p1.id);

		await attachPhoto(l.id, p2.id);
		expect((await getLocation(l.id))!.photoId).toBe(p2.id);
		expect(await getPhoto(p1.id)).toBeNull();
		expect(filesExist(p1.fileKey)).toBe(false);

		// A photo shared by two locations survives when one of them drops it.
		const other = await newLocation({ photoId: p2.id });
		await attachPhoto(l.id, null);
		expect(await getPhoto(p2.id)).not.toBeNull();
		await updateLocation({ id: other.id, photoId: null });
		expect(await getPhoto(p2.id)).toBeNull();

		await expectCode(attachPhoto(l.id, randomUUID()), 'NOT_FOUND');
		await expectCode(attachPhoto(randomUUID(), null), 'NOT_FOUND');
	});

	it('refuses to remove a photo that is the only clue', async () => {
		const p = await newPhoto();
		const l = await newLocation({ clueTextEn: '', photoId: p.id });
		await expectCode(attachPhoto(l.id, null), 'INVALID', /clue/);
		await expectCode(deletePhoto(p.id), 'IN_USE');

		await updateLocation({ id: l.id, clueTextSv: 'Nu finns en text' });
		await deletePhoto(p.id);
		expect((await getLocation(l.id))!.photoId).toBeNull();
		expect(filesExist(p.fileKey)).toBe(false);
		await expectCode(deletePhoto(p.id), 'NOT_FOUND');
	});

	it('uploads a File and attaches it; deleting the location deletes its photo', async () => {
		const l = await newLocation();
		const bytes = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0f0' } }).png().toBuffer();
		const p = await uploadPhoto({
			file: new File([bytes], 'x.png', { type: 'image/png' }),
			locationId: l.id,
			attribution: '  Me  ',
			sourceUrl: null
		});
		created.photos.add(p.id);
		expect(p.attribution).toBe('Me');
		expect((await getLocation(l.id))!.photoId).toBe(p.id);

		await expectCode(
			uploadPhoto({ file: new File(['nope'], 'x.txt'), attribution: null, sourceUrl: null }),
			'INVALID',
			/not a supported image/
		);
		await expectCode(
			uploadPhoto({ file: new File([bytes], 'x.png'), locationId: randomUUID(), attribution: null, sourceUrl: null }),
			'NOT_FOUND'
		);

		await deleteLocation(l.id);
		expect(await getPhoto(p.id)).toBeNull();
		expect(filesExist(p.fileKey)).toBe(false);
	});

	it('removes stale unattached photos only', async () => {
		const stale = await newPhoto();
		const fresh = await newPhoto();
		await db
			.update(photo)
			.set({ createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) })
			.where(eq(photo.id, stale.id));
		await cleanupOrphanPhotos();
		expect(await getPhoto(stale.id)).toBeNull();
		expect(filesExist(stale.fileKey)).toBe(false);
		expect(await getPhoto(fresh.id)).not.toBeNull();
	});

	it('URL import goes through the SSRF guard', async () => {
		await expectCode(
			importPhotoFromUrl({ url: 'http://127.0.0.1:5432/x.png', attribution: null, sourceUrl: null }),
			'IMPORT_FAILED',
			/not allowed/
		);
		await expectCode(
			importPhotoFromUrl({ url: 'https://example.com/x.png', locationId: randomUUID(), attribution: null, sourceUrl: null }),
			'NOT_FOUND'
		);
	});
});
