import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { defaultExclude, defineConfig } from 'vitest/config';

/**
 * The commit this build is made from, shortened, for the AGPL source link. Workers Builds names it
 * in `WORKERS_CI_COMMIT_SHA`, and its checkout is not guaranteed to keep `.git`; a local build or
 * `npm run deploy` asks git, and marks a tree with uncommitted changes, since that build is not the
 * commit's source. Null when neither is available, such as a build from an exported archive.
 */
function buildCommit(): string | null {
	const fromCi = process.env.WORKERS_CI_COMMIT_SHA?.trim();
	if (fromCi) return fromCi.slice(0, 7);
	const git = (...args: string[]) =>
		execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	try {
		const sha = git('rev-parse', '--short=7', 'HEAD');
		const isDirty = git('status', '--porcelain', '--untracked-files=no') !== '';
		return isDirty ? `${sha}-dirty` : sha;
	} catch {
		return null;
	}
}

export default defineConfig({
	define: { __EPOCH_COMMIT__: JSON.stringify(buildCommit()) },
	// The WebGL scenes and the poster PDF are imported lazily, so the dev server only finds three.js when a 3D view first
	// opens; it then re-bundles and reloads the page mid-session, failing that load and losing the
	// next click (a cold-cache e2e run landed on Ribbons instead of Flat). Bundling them up front
	// avoids the reload. Dev only: the production build splits these chunks as before.
	optimizeDeps: {
		include: [
			'three',
			'three/addons/controls/OrbitControls.js',
			'three/addons/lines/Line2.js',
			'three/addons/lines/LineGeometry.js',
			'three/addons/lines/LineMaterial.js',
			'three/addons/lines/LineSegments2.js',
			'three/addons/lines/LineSegmentsGeometry.js',
			'three/addons/utils/BufferGeometryUtils.js',
			'jspdf',
			'svg2pdf.js'
		]
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Vitest starts a Vite server per project, and the adapter boots a platform proxy for each
			// one. Left at the default, every run's proxies share this checkout's `.wrangler/state` (as
			// does `npm run dev`), and with two runs at once a workerd failed to start with
			// SQLITE_BUSY_RECOVERY, ending its whole run. No test reads that state, so under Vitest it
			// stays in memory.
			adapter: adapter(process.env.VITEST ? { platformProxy: { persist: false } } : undefined),
			// Report-only until the policy has been watched against the real UI (ADR-048). Kit requires
			// a report target for report-only, so violations POST to the same-origin report endpoint.
			// Kit quotes the keywords itself and compares them bare ('unsafe-inline', not
			// "'unsafe-inline'"); a quoted one renders fine but defeats its nonce decision for style-src.
			csp: {
				mode: 'auto',
				reportOnly: {
					'default-src': ['self'],
					'script-src': ['self'],
					// Svelte transitions and component styles set inline styles.
					'style-src': ['self', 'unsafe-inline'],
					// The default map tile host (ADR-078). The policy is fixed at build time, so a tile URL
					// changed in site settings must be added here too.
					'img-src': ['self', 'data:', 'blob:', 'https://tile.openstreetmap.org'],
					'font-src': ['self', 'data:'],
					'connect-src': ['self'],
					'worker-src': ['self', 'blob:'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none'],
					'report-uri': ['/api/csp-report']
				}
			}
		})
	],
	test: {
		// Browser specs run under Playwright (`npm run test:e2e`), outside the commit gate.
		// Component tests need Svelte's client build and a DOM, which would change how every
		// server-side module resolves, so they run as their own project. Agent worktrees live under
		// `.claude/worktrees/`, and the default include would test every one of them as well.
		// Half the cores: each server test file also runs a workerd, so the default oversubscribes the
		// host (load near 60 on 10 cores) for no gain; half took the same wall time at a third the load.
		maxWorkers: '50%',
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					// Each test talks to a real local D1 in its own workerd process, so a full run loads the
					// host heavily; the 5-second default timed out the Windsors import (1.7s alone) and, since
					// a timed-out test keeps running, broke the next test in the file too.
					testTimeout: 30_000,
					hookTimeout: 30_000,
					exclude: [
						...defaultExclude,
						'.claude/**',
						'e2e/**',
						'src/**/*.component.test.{ts,svelte.ts}'
					]
				}
			},
			{
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'components',
					environment: 'jsdom',
					setupFiles: ['src/lib/components/jsdom-layout.setup.ts'],
					include: ['src/**/*.component.test.{ts,svelte.ts}']
				}
			}
		]
	}
});
