import type { PageServerLoad } from './$types';

// The page is served to visitors nobody has identified, so it ships no client code that could
// later be taught to call the API from here.
export const csr = false;

export const load: PageServerLoad = ({ locals, url }) => ({
	isSignedIn: locals.user !== null,
	// Link unfurlers need absolute URLs, and the host differs between preview and production.
	pageUrl: new URL(url.pathname, url.origin).href,
	imageUrl: new URL('/brand/og-image.png', url.origin).href
});
