import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

/**
 * Secrets are optional while building (so `vite build` / Docker builds do not need them) but
 * required when the app starts.
 */
function required(name: string, minLength = 1) {
	return (value: string | undefined): string => {
		if (building) return value ?? '';
		if (!value || value.length < minLength) {
			throw new Error(
				minLength > 1
					? `${name} must be set and at least ${minLength} characters long`
					: `${name} must be set`
			);
		}
		return value;
	};
}

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres connection string, e.g. postgres://root:pw@localhost:5433/local.',
		schema: required('DATABASE_URL')
	},
	ADMIN_PASSWORD: {
		description: 'The single shared admin password (unlocks /admin and /host).',
		schema: required('ADMIN_PASSWORD')
	},
	SESSION_SECRET: {
		description: 'HMAC-SHA256 key for signing the admin session cookie. At least 32 characters.',
		schema: required('SESSION_SECRET', 32)
	},
	MCP_TOKEN: {
		description: 'Bearer token required by the /mcp endpoint.',
		schema: required('MCP_TOKEN', 16)
	},
	DATA_DIR: {
		description: 'Directory for runtime data (media/ and map/). Defaults to ./data.',
		schema: (value) => (value && value.length > 0 ? value : './data')
	},
	DEV_PAGES: {
		description:
			'Set to 1 to serve the /dev/* playground pages in a production build (the e2e suite does). Always on under `vite dev`.',
		schema: (value) => value === '1' || value === 'true'
	},
	ORIGIN: {
		description: 'Public origin of the app (e.g. https://game.example.com), used for QR/join URLs.',
		schema: (value) => (value ? value.replace(/\/+$/, '') : 'http://localhost:5173')
	}
});
