import { generationsParam } from '#lib/api/load-helpers.js';
import { treeServerLoad } from '#lib/server/http/page-load.js';
import { ChartService } from '#lib/server/services/chart-service.js';
import { NarrativeService } from '#lib/server/services/narrative-service.js';
import { DESCENDANT_NUMBERINGS } from '#lib/shared/descendant-numbers.js';
import {
	BOOK_SECTIONS,
	DEFAULT_NARRATIVE_GENERATIONS,
	MAX_NARRATIVE_GENERATIONS,
	NARRATIVE_KINDS,
	type BookSection
} from '#lib/shared/reports.js';
import type { PageServerLoad } from './$types';

/** Ticked sections arrive as repeated `section=` values; none ticked means the whole book. */
export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to load the family book', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { params, url }) => {
		const asked = url.searchParams
			.getAll('section')
			.filter((s): s is BookSection => (Object.values(BOOK_SECTIONS) as string[]).includes(s));
		const sections = asked.length > 0 ? asked : Object.values(BOOK_SECTIONS);
		const generations = generationsParam(url, 'generations', {
			fallback: DEFAULT_NARRATIVE_GENERATIONS,
			max: MAX_NARRATIVE_GENERATIONS
		});
		const narratives = new NarrativeService(db);
		const tell = (kind: (typeof NARRATIVE_KINDS)[keyof typeof NARRATIVE_KINDS]) =>
			narratives.narrative(
				treeId,
				params.personId,
				kind,
				generations,
				DESCENDANT_NUMBERINGS.DABOVILLE,
				ctx
			);
		const [ancestors, descendants, pedigree] = await Promise.all([
			sections.includes(BOOK_SECTIONS.ANCESTORS) ? tell(NARRATIVE_KINDS.ANCESTORS) : null,
			sections.includes(BOOK_SECTIONS.DESCENDANTS) ? tell(NARRATIVE_KINDS.DESCENDANTS) : null,
			// The gaps and the title page both need the person; the pedigree read is the cheap way to name them.
			new ChartService(db).pedigree(treeId, params.personId, generations, ctx)
		]);
		return { book: { sections, generations, ancestors, descendants, pedigree } };
	}
);
