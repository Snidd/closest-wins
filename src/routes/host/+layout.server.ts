import { requireAdminPage } from '#lib/server/auth/index.ts';
import type { LayoutServerLoad } from './$types';

/** Every page below requires the admin session (remote functions check it again themselves). */
export const load: LayoutServerLoad = ({ locals, url }) => {
	requireAdminPage(url, locals);
};
