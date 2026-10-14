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
		// server-side module resolves, so they run as their own project. Agent worktrees live under
		// `.claude/worktrees/`, and the default include would test every one of them as well.
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
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
					include: ['src/**/*.component.test.{ts,svelte.ts}']
				}
			}
		]
	}
});
