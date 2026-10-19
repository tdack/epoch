import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubtree, deleteSubtree, updateSubtree } from './subtrees';

const dto = {
	id: 's1',
	slug: 'line',
	name: 'Line',
	rootPersonId: 'p1',
	position: 0,
	version: 1,
	isRootMissing: false
};

describe('the sub-tree helpers', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('make, edit and delete against the tree’s sub-tree endpoints', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ subtrees: [dto], subtree: dto, change: null })
		);
		vi.stubGlobal('fetch', fetchMock);

		await createSubtree('t1', { name: 'Line', slug: 'line', rootPersonId: 'p1' });
		await updateSubtree('t1', 's1', { name: 'New', version: 1 });
		await deleteSubtree('t1', 's1', 2);

		const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
		expect(calls.map(([url, init]) => [init.method, url])).toEqual([
			['POST', '/api/trees/t1/subtrees'],
			['PATCH', '/api/trees/t1/subtrees/s1'],
			['DELETE', '/api/trees/t1/subtrees/s1?version=2']
		]);
		expect(JSON.parse(calls[1]![1].body as string)).toEqual({ name: 'New', version: 1 });
	});

	it('throw the server’s reason', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Forbidden' }, { status: 403 }))
		);
		await expect(deleteSubtree('t1', 's1')).rejects.toThrow('Forbidden');
	});
});
