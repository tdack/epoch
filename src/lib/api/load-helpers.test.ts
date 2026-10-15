import { error, isHttpError } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { DATA_KEY, generationsParam, listQuery, treeLoad } from './load-helpers';
import { ApiError } from './tree-api';

const url = (query: string) => new URL(`https://epoch.test/trees/t1?${query}`);

describe('generationsParam', () => {
	const options = { fallback: 4 };
	it.each([
		['generations=6', 6],
		['generations=1', 1],
		['', 4],
		['generations=0', 4],
		['generations=-2', 4],
		['generations=2.5', 4],
		['generations=abc', 4]
	])('%s', (query, expected) => {
		expect(generationsParam(url(query), 'generations', options)).toBe(expected);
	});

	it('clamps to the maximum when there is one, and not otherwise', () => {
		expect(generationsParam(url('generations=40'), 'generations', { fallback: 4, max: 8 })).toBe(8);
		expect(generationsParam(url('generations=40'), 'generations', options)).toBe(40);
	});

	it('reads the key it is asked for', () => {
		expect(generationsParam(url('up=3&down=5'), 'down', options)).toBe(5);
	});
});

describe('listQuery', () => {
	it('carries the normalised offset and limit', () => {
		const query = listQuery(url('offset=50&limit=25'));
		expect(query.get('offset')).toBe('50');
		expect(query.get('limit')).toBe('25');
	});

	it('falls back to the defaults for nonsense', () => {
		const query = listQuery(url('offset=-5&limit=abc'));
		expect(query.get('offset')).toBe('0');
		expect(Number(query.get('limit'))).toBeGreaterThan(0);
	});

	it('puts the extra parameters in beside them', () => {
		const query = listQuery(url('offset=10'), { sort: 'given', q: '' });
		expect(Object.fromEntries(query)).toMatchObject({ sort: 'given', q: '', offset: '10' });
	});
});

describe('treeLoad', () => {
	it('depends on the data key before it runs, and answers what the load returns', async () => {
		const depends = vi.fn();
		const load = treeLoad(async (event: { depends: typeof depends; id: string }) => ({
			id: event.id
		}));
		expect(await load({ depends, id: 't1' })).toEqual({ id: 't1' });
		expect(depends).toHaveBeenCalledWith(DATA_KEY);
	});

	it('turns an API failure into the error page with the same status', async () => {
		const load = treeLoad(async (_event: { depends: () => void }) => {
			throw new ApiError('No such person', 404, undefined, undefined);
		});
		const failure = await load({ depends: () => {} }).catch((cause: unknown) => cause);
		expect(isHttpError(failure, 404)).toBe(true);
		expect(failure).toMatchObject({ body: { message: 'No such person' } });
	});

	it('lets anything else through untouched', async () => {
		const bug = new TypeError('boom');
		await expect(
			treeLoad(async (_event: { depends: () => void }) => {
				throw bug;
			})({ depends: () => {} })
		).rejects.toBe(bug);
		const own = await treeLoad(async (_event: { depends: () => void }) =>
			error(404, 'Place not found')
		)({
			depends: () => {}
		}).catch((cause: unknown) => cause);
		expect(isHttpError(own, 404)).toBe(true);
	});
});
