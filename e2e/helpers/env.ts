import { existsSync } from 'node:fs';

/**
 * Where the e2e suite talks to. `pnpm test:e2e` builds the app and starts the production
 * server (adapter-node) on :4173 (see playwright.config.ts); set E2E_BASE_URL to run against
 * an already running server instead (e.g. `pnpm dev`, http://localhost:5173).
 */
export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');

export function adminPassword(): string {
	const pw = process.env.ADMIN_PASSWORD;
	if (!pw) throw new Error('ADMIN_PASSWORD is not set (copy .env.example to .env)');
	return pw;
}

/** The system Chromium if there is one (otherwise Playwright's own download). */
export const CHROMIUM = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;

/** Chromium flags for headless WebGL (MapLibre) via SwiftShader. */
export const WEBGL_LAUNCH = {
	executablePath: CHROMIUM,
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
};
