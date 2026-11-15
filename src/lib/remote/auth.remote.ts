/**
 * Admin login/logout (one shared password). Implemented in Wave 0.
 *
 * ```svelte
 * <form {...login}>
 *   <input {...login.fields._password.as('password')} />
 *   <input {...login.fields.next.as('hidden', '/host')} />
 *   {#each login.fields._password.issues() ?? [] as issue}<p>{issue.message}</p>{/each}
 *   <button>Log in</button>
 * </form>
 * <form {...logout}><button>Log out</button></form>
 * ```
 */
import * as v from 'valibot';
import { invalid, redirect } from '@sveltejs/kit';
import { form, getRequestEvent, query } from '$app/server';
import {
	checkAdminPassword,
	endAdminSession,
	loginLimiter,
	safeNext,
	startAdminSession
} from '#lib/server/auth/index.ts';
import { translate } from '#lib/i18n/dict.ts';
import { common } from '#lib/i18n/common.ts';

/** `_password` has a leading underscore so it is never echoed back into the form. */
export const login = form(
	v.object({
		_password: v.pipe(v.string(), v.nonEmpty()),
		next: v.optional(v.string(), '')
	}),
	async ({ _password, next }, issue) => {
		const event = getRequestEvent();
		const t = translate(common, event.locals.locale);
		const key = `login:${event.getClientAddress()}`;

		const limit = loginLimiter.check(key);
		if (!limit.allowed) invalid(issue._password(t.tooManyAttempts(limit.retryAfterSeconds)));

		if (!checkAdminPassword(_password)) {
			loginLimiter.fail(key);
			invalid(issue._password(t.wrongPassword));
		}

		loginLimiter.reset(key);
		startAdminSession(event.cookies, event.url);
		redirect(303, safeNext(next));
	}
);

export const logout = form(async () => {
	endAdminSession(getRequestEvent().cookies);
	redirect(303, '/');
});

/** Whether the current caller has an admin session. */
export const adminStatus = query(async () => ({ admin: getRequestEvent().locals.admin }));
