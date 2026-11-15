/**
 * Photo file storage under `DATA_DIR/media/<fileKey>/<size>.webp`, served by
 * `/media/[...key]` at `photoUrl(fileKey, size)`.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PhotoSize } from '#lib/game/types.ts';
import { mediaDir } from '../files/paths.ts';

export { mediaDir } from '../files/paths.ts';

/** Random, URL-safe and never derived from the answer (it is visible to players). */
export function newFileKey(): string {
	return randomBytes(16).toString('base64url');
}

/** Keys we generate are 22 base64url chars; refuse anything that could escape the media dir. */
const FILE_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

function keyDir(fileKey: string, root: string): string {
	if (!FILE_KEY_RE.test(fileKey)) throw new Error(`Invalid photo file key: ${fileKey}`);
	return path.join(root, fileKey);
}

/**
 * Writes all variants atomically: into a hidden temp dir next to the final one (same file system,
 * never served because `/media` refuses dot-segments), then one `rename`.
 */
export async function writePhotoFiles(
	fileKey: string,
	variants: Record<PhotoSize, Uint8Array>,
	root: string = mediaDir()
): Promise<void> {
	const finalDir = keyDir(fileKey, root);
	await mkdir(root, { recursive: true });
	const tmpDir = path.join(root, `.tmp-${fileKey}-${randomBytes(6).toString('hex')}`);
	await mkdir(tmpDir);
	try {
		for (const [size, bytes] of Object.entries(variants)) {
			await writeFile(path.join(tmpDir, `${size}.webp`), bytes, { flag: 'wx' });
		}
		// Fails (ENOTEMPTY/EEXIST) instead of replacing if the key is somehow taken.
		await rename(tmpDir, finalDir);
	} catch (e) {
		await rm(tmpDir, { recursive: true, force: true });
		throw e;
	}
}

export async function deletePhotoFiles(fileKey: string, root: string = mediaDir()): Promise<void> {
	await rm(keyDir(fileKey, root), { recursive: true, force: true });
}
