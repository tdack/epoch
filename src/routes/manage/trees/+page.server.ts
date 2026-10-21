import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import type { PageServerLoad } from './$types';

/** Old links to the Trees page land on the page that now holds what the viewer could do there (ADR-075). */
export const load: PageServerLoad = serverLoad({ failure: 'Failed to open the trees' }, ({ ctx }) =>
	redirect(302, ctx.user.isInstallOwner ? '/admin' : '/account#trees')
);
