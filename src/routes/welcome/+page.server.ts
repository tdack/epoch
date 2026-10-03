import type { PageServerLoad } from './$types';
import { LOGIN_PATH, safeNextPath } from '#lib/server/auth/public-routes.js';

// The page is served to visitors nobody has identified, so it ships no client code that could
// later be taught to call the API from here.
// SvelteKit reads this exact name, so it cannot take the boolean prefix.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const csr = false;

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNextPath(url.searchParams.get('next'));
	const isSignedIn = locals.user !== null;
	return {
		isSignedIn,
		// Signed in, there is nothing for Access to do; signed out, `/login` is the one path it covers.
		actionHref: isSignedIn ? next : `${LOGIN_PATH}?next=${encodeURIComponent(next)}`,
		// Link unfurlers need absolute URLs, and the host differs between preview and production.
		pageUrl: new URL(url.pathname, url.origin).href,
		imageUrl: new URL('/brand/og-image.png', url.origin).href
	};
};
