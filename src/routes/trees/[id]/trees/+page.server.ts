import { error, redirect } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import type { PageServerLoad } from './$types';

/**
 * The Trees page was split by scope (ADR-075): the install owner's list is Administration, and
 * everyone else's choices are on the account page. The public visitor has neither.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to open the trees', allowPublicVisitor: true },
	async ({ ctx }, { parent }) => {
		// The layout is what refuses a tree the caller cannot open.
		await parent();
		if (ctx.user.isPublicVisitor) error(404, 'Not found');
		redirect(302, ctx.user.isInstallOwner ? '/admin' : '/account#trees');
	}
);
