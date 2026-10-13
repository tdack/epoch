/**
 * Where a visitor nobody has identified lands. Besides the public tree (ADR-041), it is the only
 * page served without a user. It shows no record from any tree, only the public tree's name.
 */
export const WELCOME_PATH = '/welcome';

/**
 * Ends the Access session for the whole team domain; a page of Epoch's own could not. Served by
 * Cloudflare in front of the Worker, so it does not exist under `vite dev`.
 */
export const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

/**
 * Sign out, then land on the welcome page rather than Access's own "logged out" page. `returnTo`
 * is absolute: Access redirects to it as given, and a bare path is not reliably resolved.
 */
export function signOutHref(origin: string): string {
	return `${ACCESS_LOGOUT_PATH}?returnTo=${encodeURIComponent(new URL(WELCOME_PATH, origin).href)}`;
}
