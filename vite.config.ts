import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true },
			// Production only (Vite's dev client needs inline scripts and a websocket). Kit adds a
			// nonce for its own inline bootstrap script. Everything is same-origin; MapLibre runs
			// its worker from our bundle and may use blob: URLs; `style="…"` attributes from
			// Svelte's style: directives need inline styles.
			csp:
				command === 'build'
					? {
							mode: 'auto',
							directives: {
								'default-src': ['self'],
								'script-src': ['self'],
								'style-src': ['self', 'unsafe-inline'],
								'img-src': ['self', 'data:', 'blob:'],
								'font-src': ['self', 'data:'],
								'connect-src': ['self'],
								'worker-src': ['self', 'blob:'],
								'child-src': ['self', 'blob:'],
								'object-src': ['none'],
								'base-uri': ['self'],
								'form-action': ['self'],
								'frame-ancestors': ['none']
							}
						}
					: undefined
		})
	],
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node'
	}
}));
