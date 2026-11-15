import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Tests need DATABASE_URL, ADMIN_PASSWORD etc.; the server inherits them from here.
if (existsSync('.env')) process.loadEnvFile('.env');

const PORT = 4173;
// Set E2E_BASE_URL (e.g. http://localhost:5173 with `pnpm dev` running) to test against an
// already running server instead of building and starting the production server.
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://localhost:${PORT}`;

export default defineConfig({
	webServer: externalBaseUrl
		? undefined
		: {
				// The real production server (adapter-node), not `vite preview`: preview gzips
				// responses, which buffers the live-query event streams.
				command: 'pnpm build && node build',
				url: `${baseURL}/`,
				reuseExistingServer: !process.env.CI,
				timeout: 240_000,
				env: {
					PORT: String(PORT),
					HOST: '127.0.0.1',
					ORIGIN: baseURL,
					BODY_SIZE_LIMIT: '16M',
					// The map tests use the /dev/map playground.
					DEV_PAGES: '1'
				}
			},
	testMatch: '**/*.e2e.{ts,js}',
	// Phones, TV and host of one game share a single server; a few files at a time keeps the
	// SwiftShader-rendered maps responsive.
	workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
	use: { baseURL },
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}
			}
		}
	]
});
