import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ProfileService } from '#lib/server/services/profile-service.js';
import type { PageServerLoad } from './$types';

/**
 * A person's own profile. It belongs to the person, not the tree: the page sits under a tree only
 * to keep the header. The public visitor has no profile, and the loader refuses them by default.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load your profile' },
	async ({ db, ctx }, { parent }) => {
		// The layout is what refuses a tree the caller cannot open; this page reads none of its data.
		await parent();
		return { profile: await new ProfileService(db).view(ctx) };
	}
);
