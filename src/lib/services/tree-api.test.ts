import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const assign = vi.fn();

async function loadApi(isBrowser: boolean) {
	vi.resetModules();
	vi.doMock('$app/env', () => ({ browser: isBrowser }));
	return import('./tree-api');
}

const unauthorized = () =>
	vi.fn(async () => Response.json({ error: 'Unauthenticated' }, { status: 401 }));

describe('a 401 from the API', () => {
	beforeEach(() => {
		assign.mockClear();
		vi.stubGlobal('window', {
			location: { pathname: '/trees/t1', search: '?focus=p2', assign }
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('starts a full navigation to /login in the browser, and still throws', async () => {
		const { fetchTreeDetails, ApiError } = await loadApi(true);
		vi.stubGlobal('fetch', unauthorized());

		await expect(fetchTreeDetails('t1')).rejects.toBeInstanceOf(ApiError);
		expect(assign).toHaveBeenCalledWith('/login?next=%2Ftrees%2Ft1%3Ffocus%3Dp2');
	});

	it('only throws on the server', async () => {
		const { fetchTreeDetails, ApiError } = await loadApi(false);
		vi.stubGlobal('fetch', unauthorized());

		await expect(fetchTreeDetails('t1')).rejects.toBeInstanceOf(ApiError);
		expect(assign).not.toHaveBeenCalled();
	});

	it('leaves other failures alone', async () => {
		const { fetchTreeDetails } = await loadApi(true);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Forbidden' }, { status: 403 }))
		);

		await expect(fetchTreeDetails('t1')).rejects.toThrow('Forbidden');
		expect(assign).not.toHaveBeenCalled();
	});
});
