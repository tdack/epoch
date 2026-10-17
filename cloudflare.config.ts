import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'epoch-website',
		compatibilityDate: '2026-01-01',
		compatibilityFlags: ['nodejs_compat'],
		entrypoint: '.svelte-kit/cloudflare/_worker.js',
		// Production answers only on the custom domain, but every uploaded version gets its own
		// <alias>-epoch-website.<subdomain>.workers.dev address, so a branch can be checked first.
		workersDev: false,
		previewUrls: true,
		observability: {
			enabled: true
		},
		domains: ['www.epochgenealogy.app'],
		env: {
			ASSETS: bindings.assets()
		}
	}
});
