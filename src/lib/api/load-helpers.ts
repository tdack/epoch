/** Helpers shared by the route load functions. */

import { error } from '@sveltejs/kit';
import { parseListParams } from '../shared/lists.js';
import { ApiError } from './client.js';

/** The key every tree screen's load function depends on; invalidating it reloads what is on screen. */
export const DATA_KEY = 'epoch:data';

/** Turn a failed API call into the SvelteKit error page with the same status, rather than a blank screen. */
function rethrowAsPageError(cause: unknown): never {
	if (cause instanceof ApiError) error(cause.status, cause.message);
	throw cause;
}

/** What `treeLoad` needs of a SvelteKit load event; the load itself sees the whole of its own. */
interface DependsEvent {
	depends(...deps: `${string}:${string}`[]): void;
}

/**
 * Wraps a tree screen's load: registers the dependency that lets `invalidate(DATA_KEY)` reload it,
 * and turns a failed API call into the error page. Anything else a load throws (a `redirect`, an
 * `error()` of its own, a bug) passes through untouched.
 *
 * `Event` is inferred from the generated `PageLoad` or `LayoutLoad` the result is assigned to, so
 * the body still sees that route's own event and the route's types still describe what it returns.
 */
export function treeLoad<Event extends DependsEvent, Result>(
	run: (event: Event) => Result
): (event: Event) => Promise<Awaited<Result>> {
	return async (event): Promise<Awaited<Result>> => {
		event.depends(DATA_KEY);
		try {
			return await run(event);
		} catch (cause) {
			rethrowAsPageError(cause);
		}
	};
}

/**
 * A chart depth from the address: a whole number above zero, no more than `max` when there is one,
 * else `fallback`. A hand-edited address never reaches the API with a depth it would refuse.
 */
export function generationsParam(
	url: URL,
	key: string,
	{ fallback, max }: { fallback: number; max?: number }
): number {
	const asked = Number(url.searchParams.get(key));
	if (!Number.isInteger(asked) || asked <= 0) return fallback;
	return max === undefined ? asked : Math.min(asked, max);
}

/** The paging query for a list endpoint: the address's offset and limit, normalised, after any `extra`. */
export function listQuery(url: URL, extra: Record<string, string> = {}): URLSearchParams {
	const { offset, limit } = parseListParams(url.searchParams);
	return new URLSearchParams({ ...extra, offset: String(offset), limit: String(limit) });
}

/** Where the last person viewed in a tree (or in one of its sub-trees) is remembered, so reopening the tree resumes there. */
export function rememberedFocusKey(treeId: string, subtreeId: string | null = null): string {
	// Separate from the whole tree's, so leaving a lens does not move where the tree reopens.
	return subtreeId ? `epoch:focus:${treeId}~${subtreeId}` : `epoch:focus:${treeId}`;
}
