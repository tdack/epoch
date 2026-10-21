import { redirect } from '@sveltejs/kit';
import { serverLoad } from '#lib/server/http/page-load.js';
import type { PageServerLoad } from './$types';

/** Personal settings moved to the account page (ADR-075), which holds the colours and motion. */
export const load: PageServerLoad = serverLoad({ failure: 'Failed to open your account' }, () =>
	redirect(302, '/account#appearance')
);
