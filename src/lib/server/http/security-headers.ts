/**
 * Headers every response carries unless its route already set the header. A route that needs a
 * stricter value (media serving sets `Content-Security-Policy: sandbox`) keeps it, so this layer
 * only fills gaps and never weakens a route's answer.
 */
const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'X-Content-Type-Options': 'nosniff',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
} as const;

/**
 * Neither `includeSubDomains` nor `preload`. Epoch is open source and may be deployed beside
 * sibling subdomains its operator does not want pinned to https, so only the host that sends the
 * header is pinned; `preload` would pin the whole registrable domain. HSTS is sent only over https, and never to a local host, so a
 * developer running https on localhost does not pin it for a year.
 */
const HSTS_VALUE = 'max-age=31536000';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function isLocalHost(hostname: string): boolean {
	return LOCAL_HOSTS.includes(hostname) || hostname.endsWith('.localhost');
}

/** The security headers a response to `url` should carry, before any route override. */
export function securityHeadersFor(url: URL): Record<string, string> {
	const headers: Record<string, string> = { ...SECURITY_HEADERS };
	if (url.protocol === 'https:' && !isLocalHost(url.hostname)) {
		headers['Strict-Transport-Security'] = HSTS_VALUE;
	}
	return headers;
}

/** Fills in the security headers the response does not already set. Mutates and returns `response`. */
export function applySecurityHeaders(response: Response, url: URL): Response {
	for (const [name, value] of Object.entries(securityHeadersFor(url))) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	return response;
}
