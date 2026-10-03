/** Helpers shared by the route load functions. */

import { error } from '@sveltejs/kit';
import { parseListParams } from '../shared/lists.js';
import { ApiError } from './tree-api.js';

/** The key every tree screen's load function depends on; invalidating it reloads what is on screen. */
export const DATA_KEY = 'epoch:data';

/** Turn a failed API call into the SvelteKit error page with the same status, rather than a blank screen. */
function rethrowAsPageError(cause: unknown): never {
	if (cause instanceof ApiError) error(cause.status, cause.message);
	throw cause;
}

/** What `treeLoad` needs of a SvelteKit load event; the load itself sees the whole of its own. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoadEventLike = any;

/**
 * Wraps a tree screen's load: registers the dependency that lets `invalidate(DATA_KEY)` reload it,
 * and turns a failed API call into the error page. Anything else a load throws (a `redirect`, an
 * `error()` of its own, a bug) passes through untouched.
 */
export function treeLoad<Load extends (event: LoadEventLike) => unknown>(run: Load): Load {
	// The cast is the contract: callers hand in a `PageLoad` or `LayoutLoad` body and get the same
	// type back, so the generated route types still describe what the load returns.
	return (async (event: LoadEventLike) => {
		event.depends(DATA_KEY);
		try {
			return await run(event);
		} catch (cause) {
			rethrowAsPageError(cause);
		}
	}) as Load;
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

/** Where the last person viewed in a tree is remembered, so reopening the tree resumes there. */
export function rememberedFocusKey(treeId: string): string {
	return `epoch:focus:${treeId}`;
}
