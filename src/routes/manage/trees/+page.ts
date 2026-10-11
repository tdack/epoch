import { error } from '@sveltejs/kit';
import { ApiError, fetchInstallTrees } from '#lib/services/tree-api.js';
import type { PageLoad } from './$types';

/** Every tree in the install, for its owner. Anyone else is refused by the endpoint, and sees why. */
export const load: PageLoad = async ({ fetch, url }) => {
	try {
		return { trees: await fetchInstallTrees(fetch), fromTreeId: url.searchParams.get('from') };
	} catch (cause) {
		if (cause instanceof ApiError) error(cause.status, cause.message);
		throw cause;
	}
};
