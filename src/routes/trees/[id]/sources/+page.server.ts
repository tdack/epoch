import { treeServerLoad } from '#lib/server/http/page-load.js';
import { EvidenceReadService } from '#lib/server/services/evidence-read-service.js';
import { parseListParams } from '#lib/shared/lists.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = treeServerLoad(
	{ failure: 'Failed to list sources', allowPublicVisitor: true },
	async ({ db, ctx, treeId }, { url }) => {
		const q = url.searchParams.get('q') ?? '';
		const service = new EvidenceReadService(db);
		const [page, repositories] = await Promise.all([
			service.listSources(treeId, { ...parseListParams(url.searchParams), q }, ctx),
			service.listRepositories(
				treeId,
				{ ...parseListParams(new URLSearchParams({ limit: '100' })), q: '' },
				ctx
			)
		]);
		return { q, page, repositories };
	}
);
