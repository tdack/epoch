import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';
import { getDb, type DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { parseBody, parseQuery } from '../validation';
import { errorResponse } from './error-response';
import { TreeService } from '../services/tree-service';

type Schema = z.ZodTypeAny | undefined;
type Parsed<S extends Schema> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

export interface HandlerOptions<B extends Schema, Q extends Schema> {
	/** Names the operation ("Failed to save the fact"); the message when a thrown value has none. */
	failure: string;
	/** Validates the JSON request body. An unreadable body is read as `{}`, so the schema decides. */
	body?: B;
	/** Validates the query string. */
	query?: Q;
	/** Route parameters besides `id` that must be present; each missing one is a 400. */
	params?: readonly string[];
	/** The success status; 200 unless the handler creates something. */
	status?: number;
	/** Passed to `errorResponse` for endpoints whose clients show a generic failure. */
	messagePrefix?: string;
}

export interface ApiArgs<B, Q> {
	db: DbClient;
	ctx: AuthenticatedContext;
	/** The raw event, for the few handlers that read a form, a stream or a header. */
	event: RequestEvent;
	params: Record<string, string>;
	url: URL;
	body: B;
	query: Q;
}

export interface TreeArgs<B, Q> extends ApiArgs<B, Q> {
	treeId: string;
}

/**
 * The version a client says it read, from `?version=`; undefined when it did not say. Not
 * validated here: the service rejects a version that is not a whole number.
 */
export function expectedVersion(url: URL): number | undefined {
	const value = url.searchParams.get('version');
	return value === null ? undefined : Number(value);
}

/** What a handler returns when it builds the whole response itself (a file, a redirect). */
type Result = Response | unknown;

async function handle<B extends Schema, Q extends Schema>(
	event: RequestEvent,
	options: HandlerOptions<B, Q>,
	requiredParams: readonly string[],
	run: (args: ApiArgs<Parsed<B>, Parsed<Q>>) => Promise<Result> | Result
): Promise<Response> {
	const { locals, platform } = event;
	// Present and non-empty once the loop below passes; the generated route types cannot say so.
	const params = event.params as Record<string, string>;
	if (!locals.user) return Response.json({ error: 'Authentication required' }, { status: 401 });
	for (const name of requiredParams) {
		if (!params[name]) return Response.json({ error: `${name} required` }, { status: 400 });
	}
	if (!platform?.env?.DB)
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });

	try {
		const body = (
			options.body
				? parseBody(options.body, await event.request.json().catch(() => ({})))
				: undefined
		) as Parsed<B>;
		const query = (
			options.query ? parseQuery(options.query, event.url.searchParams) : undefined
		) as Parsed<Q>;
		const result = await run({
			db: getDb(platform.env.DB),
			ctx: { user: locals.user, correlationId: locals.correlationId },
			event,
			params,
			url: event.url,
			body,
			query
		});
		if (result instanceof Response) return result;
		return Response.json(result, options.status ? { status: options.status } : undefined);
	} catch (err) {
		return errorResponse(
			err,
			options.failure,
			options.messagePrefix ? { messagePrefix: options.messagePrefix } : undefined
		);
	}
}

/**
 * A signed-in endpoint that is not about one tree (the tree list, the import form). Owns the 401
 * and the missing-binding 500, the database client, the caller's context, body and query
 * validation, and turning a thrown error into its response.
 */
export function apiHandler<B extends Schema = undefined, Q extends Schema = undefined>(
	options: HandlerOptions<B, Q>,
	run: (args: ApiArgs<Parsed<B>, Parsed<Q>>) => Promise<Result> | Result
): RequestHandler {
	return (event) => handle(event, options, options.params ?? [], run);
}

/**
 * An endpoint under `/api/trees/[id]`. Everything `apiHandler` does, plus the tree id. Whether the
 * caller may act on the tree is the service's call, never the handler's.
 *
 * The segment may be the tree's slug (ADR-045); it is turned into the id here, once, so no service
 * ever sees a slug. A segment that names no tree is passed on unchanged, and the service refuses it
 * exactly as it refuses a missing id, so an unknown slug says no more than an unknown id.
 */
export function treeHandler<B extends Schema = undefined, Q extends Schema = undefined>(
	options: HandlerOptions<B, Q>,
	run: (args: TreeArgs<Parsed<B>, Parsed<Q>>) => Promise<Result> | Result
): RequestHandler {
	return (event) =>
		handle(event, options, ['id', ...(options.params ?? [])], async (args) =>
			run({
				...args,
				treeId: await new TreeService(args.db).resolveSegment(args.params.id)
			})
		);
}
