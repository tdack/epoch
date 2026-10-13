import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConcurrencyConflictError, NotFoundError } from '../domain/errors';
import { TreeService } from '../services/tree-service';
import { apiHandler, expectedVersion, treeHandler } from './handler';

// The fake database cannot answer the slug lookup; every segment is taken to be the id itself.
beforeEach(() => {
	vi.spyOn(TreeService.prototype, 'resolveSegment').mockImplementation(async (segment) => segment);
});
afterEach(() => vi.restoreAllMocks());

const USER = { id: 'u1', email: 'a@example.com' };

interface EventOptions {
	user?: typeof USER | null;
	hasDb?: boolean;
	params?: Record<string, string>;
	url?: string;
	body?: unknown;
}

function eventOf({
	user = USER,
	hasDb = true,
	params = { id: 't1' },
	url = 'https://epoch.test/api/trees/t1',
	body
}: EventOptions = {}): RequestEvent {
	return {
		locals: { user, correlationId: 'c1' },
		platform: hasDb ? { env: { DB: {} } } : { env: {} },
		params,
		url: new URL(url),
		request: new Request(url, {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body ?? {})
		})
	} as unknown as RequestEvent;
}

async function read(response: Response) {
	return { status: response.status, body: await response.json() };
}

describe('treeHandler: what it refuses before the handler runs', () => {
	it('answers 401 with the shape the client restarts sign-in on', async () => {
		const run = vi.fn();
		const response = await treeHandler({ failure: 'x' }, run)(eventOf({ user: null }));
		expect(await read(response)).toEqual({
			status: 401,
			body: { error: 'Authentication required' }
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('answers 400 for a missing tree id', async () => {
		const run = vi.fn();
		const response = await treeHandler({ failure: 'x' }, run)(eventOf({ params: {} }));
		expect(await read(response)).toEqual({ status: 400, body: { error: 'id required' } });
		expect(run).not.toHaveBeenCalled();
	});

	it('answers 400 for a missing named parameter', async () => {
		const run = vi.fn();
		const handler = treeHandler({ failure: 'x', params: ['factId'] }, run);
		expect((await read(await handler(eventOf()))).body).toEqual({ error: 'factId required' });
		expect(run).not.toHaveBeenCalled();
	});

	it('answers 500 when the database binding is missing', async () => {
		const run = vi.fn();
		const response = await treeHandler({ failure: 'x' }, run)(eventOf({ hasDb: false }));
		expect(await read(response)).toEqual({
			status: 500,
			body: { error: 'Database binding unavailable' }
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('checks sign-in before anything else', async () => {
		const response = await treeHandler(
			{ failure: 'x' },
			vi.fn()
		)(eventOf({ user: null, params: {}, hasDb: false }));
		expect(response.status).toBe(401);
	});
});

describe('treeHandler: what it hands the handler', () => {
	it('passes the tree, the caller and the params, and returns the result as JSON', async () => {
		const run = vi.fn(async () => ({ ok: true }));
		const response = await treeHandler(
			{ failure: 'x', params: ['factId'] },
			run
		)(eventOf({ params: { id: 't1', factId: 'f1' } }));
		expect(await read(response)).toEqual({ status: 200, body: { ok: true } });
		const args = (run.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(args).toMatchObject({
			treeId: 't1',
			ctx: { user: USER, correlationId: 'c1' },
			params: { id: 't1', factId: 'f1' },
			body: undefined,
			query: undefined
		});
		expect(args.db).toBeDefined();
	});

	it('hands the handler the id a slug stands for (ADR-045)', async () => {
		vi.spyOn(TreeService.prototype, 'resolveSegment').mockResolvedValue('t1');
		const run = vi.fn(async () => ({}));
		await treeHandler({ failure: 'x' }, run)(eventOf({ params: { id: 'the-dacks' } }));
		const args = (run.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(args.treeId).toBe('t1');
	});

	it('parses and validates the body', async () => {
		const run = vi.fn(async ({ body }: { body: { name: string } }) => body);
		const handler = treeHandler({ failure: 'x', body: z.object({ name: z.string() }) }, run);
		expect((await read(await handler(eventOf({ body: { name: 'Ann' } })))).body).toEqual({
			name: 'Ann'
		});
	});

	it('answers 400 for a body the schema refuses, and for one that is not JSON', async () => {
		const run = vi.fn();
		const handler = treeHandler({ failure: 'x', body: z.object({ name: z.string() }) }, run);
		expect(await read(await handler(eventOf({ body: { name: 3 } })))).toMatchObject({
			status: 400,
			body: { code: 'VALIDATION_ERROR', error: expect.stringContaining('name') }
		});
		expect((await handler(eventOf({ body: 'not json' }))).status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});

	it('parses and validates the query', async () => {
		const run = vi.fn(async ({ query }: { query: { generations: number } }) => query);
		const handler = treeHandler(
			{ failure: 'x', query: z.object({ generations: z.coerce.number().int() }) },
			run
		);
		const url = 'https://epoch.test/api/trees/t1?generations=4';
		expect((await read(await handler(eventOf({ url })))).body).toEqual({ generations: 4 });
		const bad = 'https://epoch.test/api/trees/t1?generations=x';
		expect((await handler(eventOf({ url: bad }))).status).toBe(400);
	});

	it('answers with the status the endpoint asks for', async () => {
		const handler = treeHandler({ failure: 'x', status: 201 }, async () => ({ id: 'n1' }));
		expect(await read(await handler(eventOf()))).toEqual({ status: 201, body: { id: 'n1' } });
	});

	it('lets a handler answer with its own Response', async () => {
		const handler = treeHandler({ failure: 'x' }, async () => new Response('raw', { status: 202 }));
		const response = await handler(eventOf());
		expect(response.status).toBe(202);
		expect(await response.text()).toBe('raw');
	});
});

describe('treeHandler: errors go through errorResponse', () => {
	it('keeps a domain error’s status, code and details', async () => {
		const handler = treeHandler({ failure: 'x' }, async () => {
			throw new NotFoundError('Fact', 'f1');
		});
		expect(await read(await handler(eventOf()))).toMatchObject({
			status: 404,
			body: { code: 'NOT_FOUND' }
		});
	});

	it('answers a stale version with 409 and the stored values the client compares against', async () => {
		const details = { reason: 'STALE_VERSION', current: { version: 4 } };
		const handler = treeHandler({ failure: 'x' }, async () => {
			throw new ConcurrencyConflictError('Changed since you read it', details);
		});
		expect(await read(await handler(eventOf()))).toEqual({
			status: 409,
			body: { error: 'Changed since you read it', code: 'CONCURRENCY_CONFLICT', details }
		});
	});

	it('logs an unexpected failure once, and answers 500 naming the operation', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const handler = treeHandler({ failure: 'Failed to save the fact' }, async () => {
			throw new Error('');
		});
		expect(await read(await handler(eventOf()))).toEqual({
			status: 500,
			body: { error: 'Failed to save the fact' }
		});
		expect(log).toHaveBeenCalledTimes(1);
	});

	it('never echoes an unexpected error’s message, and prefixes the fallback when asked to', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const handler = treeHandler(
			{ failure: 'Could not read file', messagePrefix: 'Export failed: ' },
			async () => {
				throw new Error('no such column: trees.secret');
			}
		);
		const result = await read(await handler(eventOf()));
		expect(result).toEqual({
			status: 500,
			body: { error: 'Export failed: Could not read file' }
		});
		expect(JSON.stringify(result.body)).not.toContain('no such column');
	});
});

describe('apiHandler', () => {
	it('needs no tree id, and keeps the 401', async () => {
		const handler = apiHandler({ failure: 'x' }, async ({ ctx }) => ({ id: ctx.user.id }));
		expect(await read(await handler(eventOf({ params: {} })))).toEqual({
			status: 200,
			body: { id: 'u1' }
		});
		expect((await handler(eventOf({ user: null }))).status).toBe(401);
	});
});

describe('expectedVersion', () => {
	it.each([
		['https://epoch.test/x?version=3', 3],
		['https://epoch.test/x?version=0', 0],
		['https://epoch.test/x', undefined]
	])('%s', (url, expected) => {
		expect(expectedVersion(new URL(url))).toBe(expected);
	});

	it('passes a non-number through for the service to refuse', () => {
		expect(expectedVersion(new URL('https://epoch.test/x?version=abc'))).toBeNaN();
	});
});
