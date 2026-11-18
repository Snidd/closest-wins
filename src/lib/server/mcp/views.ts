/** Content rows → the concise tool outputs declared in `schemas.ts`. */
import type { z } from 'zod';
import { photoUrl } from '#lib/game/types.ts';
import {
	locationMissing,
	type LocationListItem,
	type LocationWithPhoto,
	type PlaylistSummary,
	type PlaylistWithItems
} from '#lib/server/content/index.ts';
import type { Location, Photo, Playlist } from '#lib/server/db/schema.ts';
import type {
	LocationOut,
	LocationSummaryOut,
	PhotoOut,
	PlaylistOut,
	PlaylistSummaryOut
} from './schemas.ts';

const filled = (s: string | null) => !!s?.trim();

/** Absolute URLs need the public origin of the request (photo URLs are root-relative). */
export interface ViewContext {
	origin: string;
}

export function photoOut(photo: Photo, ctx: ViewContext): z.infer<typeof PhotoOut> {
	return {
		id: photo.id,
		url: new URL(photoUrl(photo.fileKey, 'md'), ctx.origin).href,
		width: photo.width,
		height: photo.height,
		attribution: photo.attribution,
		sourceUrl: photo.sourceUrl
	};
}

export function locationOut(l: Location, photo: Photo | null, ctx: ViewContext): z.infer<typeof LocationOut> {
	return {
		id: l.id,
		nameSv: l.nameSv,
		nameEn: l.nameEn,
		clueTextSv: l.clueTextSv,
		clueTextEn: l.clueTextEn,
		factSv: l.factSv,
		factEn: l.factEn,
		lat: l.lat,
		lng: l.lng,
		startView:
			l.startLat !== null && l.startLng !== null && l.startZoom !== null
				? { lat: l.startLat, lng: l.startLng, zoom: l.startZoom }
				: null,
		photo: photo ? photoOut(photo, ctx) : null,
		missingTranslations: locationMissing(l),
		updatedAt: l.updatedAt.toISOString()
	};
}

export function locationSummary(
	l: Location | LocationWithPhoto | LocationListItem
): z.infer<typeof LocationSummaryOut> {
	return {
		id: l.id,
		nameSv: l.nameSv,
		nameEn: l.nameEn,
		lat: l.lat,
		lng: l.lng,
		hasPhoto: !!l.photoId,
		hasClueText: filled(l.clueTextSv) || filled(l.clueTextEn),
		missingTranslations: locationMissing(l),
		...('playlistCount' in l ? { playlistCount: l.playlistCount } : {})
	};
}

export function playlistSummary(p: PlaylistSummary): z.infer<typeof PlaylistSummaryOut> {
	return {
		id: p.id,
		nameSv: p.nameSv,
		nameEn: p.nameEn,
		defaultTimerSeconds: p.defaultTimerSeconds,
		locationCount: p.locationCount,
		missingTranslationCount: p.missingTranslationCount,
		updatedAt: p.updatedAt.toISOString()
	};
}

export function playlistOut(p: PlaylistWithItems | (Playlist & { items?: undefined })): z.infer<typeof PlaylistOut> {
	const items = p.items ?? [];
	return {
		id: p.id,
		nameSv: p.nameSv,
		nameEn: p.nameEn,
		defaultTimerSeconds: p.defaultTimerSeconds,
		locationCount: items.length,
		locations: items.map((i) => ({ position: i.position, ...locationSummary(i.location) }))
	};
}
