/**
 * Guards for the cross-origin posture (audit F18). Both are deliberately blunt: they fail on the
 * exact patterns that would weaken the posture, so a change to either is a visible, reviewed edit
 * of this file rather than a side effect of another one.
 *
 * SvelteKit 3 has removed `csrf.checkOrigin` (setting it is a config error) and keeps only
 * `csrf.trustedOrigins`, which admits extra origins past the same-origin form check.
 * `paths.origin` changes which origin counts as "self". The app keeps the default same-origin
 * check, so the config must name neither.
 *
 * Files are read through `import.meta.glob`, not `node:fs`: the app's typecheck has no Node types,
 * and adding them for one test would widen every server module's ambient globals.
 */

import { describe, expect, it } from 'vitest';

const configFiles = import.meta.glob('/vite.config.ts', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const sourceFiles = import.meta.glob('/{src,workers}/**/*.{ts,js,svelte,mjs,cjs,tsx,jsx}', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('same-origin form check (F18)', () => {
	it('keeps SvelteKit csrf and origin settings at their defaults in vite.config.ts', () => {
		const config = configFiles['/vite.config.ts'];
		expect(config, 'vite.config.ts was not read').toBeTruthy();
		const forbidden = [/csrf/i, /trustedOrigins/, /checkOrigin/, /\borigin\s*:/];
		const found = forbidden.filter((pattern) => pattern.test(config)).map(String);
		expect(found, 'vite.config.ts changed the same-origin form check').toEqual([]);
	});
});

describe('no CORS headers (F18)', () => {
	it('has no Access-Control-Allow-* string in non-test source or workers code', () => {
		const paths = Object.keys(sourceFiles).filter((path) => !path.endsWith('.test.ts'));
		expect(paths.length, 'the scan found no source files').toBeGreaterThan(0);
		expect(
			paths.some((path) => path.startsWith('/workers/')),
			'the scan did not reach workers/'
		).toBe(true);

		const offenders = paths.filter((path) =>
			sourceFiles[path].toLowerCase().includes('access-control-allow-')
		);
		expect(offenders, 'CORS headers found; the app is same-origin only').toEqual([]);
	});
});
