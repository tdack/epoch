import { generationsParam } from '#lib/api/load-helpers.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { NarrativeService } from '#lib/server/services/narrative-service.js';
import { DESCENDANT_NUMBERINGS, type DescendantNumbering } from '#lib/shared/descendant-numbers.js';
import {
	DEFAULT_NARRATIVE_GENERATIONS,
	isNarrativeKind,
	MAX_NARRATIVE_GENERATIONS,
	NARRATIVE_KINDS
} from '#lib/shared/reports.js';
import type { PageServerLoad } from './$types';

/** Kind, depth and numbering live in the address; a bad value reads as the default, never an error. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the narrative', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => {
		const asked = url.searchParams.get('kind');
		const kind = isNarrativeKind(asked) ? asked : NARRATIVE_KINDS.DESCENDANTS;
		const generations = generationsParam(url, 'generations', {
			fallback: DEFAULT_NARRATIVE_GENERATIONS,
			max: MAX_NARRATIVE_GENERATIONS
		});
		const numbering = (Object.values(DESCENDANT_NUMBERINGS) as string[]).includes(
			url.searchParams.get('numbering') ?? ''
		)
			? (url.searchParams.get('numbering') as DescendantNumbering)
			: DESCENDANT_NUMBERINGS.DABOVILLE;
		return {
			narrative: await new NarrativeService(db).narrative(
				treeId,
				params.personId,
				kind,
				generations,
				numbering,
				ctx
			)
		};
	}
);
