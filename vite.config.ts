import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		// Browser specs run under Playwright (`npm run test:e2e`), outside the commit gate.
		// Component tests need Svelte's client build and a DOM, which would change how every
		// server-side module resolves, so they run as their own project.
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					exclude: [...defaultExclude, 'e2e/**', 'src/**/*.component.test.{ts,svelte.ts}']
				}
			},
			{
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'components',
					environment: 'jsdom',
					include: ['src/**/*.component.test.{ts,svelte.ts}']
				}
			}
		]
	}
});
