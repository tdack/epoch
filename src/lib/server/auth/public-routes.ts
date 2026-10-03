/**
 * Where a visitor nobody has identified lands. It is the only page served without a user, and it
 * shows nothing from any tree.
 */
export const WELCOME_PATH = '/welcome';

/**
 * The one path the Access application covers. Access authenticates the visitor and sets the
 * cookie there; Epoch's own route then sends them on.
 */
export const LOGIN_PATH = '/login';

/** Pages served without an identified user. Every other page and endpoint denies by default. */
export const PUBLIC_PAGE_PATHS: readonly string[] = [WELCOME_PATH, LOGIN_PATH];

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

// Never served, only resolved against: it stands in for "this site" so a `next` value can be
// tested for staying on it without knowing the real host.
const PLACEHOLDER_ORIGIN = 'https://epoch.invalid';

/**
 * A same-site path (pathname, search and hash) taken from untrusted input such as `?next=`, or
 * `/` for anything else. Resolving with `new URL` and comparing origins catches the forms a prefix
 * check misses (`//host`, `/\host`, other schemes). `/login` and `/welcome` are refused so a
 * redirect to `next` can never land back on the page that issued it.
 */
export function safeNextPath(raw: string | null): string {
	if (!raw) return '/';
	let resolved: URL;
	try {
		resolved = new URL(raw, PLACEHOLDER_ORIGIN);
	} catch {
		return '/';
	}
	if (resolved.origin !== PLACEHOLDER_ORIGIN) return '/';
	if (resolved.pathname === LOGIN_PATH || resolved.pathname === WELCOME_PATH) return '/';
	return resolved.pathname + resolved.search + resolved.hash;
}
