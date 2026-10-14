import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'epoch-website',
		compatibilityDate: '2026-01-01',
		compatibilityFlags: ['nodejs_compat'],
		entrypoint: '.svelte-kit/cloudflare/_worker.js',
		workersDev: false,
		observability: {
			enabled: true
		},
		domains: [
			'www.epochgenealogy.app', 
			'epochgenealogy.app'
		],
		env: {
			ASSETS: bindings.assets()
		}
	}
});
