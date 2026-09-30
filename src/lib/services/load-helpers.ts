/** Helpers shared by the route load functions. */

import { error } from '@sveltejs/kit';
import { ApiError } from './tree-api.js';

/** The key every tree screen's load function depends on; invalidating it reloads what is on screen. */
export const DATA_KEY = 'epoch:data';

/** Favourites and recents reload on their own key, so recording a visit does not reload the page being visited. */
export const MARKS_KEY = 'epoch:marks';

/** Turn a failed API call into the SvelteKit error page with the same status, rather than a blank screen. */
export function rethrowAsPageError(cause: unknown): never {
	if (cause instanceof ApiError) error(cause.status, cause.message);
	throw cause;
}

/** Where the last person viewed in a tree is remembered, so reopening the tree resumes there. */
export function rememberedFocusKey(treeId: string): string {
	return `epoch:focus:${treeId}`;
}
