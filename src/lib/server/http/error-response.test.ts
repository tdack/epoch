import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ConcurrencyConflictError,
	DomainError,
	NotFoundError,
	UnauthenticatedError,
	UnauthorizedError,
	UndoRefusedError,
	UnionMergeConflictError,
	ValidationError
} from '../domain/errors';
import { errorResponse } from './error-response';

afterEach(() => vi.restoreAllMocks());

async function read(response: Response) {
	return { status: response.status, body: await response.json() };
}

describe('errorResponse: domain errors keep their status, code and details', () => {
	it.each([
		['validation', new ValidationError('bad name'), 400, 'VALIDATION_ERROR', undefined],
		['unauthenticated', new UnauthenticatedError(), 401, 'UNAUTHENTICATED', undefined],
		['unauthorized', new UnauthorizedError(), 403, 'UNAUTHORIZED', undefined],
		['not found', new NotFoundError('Tree', 't1'), 404, 'NOT_FOUND', undefined],
		[
			'conflict',
			new ConcurrencyConflictError('stale', { currentVersion: 4 }),
			409,
			'CONCURRENCY_CONFLICT',
			{ currentVersion: 4 }
		],
		[
			'undo refused',
			new UndoRefusedError('nope', 'LATER_CHANGE'),
			409,
			'UNDO_REFUSED',
			{ reason: 'LATER_CHANGE' }
		],
		[
			'merge conflict',
			new UnionMergeConflictError('pick one', [{ type: 'MARR' }]),
			409,
			'UNION_MERGE_CONFLICT',
			{ reason: 'MERGE_CONFLICT', conflicts: [{ type: 'MARR' }] }
		],
		['plain domain error', new DomainError('odd'), 400, 'BAD_REQUEST', undefined]
	])('%s', async (_name, error, status, code, details) => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await read(errorResponse(error, 'Failed to do it'));
		expect(result.status).toBe(status);
		expect(result.body).toEqual({ error: error.message, code, ...(details ? { details } : {}) });
		// A response the caller caused is not a server fault, so nothing is logged.
		expect(log).not.toHaveBeenCalled();
	});

	it('sends the response body as JSON', () => {
		expect(errorResponse(new NotFoundError('Tree'), 'x').headers.get('content-type')).toContain(
			'application/json'
		);
	});
});

describe('errorResponse: anything else is a logged 500', () => {
	it('returns only the fixed fallback and logs the cause once', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new Error('D1_ERROR: UNIQUE constraint failed: trees.slug');
		const result = await read(errorResponse(cause, 'Failed to create tree'));
		expect(result).toEqual({
			status: 500,
			body: { error: 'Failed to create tree', code: 'INTERNAL_ERROR' }
		});
		expect(JSON.stringify(result.body)).not.toContain('D1_ERROR');
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith('Failed to create tree:', cause);
	});

	it('returns the fallback for every thrown value, with or without a message', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const thrown of [undefined, null, '', {}, { message: '' }, new Error('secret')]) {
			expect((await read(errorResponse(thrown, 'Failed to load graph'))).body).toEqual({
				error: 'Failed to load graph',
				code: 'INTERNAL_ERROR'
			});
		}
	});

	it('prefixes the fallback for endpoints that show a generic failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(
			(
				await read(
					errorResponse(new Error('bad file'), 'Could not read file', {
						messagePrefix: 'Export failed: '
					})
				)
			).body
		).toEqual({
			error: 'Export failed: Could not read file',
			code: 'INTERNAL_ERROR'
		});
	});
});

describe('route handlers', () => {
	const sources = import.meta.glob('../../../routes/api/**/+server.ts', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;

	it('cover every API route', () => {
		expect(Object.keys(sources).length).toBeGreaterThanOrEqual(15);
	});

	it.each(Object.entries(sources))(
		'%s maps errors only through the shared helper',
		(_path, source) => {
			expect(source).not.toMatch(/instanceof DomainError/);
			if (!/catch \(/.test(source)) return;
			// A route on the shared handler may catch to clean up, as long as it rethrows for the handler to map.
			if (/(api|tree)Handler\(/.test(source))
				expect(source).toMatch(/catch \((\w+)\)[\s\S]*?throw \1;/);
			else expect(source).toContain('errorResponse(');
		}
	);
});
