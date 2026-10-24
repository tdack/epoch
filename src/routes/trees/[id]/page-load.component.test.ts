import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchFocusGraph: vi.fn(), fetchWholeTreeGraph: vi.fn() }));
vi.mock('#lib/api/trees.js', () => api);

import { ApiError } from '#lib/api/client.js';
import { rememberedFocusKey } from '#lib/api/load-helpers.js';
import { load } from './+page';

const TREE = 'tree1';
beforeEach(() => {
	localStorage.clear();
	api.fetchFocusGraph.mockReset().mockResolvedValue({});
});

/** The people the load tried, in order. */
async function tried(
	search: string,
	{ home, lens = null }: { home?: string; lens?: object | null } = {}
) {
	await load({
		params: { id: TREE },
		url: new URL(`https://epoch.test/trees/${TREE}${search}`),
		fetch: vi.fn(),
		depends: vi.fn(),
		parent: async () => ({
			summary: { tree: { id: TREE }, defaultFocusPersonId: 'first', subtree: lens },
			trees: [{ id: TREE, viewMode: null, homePersonId: home ?? null }]
		})
	} as never);
	return api.fetchFocusGraph.mock.calls.map((c) => c[1]);
}

describe('which person a tree opens on', () => {
	it('prefers the address, then the starting person, then the remembered one, then the first', async () => {
		localStorage.setItem(rememberedFocusKey(TREE), 'remembered');
		expect(await tried('?focus=url', { home: 'home' })).toEqual(['url']);
		api.fetchFocusGraph.mockClear();
		expect(await tried('', { home: 'home' })).toEqual(['home']);
		api.fetchFocusGraph.mockClear();
		expect(await tried('')).toEqual(['remembered']);
	});

	it('falls through a starting person who is gone', async () => {
		localStorage.setItem(rememberedFocusKey(TREE), 'remembered');
		api.fetchFocusGraph.mockRejectedValueOnce(new ApiError('gone', 404, undefined, undefined));
		expect(await tried('', { home: 'home' })).toEqual(['home', 'remembered']);
	});

	it('leaves a sub-tree to its own order', async () => {
		const lens = { id: 'lens', rootPersonId: 'root' };
		expect(await tried('', { home: 'home', lens })).toEqual(['root']);
	});
});
