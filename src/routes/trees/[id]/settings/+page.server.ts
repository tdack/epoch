import { error, redirect } from '@sveltejs/kit';
import { isActionAllowed } from '#lib/server/auth/authorization.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import { PrivacyService } from '#lib/server/services/privacy-service.js';
import { SubtreeService } from '#lib/server/services/subtree-service.js';
import type { PageServerLoad } from './$types';

/**
 * Settings for the tree, for everyone in it (ADR-075). The public visitor has no tree to
 * administer, so the page is not theirs. A member below manager most likely followed an old
 * bookmark of the personal colours that used to live here, so they go to their account.
 */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the tree settings', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { parent }) => {
		const { summary } = await parent();
		if (summary.viewer.isPublicVisitor) error(404, 'Not found');
		const { role, isInstallOwner } = summary.viewer;
		if (!isActionAllowed(role, 'tree:update_settings')) redirect(302, '/account');

		const [privacy, subtrees] = await Promise.all([
			new PrivacyService(db).getSettings(treeId, ctx),
			new SubtreeService(db).list(treeId, ctx)
		]);
		// The list carries ids only; a root the viewer cannot open (deleted, or hidden by privacy) has no
		// name to show, and the row says so rather than failing the page.
		const rootNames: Record<string, string> = {};
		const people = new PersonPageService(db);
		await Promise.all(
			subtrees
				.filter((s) => !s.isRootMissing)
				.map(async (s) => {
					try {
						rootNames[s.rootPersonId] = (
							await people.getPerson(treeId, s.rootPersonId, ctx, null)
						).person.displayName;
					} catch {
						// Left out on purpose.
					}
				})
		);
		return {
			privacy,
			subtrees,
			rootNames,
			// Decided here so the page never imports the server's action table; the endpoints still decide.
			canManageSubtrees: isActionAllowed(role, 'tree:manage_subtrees'),
			canExport: isActionAllowed(role, 'tree:export'),
			canDelete: isActionAllowed(role, 'tree:delete') || isInstallOwner
		};
	}
);
