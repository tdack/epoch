import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { NOT_INVITED_PATH, safeNextPath, WELCOME_PATH } from '#lib/server/auth/public-routes.js';

// Nothing here needs a browser, and a page reached while sign-in is failing should not be able
// to grow a client-side retry that loops.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

export const load: PageServerLoad = ({ locals, url, setHeaders }) => {
	// The outcome depends on who is asking, so no cache may replay one visitor's redirect to another.
	setHeaders({ 'cache-control': 'no-store' });

	if (locals.user) {
		redirect(303, safeNextPath(url.searchParams.get('next')));
	}
	// Access confirmed them, so the "could not confirm" page below would be wrong, and its link back
	// to the welcome page's "Sign in" would bring them round here again.
	if (locals.notAdmitted) {
		redirect(303, NOT_INVITED_PATH);
	}

	// Access let the request through, yet Epoch could not verify it (a wrong AUD, clock skew, or
	// local development without the bypass). Redirecting from here would bounce the visitor between
	// this page and Access forever, so the page says so and stops.
	return { welcomePath: WELCOME_PATH };
};
