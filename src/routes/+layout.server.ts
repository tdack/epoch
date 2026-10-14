import { SOURCE_COMMIT, sourceUrl } from '#lib/server/source-url.js';
import type { LayoutServerLoad } from './$types';

/** What every page needs from the server: where its source can be had (AGPL section 13). */
export const load: LayoutServerLoad = ({ platform }) => ({
	sourceUrl: sourceUrl(platform?.env),
	sourceCommit: SOURCE_COMMIT
});
