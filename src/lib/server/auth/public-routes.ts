/**
 * Where a visitor nobody has identified lands. It is the only page served without a user, and it
 * shows nothing from any tree.
 */
export const WELCOME_PATH = '/welcome';

/** Pages served without an identified user. Every other page and endpoint denies by default. */
export const PUBLIC_PAGE_PATHS: readonly string[] = [WELCOME_PATH];

export function isPublicPagePath(pathname: string): boolean {
	return PUBLIC_PAGE_PATHS.includes(pathname);
}

export interface SignedOutRequest {
	pathname: string;
	method: string;
	/** SvelteKit's `__data.json` fetch made during client-side navigation. */
	isDataRequest: boolean;
	hasUser: boolean;
}

/**
 * Whether a request with no identified user should be sent to the welcome page instead of served.
 *
 * Only full page loads are redirected. An API call keeps its 401, since a script calling it wants
 * a status, not a page; a client-side data request would follow a 303 to HTML it cannot parse,
 * and its page's own API calls already fail with 401. Anything but GET or HEAD is left to fail
 * where it lands, rather than silently turning a submission into a navigation.
 */
export function shouldRedirectToWelcome(request: SignedOutRequest): boolean {
	if (request.hasUser) return false;
	if (request.method !== 'GET' && request.method !== 'HEAD') return false;
	if (request.isDataRequest) return false;
	if (request.pathname === '/api' || request.pathname.startsWith('/api/')) return false;
	return !isPublicPagePath(request.pathname);
}
