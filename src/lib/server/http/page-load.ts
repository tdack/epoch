import { error, isHttpError, isRedirect, type ServerLoadEvent } from '@sveltejs/kit';
import { getDb, type DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { BindingUnavailableError, DomainError } from '../domain/errors';
import { DATA_KEY } from '../../shared/data-key';
import type { SubtreeSummaryDto } from '../../shared/subtrees';
import { assertCaller, resolveTreeScope } from './handler';

export interface PageLoadOptions {
	/** Names the screen ("Failed to load the people"); the only text an unexpected error shows. */
	failure: string;
	/**
	 * Lets the public visitor (ADR-041) load this screen. Off by default, as for an endpoint; it
	 * must match what the endpoint this load replaced allowed.
	 */
	allowPublicVisitor?: boolean;
}

export interface PageScope {
	db: DbClient;
	ctx: AuthenticatedContext;
}

export interface TreePageScope extends PageScope {
	/** The tree the address named, as an id: the address may carry its slug. */
	treeId: string;
	/** The sub-tree lens the address carried, or null. Only scoped reads look at it. */
	subtree: SubtreeSummaryDto | null;
}

/** A failed read becomes the error page, the way `errorResponse` makes it a response: the status and message of a `DomainError`, a bare 500 for anything else. */
function asPageError(cause: unknown, failure: string): never {
	if (isRedirect(cause) || isHttpError(cause)) throw cause;
	if (cause instanceof DomainError) error(cause.status, cause.message);
	console.error(`${failure}:`, cause);
	// Never the thrown message: a driver error can carry SQL or schema names.
	error(500, failure);
}

function openScope(event: ServerLoadEvent, options: PageLoadOptions): PageScope {
	const { user, correlationId } = event.locals;
	assertCaller(user, options.allowPublicVisitor);
	const d1 = event.platform?.env?.DB;
	if (!d1) throw new BindingUnavailableError('DB');
	return { db: getDb(d1), ctx: { user, correlationId } };
}

/**
 * A server load that reads through the services, for a screen that is not about one tree. It
 * owns what `apiHandler` owns for an endpoint (sign-in, the visitor, the database, turning a
 * failure into a response), so a page render passes `handle` once and never calls its own API
 * (ADR-067).
 */
export function serverLoad<Event extends ServerLoadEvent, Result>(
	options: PageLoadOptions,
	run: (scope: PageScope, event: Event) => Result
): (event: Event) => Promise<Awaited<Result>> {
	return async (event): Promise<Awaited<Result>> => {
		try {
			return await run(openScope(event, options), event);
		} catch (cause) {
			asPageError(cause, options.failure);
		}
	};
}

/**
 * A server load for a screen under `/trees/[id]`: `serverLoad`, plus the tree and lens the
 * address names and the dependency that lets `invalidate(DATA_KEY)` reload it.
 */
export function treeServerLoad<Event extends ServerLoadEvent, Result>(
	options: PageLoadOptions,
	run: (scope: TreePageScope, event: Event) => Result
): (event: Event) => Promise<Awaited<Result>> {
	return async (event): Promise<Awaited<Result>> => {
		event.depends(DATA_KEY);
		try {
			const scope = openScope(event, options);
			const tree = await resolveTreeScope(scope.db, scope.ctx, event.params.id!);
			return await run({ ...scope, ...tree }, event);
		} catch (cause) {
			asPageError(cause, options.failure);
		}
	};
}
