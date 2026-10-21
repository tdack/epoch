import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import type { PageServerLoad } from './$types';

/** The profile moved to the account page (ADR-075). Not permanent: the signed-out case sends people elsewhere first. */
export const load: PageServerLoad = serverLoad({ failure: 'Failed to open your account' }, () =>
	redirect(302, '/account')
);
