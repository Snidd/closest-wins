import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Tests need ADMIN_PASSWORD etc.; the preview server reads .env itself.
if (existsSync('.env')) process.loadEnvFile('.env');

// Set E2E_BASE_URL (e.g. http://localhost:5181) to test against an already running
// dev server instead of building and previewing; lets several agents run e2e in parallel.
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
	webServer: externalBaseUrl ? undefined : {
		command: 'pnpm build && pnpm preview --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	},
	testMatch: '**/*.e2e.{ts,js}',
	use: {
		baseURL: externalBaseUrl ?? 'http://localhost:4173'
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: { executablePath: '/usr/bin/chromium' }
			}
		}
	]
});
