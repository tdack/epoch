import { treeServerLoad } from '#lib/server/http/page-load.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';
import { PersonPageService } from '#lib/server/services/person-page-service.js';
import type { PageServerLoad } from './$types';

/** The two people live in the address, so a refresh, the back button and a bookmark keep the question. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to work out the relationship', allowPublicVisitor: true },
	async ({ db, ctx, treeId, subtree }, { url }) => {
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');
		if (!from || !to) {
			// A link from a person's page names only the first person; the picker needs their name.
			const named = from
				? (
						await new PersonPageService(db).getPerson(
							treeId,
							from,
							ctx,
							subtree?.rootPersonId ?? null
						)
					).person
				: null;
			return { from, to, fromName: named?.displayName ?? null, result: null };
		}
		return {
			from,
			to,
			fromName: null,
			result: await new KinshipService(db).relationship(treeId, from, to, ctx)
		};
	}
);
