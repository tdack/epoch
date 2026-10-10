/**
 * The response headers every export download is served with, in one place because the synchronous
 * route and the asynchronous download must not drift. The file carries living people (ADR-015), so
 * it is private, never cached, and never sniffed at; the name is given twice so it survives both
 * old clients and non-ASCII.
 */

export function downloadHeaders(filename: string, contentType: string, isText: boolean): Headers {
	const headers = new Headers();
	headers.set('Content-Type', isText ? `${contentType}; charset=utf-8` : contentType);
	headers.set('Content-Disposition', attachmentDisposition(filename));
	headers.set('Cache-Control', 'private, no-store');
	headers.set('X-Content-Type-Options', 'nosniff');
	return headers;
}

/** An ASCII `filename` plus an RFC 5987 `filename*`, so a name with spaces or non-ASCII survives. */
function attachmentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}

/** Encode a value for RFC 5987's `ext-value`; `encodeURIComponent` leaves `'()*`, which are not attr-chars. */
function rfc5987Encode(value: string): string {
	return encodeURIComponent(value).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}
