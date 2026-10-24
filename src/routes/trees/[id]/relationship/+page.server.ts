import { treeServerLoad } from '#lib/server/http/page-load.js';
import { KinshipService } from '#lib/server/services/kinship-service.js';
import { TreeService } from '#lib/server/services/tree-service.js';
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
			// The other end starts as the member themself, unless they are the person already named.
			const me = await new TreeService(db).selfPerson(treeId, ctx);
			return {
				from,
				to,
				fromName: named?.displayName ?? null,
				me: me && me.id !== from && me.id !== to ? me : null,
				result: null
			};
		}
		return {
			from,
			to,
			fromName: null,
			me: null,
			result: await new KinshipService(db).relationship(treeId, from, to, ctx)
		};
	}
);
