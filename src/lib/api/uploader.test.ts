import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadSessionDto } from '#lib/shared/uploads.js';
import {
	MAX_CONCURRENT_PARTS,
	MAX_PART_RETRIES,
	backoffMs,
	isAbortError,
	startUpload,
	type PartRequest,
	type PartResponse,
	type UploaderEnvironment
} from './uploader.js';

vi.mock('$app/env', () => ({ browser: false }));

const PART = 10;

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k)
	};
}

function makeSession(totalBytes: number, id = 's1'): UploadSessionDto {
	const partCount = Math.ceil(totalBytes / PART);
	return {
		sessionId: id,
		partSizeBytes: PART,
		partCount,
		parts: Array.from({ length: partCount }, (_, i) => ({
			partNumber: i + 1,
			url: `/api/uploads/${id}/parts/${i + 1}`,
			method: 'PUT' as const
		})),
		expiresAt: 2_000_000
	};
}

const reply = (status: number, body: unknown) =>
	new Response(status === 204 ? null : JSON.stringify(body), { status });

interface Rig {
	env: UploaderEnvironment;
	calls: Array<{ method: string; url: string }>;
	sent: Array<{ url: string; bytes: number }>;
	storage: ReturnType<typeof memoryStorage>;
	sleeps: number[];
	/** Replaces how a part is answered; receives the request and the 1-based try for that url. */
	answer: (request: PartRequest, attempt: number) => Promise<PartResponse> | PartResponse;
	/** What GET /api/uploads/:id answers; null makes it a 404. */
	state: { receivedParts: number[] } | null;
	/** Answers for POST complete, consumed in order; the last repeats. */
	completes: Array<Response>;
	peak: number;
}

function rig(totalBytes: number): Rig {
	const r: Rig = {
		calls: [],
		sent: [],
		sleeps: [],
		storage: memoryStorage(),
		state: null,
		completes: [],
		peak: 0,
		answer: () => ({ status: 200, bodyText: '{}' }),
		env: {}
	};
	const attempts = new Map<string, number>();
	let inFlight = 0;
	r.env = {
		storage: r.storage,
		random: () => 0.5,
		now: () => 1_000_000,
		sleep: async (ms) => void r.sleeps.push(ms),
		fetch: (async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			r.calls.push({ method, url: String(input) });
			if (method === 'POST' && input === '/api/uploads') return reply(201, makeSession(totalBytes));
			if (method === 'GET')
				return r.state
					? reply(200, { ...makeSession(totalBytes), receivedParts: r.state.receivedParts })
					: reply(404, { error: 'gone' });
			if (method === 'DELETE') return reply(204, null);
			const next = r.completes.length > 1 ? r.completes.shift()! : r.completes[0]!;
			return next.clone();
		}) as typeof fetch,
		sendPart: async (request) => {
			const n = (attempts.get(request.url) ?? 0) + 1;
			attempts.set(request.url, n);
			inFlight++;
			r.peak = Math.max(r.peak, inFlight);
			try {
				// Yield so that parts overlap if the uploader lets them.
				await new Promise((resolve) => setTimeout(resolve, 0));
				request.onProgress(request.body.size);
				const response = await r.answer(request, n);
				if (response.status === 200) r.sent.push({ url: request.url, bytes: request.body.size });
				return response;
			} finally {
				inFlight--;
			}
		}
	};
	r.completes = [reply(200, { sessionId: 's1', r2Key: 'staging/x', totalBytes })];
	return r;
}

function fileOf(bytes: number, name = 'a.jpg', lastModified = 5) {
	return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg', lastModified });
}

const start = (r: Rig, file: File, extra: { signal?: AbortSignal; onProgress?: never } = {}) =>
	startUpload({ file, treeId: 't1', purpose: 'media', env: r.env, ...extra });

let r: Rig;
beforeEach(() => {
	r = rig(45);
});

