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

describe('startGedcomExport', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('posts the tree, format, packaging and a client uuid, and reads a sync answer', async () => {
		const { startGedcomExport } = await loadApi(false);
		const fetchMock = vi.fn(async () => Response.json({ status: 'sync' }));
		vi.stubGlobal('fetch', fetchMock);

		expect(await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: false })).toEqual({
			status: 'sync'
		});

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/export');
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body).toMatchObject({ treeId: 't1', format: 'gedcom7', shouldCompress: false });
		expect(body.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('reads a started answer as the instance id', async () => {
		const { startGedcomExport } = await loadApi(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ status: 'started', instanceId: 'i1' }))
		);
		expect(await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: false })).toEqual({
			status: 'started',
			instanceId: 'i1'
		});
	});

	it('treats a 503 as an answer, not a failure, so the caller can refuse to fall back', async () => {
		const { startGedcomExport } = await loadApi(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ status: 'unavailable' }, { status: 503 }))
		);
		expect(await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: false })).toEqual({
			status: 'unavailable'
		});
	});

	it('throws the server’s reason for any other failure', async () => {
		const { startGedcomExport, ApiError } = await loadApi(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: 'Forbidden' }, { status: 403 }))
		);
		await expect(
			startGedcomExport('t1', { format: 'gedcom551', shouldCompress: false })
		).rejects.toBeInstanceOf(ApiError);
	});

	it('reuses one idempotency id for the same choice, and a fresh one for a different choice', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key)
		} as unknown as Storage);
		const { startGedcomExport } = await loadApi(false);
		const fetchMock = vi.fn(async () => Response.json({ status: 'sync' }));
		vi.stubGlobal('fetch', fetchMock);

		const uuidOf = (call: number) =>
			(
				JSON.parse(
					(fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string
				) as { clientUuid: string }
			).clientUuid;

		await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: false });
		await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: false });
		expect(uuidOf(1)).toBe(uuidOf(0));

		await startGedcomExport('t1', { format: 'gedcom7', shouldCompress: true });
		expect(uuidOf(2)).not.toBe(uuidOf(0));
	});

	it('mints a fresh id once a finished export clears it, so a second export is a new instance', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key)
		} as unknown as Storage);
		const { startGedcomExport, clearExportClientUuid } = await loadApi(false);
		const fetchMock = vi.fn(async () => Response.json({ status: 'started', instanceId: 'i1' }));
		vi.stubGlobal('fetch', fetchMock);

		const uuidOf = (call: number) =>
			(
				JSON.parse(
					(fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string
				) as { clientUuid: string }
			).clientUuid;

		const choice = { format: 'gedcom7', shouldCompress: false } as const;
		await startGedcomExport('t1', choice);
		// The completion path clears the id; the next click must not name the finished instance.
		clearExportClientUuid('t1', choice);
		await startGedcomExport('t1', choice);

		expect(uuidOf(1)).not.toBe(uuidOf(0));
	});
});

describe('the async export helpers', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('polls the status endpoint and returns the closed status', async () => {
		const { exportStatusApi } = await loadApi(false);
		const fetchMock = vi.fn(async () =>
			Response.json({ status: 'running', code: 'export_running' })
		);
		vi.stubGlobal('fetch', fetchMock);
		expect(await exportStatusApi('i1')).toEqual({ status: 'running', code: 'export_running' });
		expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
			'/api/export/status/i1'
		);
	});

	it('builds the download url with the id encoded', async () => {
		const { exportDownloadUrl } = await loadApi(false);
		expect(exportDownloadUrl('a b')).toBe('/api/export/download/a%20b');
	});
});
