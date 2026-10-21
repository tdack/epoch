import { redirect } from '@sveltejs/kit';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { treePath } from '#lib/shared/tree-slug.js';
import type { PageServerLoad } from './$types';

/** The privacy rules moved to Tree settings (ADR-075); old bookmarks and links land there. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to open the privacy settings' },
	async (_scope, { parent }) => {
		const { summary } = await parent();
		// Not permanent: the page could come back. The lens is dropped; settings are about the whole tree.
		redirect(302, `${treePath({ ...summary.tree, subtree: null })}/settings#visibility`);
	}
);