describe('startUpload', () => {
	it('opens a session, sends every part exactly as the server gave it, and completes', async () => {
		const done = await start(r, fileOf(45));
		expect(done.r2Key).toBe('staging/x');
		expect(r.sent.map((s) => s.url).sort()).toEqual(
			[1, 2, 3, 4, 5].map((n) => `/api/uploads/s1/parts/${n}`)
		);
		expect(r.sent.map((s) => s.bytes).sort((a, b) => a - b)).toEqual([5, 10, 10, 10, 10]);
		expect(r.calls.map((c) => c.method)).toEqual(['POST', 'POST']);
		expect(r.storage.map.size).toBe(0);
	});

	it('sends at most three parts at once', async () => {
		await start(r, fileOf(45));
		expect(r.peak).toBe(MAX_CONCURRENT_PARTS);
	});

	it('reports progress in bytes up to the whole file', async () => {
		const seen: number[] = [];
		await startUpload({
			file: fileOf(45),
			treeId: 't1',
			purpose: 'media',
			env: r.env,
			onProgress: (p) => {
				expect(p.totalBytes).toBe(45);
				seen.push(p.uploadedBytes);
			}
		});
		expect(Math.max(...seen)).toBe(45);
		expect(seen.every((n) => n <= 45)).toBe(true);
	});

	it('refuses an empty file without calling the server', async () => {
		await expect(start(r, fileOf(0))).rejects.toThrow('empty');
		expect(r.calls).toEqual([]);
	});
});

describe('retries', () => {
	it('retries a 503 and a dropped connection with growing, jittered pauses', async () => {
		r.answer = (request, attempt) => {
			if (request.url.endsWith('/1')) {
				if (attempt === 1) return { status: 503, bodyText: '' };
				if (attempt === 2) throw new Error('network');
				if (attempt === 3) return { status: 429, bodyText: '' };
			}
			return { status: 200, bodyText: '{}' };
		};
		await start(r, fileOf(45));
		expect(r.sleeps).toEqual([backoffMs(1, 0.5), backoffMs(2, 0.5), backoffMs(3, 0.5)]);
		expect(r.sleeps[1]).toBeGreaterThan(r.sleeps[0]!);
		expect(r.sent).toHaveLength(5);
	});

	it('keeps the backoff between half and the whole of the exponential step, and capped', () => {
		expect(backoffMs(1, 0)).toBe(250);
		expect(backoffMs(1, 0.999)).toBeLessThanOrEqual(500);
		expect(backoffMs(20, 0.999)).toBeLessThanOrEqual(15_000);
	});

	it('gives up after four retries and keeps the session to resume', async () => {
		let tries = 0;
		r.answer = (request) => {
			if (request.url.endsWith('/1')) tries++;
			return request.url.endsWith('/1')
				? { status: 502, bodyText: '' }
				: { status: 200, bodyText: '{}' };
		};
		await expect(start(r, fileOf(45))).rejects.toMatchObject({ status: 502 });
		expect(tries).toBe(MAX_PART_RETRIES + 1);
		expect(r.storage.map.size).toBe(1);
	});

	it('does not retry a 4xx other than 408 and 429', async () => {
		let tries = 0;
		r.answer = (request) => {
			if (request.url.endsWith('/2')) tries++;
			return request.url.endsWith('/2')
				? { status: 400, bodyText: JSON.stringify({ error: 'This part must be exactly 10 bytes' }) }
				: { status: 200, bodyText: '{}' };
		};
		await expect(start(r, fileOf(45))).rejects.toThrow('exactly 10 bytes');
		expect(tries).toBe(1);
		expect(r.sleeps).toEqual([]);
	});

	it('retries a 408', async () => {
		r.answer = (request, attempt) =>
			request.url.endsWith('/3') && attempt === 1
				? { status: 408, bodyText: '' }
				: { status: 200, bodyText: '{}' };
		await start(r, fileOf(45));
		expect(r.sleeps).toHaveLength(1);
	});
});

describe('cancel', () => {
	it('aborts the parts in flight, deletes the session and forgets it', async () => {
		const controller = new AbortController();
		r.env.sendPart = (request) =>
			new Promise<PartResponse>((_resolve, reject) => {
				request.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
				setTimeout(() => controller.abort(), 0);
			});
		await expect(start(r, fileOf(45), { signal: controller.signal })).rejects.toSatisfy(
			isAbortError
		);
		expect(r.calls.at(-1)).toEqual({ method: 'DELETE', url: '/api/uploads/s1' });
		expect(r.storage.map.size).toBe(0);
	});

	it('does nothing when already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(start(r, fileOf(45), { signal: controller.signal })).rejects.toSatisfy(
			isAbortError
		);
		expect(r.calls).toEqual([]);
	});

	it('does not retry once cancelled', async () => {
		const controller = new AbortController();
		r.answer = () => {
			controller.abort();
			return { status: 503, bodyText: '' };
		};
		await expect(start(r, fileOf(45), { signal: controller.signal })).rejects.toSatisfy(
			isAbortError
		);
		expect(r.calls.at(-1)?.method).toBe('DELETE');
	});
});

