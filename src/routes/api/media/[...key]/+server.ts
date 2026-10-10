import { error, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { mediaServeDecision } from '#lib/server/media/media-type.js';
import { MediaService } from '#lib/server/services/media-service.js';

export const GET: RequestHandler = async ({ params, locals, platform, request, setHeaders }) => {
	if (!locals.user) {
		return Response.json(
			{ error: 'Authentication required' },
			{ status: 401, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	if (!platform?.env?.MEDIA_BUCKET || !platform?.env?.DB) {
		error(500, 'R2 storage binding unavailable');
	}

	const key = params.key;
	if (!key) {
		error(400, 'Media object key required');
	}

	// Authorization runs before any cacheable answer: a request from a revoked viewer must never
	// receive a 304, and its failure must not be cached.
	try {
		// The key is not a credential: the caller must be able to see the tree and the record it names.
		await new MediaService(getDb(platform.env.DB)).requireRead(key, {
			user: locals.user,
			correlationId: locals.correlationId
		});
	} catch (err) {
		setHeaders({ 'cache-control': 'no-store' });
		const response = errorResponse(err, 'Failed to read media');
		response.headers.set('Cache-Control', 'no-store');
		return response;
	}

	const object = await platform.env.MEDIA_BUCKET.get(key);
	if (!object) {
		// A direct response, not `error(404)`: relying on SvelteKit's setHeaders-on-thrown-error
		// behaviour to attach no-store is fragile, and a missing object must never be cached.
		return Response.json(
			{ error: 'Media object not found' },
			{ status: 404, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// The stored content type comes from whoever uploaded the object, so it is never replayed: the
	// response type is chosen from an allowlist. This is what stops an uploaded `text/html` or
	// `image/svg+xml` from running as script on our own origin.
	const decision = mediaServeDecision(object.httpMetadata?.contentType, key);
	const headers = new Headers();
	headers.set('Content-Type', decision.contentType);
	headers.set('Content-Disposition', decision.contentDisposition);
	headers.set('etag', object.httpEtag);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Content-Security-Policy', 'sandbox');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	headers.set('Referrer-Policy', 'no-referrer');
	// Private, not public: a shared cache would hand the object to someone who never passed the
	// check above. No-cache rather than a year of immutable: the bytes may change, so a client must
	// revalidate (below) instead of reusing a stale private copy.
	headers.set('Cache-Control', 'private, no-cache');

	// The check above has passed, so an unchanged object answers 304; the ETag is the whole body.
	if (request.headers.get('if-none-match') === object.httpEtag) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(object.body as unknown as ReadableStream, {
		headers
	});
};
