import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import type { z } from 'zod';
import { getDb, type DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import {
	BindingUnavailableError,
	UnauthenticatedError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import { parseBody, parseQuery } from '../validation';
import { errorResponse } from './error-response';
import { PublicTreeService } from '../services/public-tree-service';
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
	/**
	 * Lets the public visitor (ADR-041) call this. Off by default, so a new endpoint refuses the
	 * visitor until someone decides it may read. A tree endpoint that opts in is still refused for
	 * any tree that is not the public one.
	 */
	allowPublicVisitor?: boolean;
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

/**
 * The same 403 for every refusal of the visitor, whether the endpoint is closed to them or the tree
 * is not public, so a probe cannot tell a private tree from an unknown id.
 */
const VISITOR_REFUSED_MESSAGE = 'Forbidden: sign in to do that';

/** Handlers built with `allowPublicVisitor`, and every handler a factory built at all. */
const publicVisitorHandlers = new WeakSet<RequestHandler>();
const factoryHandlers = new WeakSet<RequestHandler>();

/** Whether this handler was built with `allowPublicVisitor` (ADR-041). For the privacy matrix test. */
export function allowsPublicVisitor(handler: RequestHandler): boolean {
	return publicVisitorHandlers.has(handler);
}

/** Whether this handler came from `apiHandler` or `treeHandler`. For the privacy matrix test. */
export function isFactoryHandler(handler: RequestHandler): boolean {
	return factoryHandlers.has(handler);
}

function mark(handler: RequestHandler, options: { allowPublicVisitor?: boolean }): RequestHandler {
	factoryHandlers.add(handler);
	if (options.allowPublicVisitor) publicVisitorHandlers.add(handler);
	return handler;
}

async function handle<B extends Schema, Q extends Schema>(
	event: RequestEvent,
	options: HandlerOptions<B, Q>,
	requiredParams: readonly string[],
	run: (args: ApiArgs<Parsed<B>, Parsed<Q>>) => Promise<Result> | Result
): Promise<Response> {
	const { locals, platform } = event;
	// Present and non-empty once the loop below passes; the generated route types cannot say so.
	const params = event.params as Record<string, string>;
	if (!locals.user) return errorResponse(new UnauthenticatedError(), options.failure);
	// A 403, never a 401: the client restarts sign-in on a 401, and a visitor has nothing to sign in to.
	if (locals.user.isPublicVisitor && !options.allowPublicVisitor)
		return errorResponse(new UnauthorizedError(VISITOR_REFUSED_MESSAGE), options.failure);
	for (const name of requiredParams) {
		if (!params[name])
			return errorResponse(new ValidationError(`${name} required`), options.failure);
	}
	if (!platform?.env?.DB) return errorResponse(new BindingUnavailableError('DB'), options.failure);

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
	return mark((event) => handle(event, options, options.params ?? [], run), options);
}

/**
 * An endpoint under `/api/trees/[id]`. Everything `apiHandler` does, plus the tree id. Whether a
 * signed-in caller may act on the tree is the service's call. The one decision made here is for the
 * anonymous public visitor (ADR-052): it is refused for any tree but the public one, so a handler
 * that forgot its own guard cannot show it another tree.
 *
 * The segment may be the tree's slug (ADR-045); it is turned into the id here, once, so no service
 * ever sees a slug. A segment that names no tree is passed on unchanged, and the service refuses it
 * exactly as it refuses a missing id, so an unknown slug says no more than an unknown id.
 */
export function treeHandler<B extends Schema = undefined, Q extends Schema = undefined>(
	options: HandlerOptions<B, Q>,
	run: (args: TreeArgs<Parsed<B>, Parsed<Q>>) => Promise<Result> | Result
): RequestHandler {
	return mark(
		(event) =>
			handle(event, options, ['id', ...(options.params ?? [])], async (args) => {
				const treeId = await new TreeService(args.db).resolveSegment(args.params.id);
				// Only the public tree is open to the visitor, by the id the segment resolved to, so a
				// slug and an id cannot disagree about which tree this is.
				if (args.ctx.user.isPublicVisitor) {
					const publicTree = await new PublicTreeService(args.db).current();
					if (publicTree?.id !== treeId) throw new UnauthorizedError(VISITOR_REFUSED_MESSAGE);
				}
				return run({ ...args, treeId });
			}),
		options
	);
}
