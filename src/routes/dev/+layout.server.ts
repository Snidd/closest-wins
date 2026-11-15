/**
 * The /dev/* playgrounds (no auth, fake data) exist only under `vite dev`, or in a production
 * build started with DEV_PAGES=1 (the e2e suite runs the map tests against the built app).
 * Everywhere else they are a plain 404.
 */
import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import { DEV_PAGES } from '$app/env/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	if (!dev && !DEV_PAGES) error(404, 'Not found');
};
