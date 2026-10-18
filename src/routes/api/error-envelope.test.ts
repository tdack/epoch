import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(
	[
		'./**/+server.ts',
		'../../lib/server/http/handler.ts',
		'../../lib/server/http/error-response.ts'
	],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

// Every failure is built by `errorResponse` from a `DomainError`, which always has a `code`. A
// route that writes its own `{ error }` body would skip that, so the shape is held by banning it.
describe('the /api error envelope', () => {
	it('finds the route files', () => {
		expect(Object.keys(sources).length).toBeGreaterThan(20);
	});

	it.each(Object.entries(sources))('%s has no error body without a code', (_file, source) => {
		const bareErrors = [...source.matchAll(/json\(\s*\{\s*error\b[^}]*\}/g)].filter(
			(match) => !/\bcode\b/.test(match[0])
		);
		expect(bareErrors.map((match) => match[0])).toEqual([]);
	});
});