describe('missing parts at complete', () => {
	const missing = reply(400, {
		error: 'Some parts have not been uploaded',
		details: { missingParts: [2, 4] }
	});

	it('re-sends only those parts once, then completes again', async () => {
		r.completes = [missing, reply(200, { sessionId: 's1', r2Key: 'k', totalBytes: 45 })];
		const done = await start(r, fileOf(45));
		expect(done.r2Key).toBe('k');
		const urls = r.sent.map((s) => s.url);
		expect(urls.filter((u) => u.endsWith('/2'))).toHaveLength(2);
		expect(urls.filter((u) => u.endsWith('/4'))).toHaveLength(2);
		expect(urls.filter((u) => u.endsWith('/1'))).toHaveLength(1);
		expect(r.calls.filter((c) => c.url.endsWith('/complete'))).toHaveLength(2);
	});

	it('fails when the second complete still reports missing parts', async () => {
		r.completes = [missing];
		await expect(start(r, fileOf(45))).rejects.toMatchObject({ status: 400 });
		expect(r.calls.filter((c) => c.url.endsWith('/complete'))).toHaveLength(2);
	});
});

describe('resume', () => {
	const remembered = (over: Record<string, unknown> = {}) =>
		JSON.stringify({
			['t1\u0000media\u0000a.jpg\u000045\u00005']: {
				sessionId: 's1',
				fileName: 'a.jpg',
				size: 45,
				lastModified: 5,
				treeId: 't1',
				purpose: 'media',
				expiresAt: 2_000_000,
				...over
			}
		});

	it('resumes the same file and sends only the parts the server lacks', async () => {
		r.storage.map.set('epoch.uploads.resumable', remembered());
		r.state = { receivedParts: [1, 2, 3] };
		const seen: number[] = [];
		await startUpload({
			file: fileOf(45),
			treeId: 't1',
			purpose: 'media',
			env: r.env,
			onProgress: (p) => seen.push(p.uploadedBytes)
		});
		expect(r.calls[0]).toEqual({ method: 'GET', url: '/api/uploads/s1' });
		expect(r.calls.some((c) => c.method === 'POST' && c.url === '/api/uploads')).toBe(false);
		expect(r.sent.map((s) => s.url).sort()).toEqual([
			'/api/uploads/s1/parts/4',
			'/api/uploads/s1/parts/5'
		]);
		expect(seen[0]).toBe(30);
	});

	it.each([
		['a different name', fileOf(45, 'b.jpg')],
		['a different size', fileOf(44)],
		['a different modified time', fileOf(45, 'a.jpg', 6)]
	])('starts afresh for %s', async (_label, file) => {
		r.storage.map.set('epoch.uploads.resumable', remembered());
		r.state = { receivedParts: [1] };
		await start(r, file);
		expect(r.calls[0]).toEqual({ method: 'POST', url: '/api/uploads' });
	});

	it('starts afresh when the remembered session has expired', async () => {
		r.storage.map.set('epoch.uploads.resumable', remembered({ expiresAt: 999_999 }));
		await start(r, fileOf(45));
		expect(r.calls[0]).toEqual({ method: 'POST', url: '/api/uploads' });
	});

	it('starts afresh when the server no longer has the session', async () => {
		r.storage.map.set('epoch.uploads.resumable', remembered());
		r.state = null;
		await start(r, fileOf(45));
		expect(r.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST']);
		expect(r.sent).toHaveLength(5);
	});

	it('works without any storage', async () => {
		r.env.storage = null;
		await expect(start(r, fileOf(45))).resolves.toBeDefined();
	});

	it('works when storage throws', async () => {
		const boom = () => {
			throw new Error('blocked');
		};
		r.env.storage = { getItem: boom, setItem: boom, removeItem: boom };
		await expect(start(r, fileOf(45))).resolves.toBeDefined();
	});

	it('remembers the session while it is open', async () => {
		r.answer = (request) =>
			request.url.endsWith('/5')
				? { status: 400, bodyText: '{}' }
				: { status: 200, bodyText: '{}' };
		await expect(start(r, fileOf(45))).rejects.toBeDefined();
		const stored = JSON.parse(r.storage.map.get('epoch.uploads.resumable')!) as Record<
			string,
			unknown
		>;
		expect(Object.values(stored)).toEqual([
			{
				sessionId: 's1',
				fileName: 'a.jpg',
				size: 45,
				lastModified: 5,
				treeId: 't1',
				purpose: 'media',
				expiresAt: 2_000_000
			}
		]);
	});
});
