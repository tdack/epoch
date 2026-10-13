/**
 * Ends the Access session for the whole team domain; a page of Epoch's own could not. Served by
 * Cloudflare in front of the Worker, so it does not exist under `vite dev`.
 */
export const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';
