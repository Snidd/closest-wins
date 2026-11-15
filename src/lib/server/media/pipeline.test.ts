import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PHOTO_SIZES } from '#lib/game/types.ts';
import { ContentError } from '../content/errors.ts';
import { MAX_IMAGE_PIXELS } from './limits.ts';
import { processImage } from './pipeline.ts';
import { deletePhotoFiles, newFileKey, writePhotoFiles } from './store.ts';

const GPS = {
	GPSLatitudeRef: 'N',
	GPSLatitude: '48/1 51/1 30/1',
	GPSLongitudeRef: 'E',
	GPSLongitude: '2/1 17/1 40/1'
};

/** A JPEG with EXIF GPS (the Eiffel Tower), camera make, XMP and orientation 6 (rotate 90° CW). */
async function jpegWithGps(width: number, height: number) {
	return sharp({ create: { width, height, channels: 3, background: '#c33' } })
		.jpeg()
		.withMetadata({ orientation: 6 })
		.withExifMerge({ IFD0: { Make: 'SpyCam', Copyright: 'secret' }, IFD3: GPS })
		.withXmp(
			'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="48,51.5N"/></rdf:RDF></x:xmpmeta>'
		)
		.toBuffer();
}

const contains = (haystack: Uint8Array, needle: string) =>
	Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));

describe('processImage', () => {
	it('strips EXIF/GPS/XMP and auto-orients', async () => {
		const input = await jpegWithGps(3000, 2000);
		const inMeta = await sharp(input).metadata();
		// Sanity: the input really carries GPS (IFD pointer tag 0x8825) and orientation.
		expect(inMeta.orientation).toBe(6);
		expect(inMeta.exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);
		expect(inMeta.xmp).toBeDefined();

		const out = await processImage(input);
		// Rotated: 3000x2000 landscape becomes portrait, longest edge 1920.
		expect(out.width).toBe(1280);
		expect(out.height).toBe(1920);

		for (const [size, edge] of Object.entries(PHOTO_SIZES)) {
			const bytes = out.variants[size as keyof typeof PHOTO_SIZES];
			const meta = await sharp(bytes).metadata();
			expect(meta.format).toBe('webp');
			expect(Math.max(meta.width!, meta.height!)).toBe(edge);
			expect(meta.height! > meta.width!).toBe(true);
			expect(meta.exif).toBeUndefined();
			expect(meta.xmp).toBeUndefined();
			expect(meta.iptc).toBeUndefined();
			expect(meta.icc).toBeUndefined();
			expect(meta.orientation).toBeUndefined();
			for (const marker of ['Exif', 'EXIF', 'XMP ', 'SpyCam', 'secret', 'GPS', 'xmpmeta']) {
				expect(contains(bytes, marker), `${size} contains ${marker}`).toBe(false);
			}
		}
	});

	it('never upscales small images', async () => {
		const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#09c' } })
			.png()
			.toBuffer();
		const out = await processImage(small);
		expect(out.width).toBe(300);
		expect(out.height).toBe(200);
		for (const bytes of Object.values(out.variants)) {
			const meta = await sharp(bytes).metadata();
			expect([meta.width, meta.height]).toEqual([300, 200]);
		}
	});

	it('accepts webp, gif, avif and tiff', async () => {
		const img = sharp({ create: { width: 64, height: 32, channels: 4, background: '#0c0' } });
		for (const fmt of ['webp', 'gif', 'avif', 'tiff'] as const) {
			const out = await processImage(await img.clone().toFormat(fmt).toBuffer());
			expect(out.width, fmt).toBe(64);
		}
	});

	const rejects = async (input: Uint8Array, pattern: RegExp) => {
		const err = await processImage(input).then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(ContentError);
		expect((err as ContentError).code).toBe('INVALID');
		expect((err as ContentError).message).toMatch(pattern);
	};

	it('rejects non-images, SVG and empty input', async () => {
		await rejects(new Uint8Array(), /empty/);
		await rejects(new TextEncoder().encode('hello, not an image'), /not a supported image/);
		await rejects(
			new TextEncoder().encode(
				'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
			),
			/not a supported image/
		);
		const truncated = (await jpegWithGps(400, 300)).subarray(0, 200);
		await rejects(truncated, /not a supported image|could not be processed/);
	});

	it('rejects decompression bombs before decoding', async () => {
		// A tiny PNG whose IHDR declares more pixels than MAX_IMAGE_PIXELS.
		const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 100;
		const bomb = Buffer.from(
			await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer()
		);
		bomb.writeUInt32BE(side, 16);
		bomb.writeUInt32BE(side, 20);
		bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
		expect(bomb.byteLength).toBeLessThan(1024);
		await rejects(bomb, /too many pixels/);

		// Within the per-side limit but over the total pixel count.
		bomb.writeUInt32BE(20_000, 16);
		bomb.writeUInt32BE(10_000, 20);
		bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
		await rejects(bomb, /too many pixels/);
	});
});

describe('photo store', () => {
	let root: string;
	beforeAll(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'cw-media-'));
	});
	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('writes all variants atomically under <key>/<size>.webp and deletes them', async () => {
		const key = newFileKey();
		expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const variants = { sm: new Uint8Array([1]), md: new Uint8Array([2]), lg: new Uint8Array([3]) };
		await writePhotoFiles(key, variants, root);
		expect((await readdir(path.join(root, key))).sort()).toEqual(['lg.webp', 'md.webp', 'sm.webp']);
		expect([...(await readFile(path.join(root, key, 'md.webp')))]).toEqual([2]);
		// No temp dirs left behind.
		expect((await readdir(root)).filter((n) => n.startsWith('.'))).toEqual([]);

		await expect(writePhotoFiles(key, variants, root)).rejects.toThrow();
		expect((await readdir(root)).filter((n) => n.startsWith('.'))).toEqual([]);

		await deletePhotoFiles(key, root);
		expect(await readdir(root)).toEqual([]);
	});

	it('refuses keys that could escape the media directory', async () => {
		const variants = { sm: new Uint8Array(), md: new Uint8Array(), lg: new Uint8Array() };
		for (const bad of ['../../etc', 'a/b', '.hidden-key-123456', 'short']) {
			await expect(writePhotoFiles(bad, variants, root)).rejects.toThrow(/Invalid photo file key/);
			await expect(deletePhotoFiles(bad, root)).rejects.toThrow(/Invalid photo file key/);
		}
	});
});
