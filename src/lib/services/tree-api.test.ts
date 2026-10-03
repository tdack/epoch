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
		const { fetchTreeList, ApiError } = await loadApi(true);
		vi.stubGlobal('fetch', unauthorized());

		await expect(fetchTreeList()).rejects.toBeInstanceOf(ApiError);
		expect(assign).toHaveBeenCalledWith('/login?next=%2Ftrees%2Ft1%3Ffocus%3Dp2');
	});

	it('only throws on the server', async () => {
		const { fetchTreeList, ApiError } = await loadApi(false);
		vi.stubGlobal('fetch', unauthorized());

		await expect(fetchTreeList()).rejects.toBeInstanceOf(ApiError);
		expect(assign).not.toHaveBeenCalled();
	});

	it('leaves other failures alone', async () => {
		const { fetchTreeList } = await loadApi(true);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Forbidden' }, { status: 403 }))
		);

		await expect(fetchTreeList()).rejects.toThrow('Forbidden');
		expect(assign).not.toHaveBeenCalled();
	});
});

describe('uploadMediaApi', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('posts the file with its tree and person, and titles it by its name', async () => {
		const { uploadMediaApi } = await loadApi(false);
		const fetchMock = vi.fn(async () => Response.json({ success: true }, { status: 201 }));
		vi.stubGlobal('fetch', fetchMock);

		await uploadMediaApi('t1', 'p1', new File(['x'], 'portrait.png', { type: 'image/png' }));

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/media/upload');
		expect(init.method).toBe('POST');
		const body = init.body as FormData;
		expect([body.get('treeId'), body.get('entityId'), body.get('title')]).toEqual([
			't1',
			'p1',
			'portrait.png'
		]);
		expect((body.get('file') as File).name).toBe('portrait.png');
	});

	it('throws the server’s reason when it refuses', async () => {
		const { uploadMediaApi } = await loadApi(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Forbidden' }, { status: 403 }))
		);
		await expect(uploadMediaApi('t1', 'p1', new File(['x'], 'a.png'))).rejects.toThrow('Forbidden');
	});
});
