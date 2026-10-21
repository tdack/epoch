import { redirect } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import type { PageServerLoad } from './$types';

/** The profile moved to the account page (ADR-075); the tree is still resolved so a bad address stays a 403 or 404. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to open your account' },
	async (_scope, { parent }) => {
		// The layout is what refuses a tree the caller cannot open.
		await parent();
		redirect(302, '/account');
	}
);
