import { WELCOME_PATH } from '../../shared/access';

// Defined beside the sign-out address, which the client builds and which returns here.
export { WELCOME_PATH };

/**
 * The one path the Access application covers. Access authenticates the visitor and sets the
 * cookie there; Epoch's own route then sends them on.
 */
export const LOGIN_PATH = '/login';

/** Pages served without an identified user. Every other page and endpoint denies by default. */
const PUBLIC_PAGE_PATHS: readonly string[] = [WELCOME_PATH, LOGIN_PATH];

export function isPublicPagePath(pathname: string): boolean {
	return PUBLIC_PAGE_PATHS.includes(pathname);
}

export interface SignedOutRequest {
	pathname: string;
	/** Included in `next`, so a deep link keeps its query. */
	search: string;
	method: string;
	/** SvelteKit's `__data.json` fetch made during client-side navigation. */
	isDataRequest: boolean;
	hasUser: boolean;
	/** A token was presented but failed validation (expired, wrong audience, bad signature). */
	hasInvalidToken: boolean;
}

/**
 * Where a request with no identified user should be sent instead of served, or `null` to serve it.
 *
 * Only full page loads are redirected. An API call keeps its 401, since a script calling it wants
 * a status, not a page; a client-side data request would follow a 303 to HTML it cannot parse,
 * and its page's own API calls already fail with 401. Anything but GET or HEAD is left to fail
 * where it lands, rather than silently turning a submission into a navigation.
 *
 * A visitor whose token failed validation has signed in before, so Access can usually renew the
 * session without asking anything: they go straight to `/login`. Everyone else sees the splash.
 */
export function signedOutRedirect(request: SignedOutRequest): string | null {
	if (request.hasUser) return null;
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	if (request.isDataRequest) return null;
	if (request.pathname === '/api' || request.pathname.startsWith('/api/')) return null;
	if (isPublicPagePath(request.pathname)) return null;
	const next = encodeURIComponent(request.pathname + request.search);
	return `${request.hasInvalidToken ? LOGIN_PATH : WELCOME_PATH}?next=${next}`;
}

export interface PublicReadRequest {
	pathname: string;
	method: string;
	/** Access presented a token, valid or not: that visitor is signed in, or has been, and is not anonymous. */
	hasToken: boolean;
	/** Someone is already identified (a real user or the dev bypass). */
	hasUser: boolean;
}

/** What an anonymous request may be let in to read: any API path, or one tree's pages. */
export type PublicReadAccess = { kind: 'api' } | { kind: 'tree'; treeId: string } | null;

/**
 * Whether a page address's tree segment names the public tree, by its id or its slug (ADR-045).
 * The anonymous page gate asks this; a slug link to the public tree must open like an id link.
 */
export function isPublicTreeSegment(
	publicTree: { id: string; slug: string | null } | null,
	segment: string
): boolean {
	return publicTree !== null && (publicTree.id === segment || publicTree.slug === segment);
}

/** The tree segment (an id or a slug) of `/trees/<segment>` and `/trees/<segment>/...`, or null for any other path. */
export function treeIdOfPath(pathname: string): string | null {
	const match = /^\/trees\/([^/]+)(?:\/|$)/.exec(pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]!);
	} catch {
		return null;
	}
}

/**
 * Whether an unidentified request may be served as the public visitor (ADR-041), and what it must
 * then be shown to be public. Reads only: a write is left unauthenticated and fails with a 401.
 *
 * Any API path qualifies because the handler factories refuse the visitor unless a route opts in
 * (`allowPublicVisitor`), and an opted-in tree route refuses any tree but the public one, exactly
 * as it refuses a stranger. A page does not: only the pages of the public tree are served, so the
 * caller must confirm `treeId` is the public one. A request that carried a token never qualifies,
 * so someone Access named is handled as the signed-in or not-admitted visitor they are, not as an
 * anonymous one.
 */
export function publicReadAccess(request: PublicReadRequest): PublicReadAccess {
	if (request.hasUser || request.hasToken) return null;
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	if (request.pathname === '/api' || request.pathname.startsWith('/api/')) return { kind: 'api' };
	const treeId = treeIdOfPath(request.pathname);
	return treeId ? { kind: 'tree', treeId } : null;
}

/** Where a signed-in visitor Epoch does not admit is sent; the welcome page decides its state from `locals`, not from this query. */
export const NOT_INVITED_PATH = `${WELCOME_PATH}?reason=not-invited`;

export interface NotAdmittedRequest {
	pathname: string;
	method: string;
	/** SvelteKit's `__data.json` fetch made during client-side navigation. */
	isDataRequest: boolean;
	/** Access named the visitor, and Epoch did not admit them (ADR-034). */
	isNotAdmitted: boolean;
}

/** How to turn away a visitor Epoch does not admit: a redirect, a refusal, or `null` to serve. */
export type NotAdmittedOutcome = { status: 303; location: string } | { status: 403 } | null;

/**
 * What to do with a request from someone Access named but Epoch does not admit (ADR-034). Mirrors
 * `signedOutRedirect`: the visitor has no user, so everything that is not a page load already fails
 * where it lands, and only the page load needs somewhere to go.
 *
 * An API call gets a 403 rather than the 401 the handler would give, since signing in again would
 * not help; a data request and a submission are left to fail as they do signed out. `/welcome` and
 * `/login` stay reachable, so the redirect cannot loop.
 */
export function notAdmittedOutcome(request: NotAdmittedRequest): NotAdmittedOutcome {
	if (!request.isNotAdmitted) return null;
	if (isPublicPagePath(request.pathname)) return null;
	if (request.pathname === '/api' || request.pathname.startsWith('/api/')) return { status: 403 };
	if (request.isDataRequest) return null;
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	return { status: 303, location: NOT_INVITED_PATH };
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
	const path = resolved.pathname + resolved.search + resolved.hash;
	// Dot-segment collapsing can leave a `//` (or `/\`) prefix that the origin check cannot see, and
	// a browser given it as a Location header follows it to another host.
	if (path.startsWith('//') || path.startsWith('/\\')) return '/';
	return path;
}
