import type { PageServerLoad } from './$types';
import { LOGIN_PATH, safeNextPath } from '#lib/server/auth/public-routes.js';

// The page is served to visitors nobody has identified, so it ships no client code that could
// later be taught to call the API from here.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

type WelcomeState = 'signed-in' | 'signed-out' | 'not-invited';

/** Ends the Access session for the whole team domain; a page of Epoch's own could not. */
const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

export const load: PageServerLoad = ({ locals, url, setHeaders }) => {
	// The not-invited state names the visitor, so no cache may replay it to someone else.
	setHeaders({ 'cache-control': 'no-store' });
	const next = safeNextPath(url.searchParams.get('next'));
	// Decided from who is asking, never from `?reason=`, so a crafted link cannot show it to anyone else.
	const state: WelcomeState = locals.user
		? 'signed-in'
		: locals.notAdmitted
			? 'not-invited'
			: 'signed-out';
	const actionHrefs: Record<WelcomeState, string> = {
		// Signed in, there is nothing for Access to do; signed out, `/login` is the one path it covers.
		'signed-in': next,
		'signed-out': `${LOGIN_PATH}?next=${encodeURIComponent(next)}`,
		// "Continue" would come straight back here, and signing in again names the same person.
		'not-invited': ACCESS_LOGOUT_PATH
	};
	return {
		state,
		actionHref: actionHrefs[state],
		notAdmittedEmail: locals.notAdmitted?.email ?? null,
		// Link unfurlers need absolute URLs, and the host differs between preview and production.
		pageUrl: new URL(url.pathname, url.origin).href,
		imageUrl: new URL('/brand/og-image.png', url.origin).href
	};
};
