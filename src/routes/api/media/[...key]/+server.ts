import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	BindingUnavailableError,
	NotFoundError,
	UnauthenticatedError,
	ValidationError
} from '#lib/server/domain/errors.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { mediaServeDecision } from '#lib/server/media/media-type.js';
import { MediaService } from '#lib/server/services/media-service.js';

export const GET: RequestHandler = async ({ params, locals, platform, request, setHeaders }) => {
	const failure = 'Failed to read media';
	// A failure must never be cached, whichever check raised it.
	const refuse = (err: unknown) => {
		setHeaders({ 'cache-control': 'no-store' });
		const response = errorResponse(err, failure);
		response.headers.set('Cache-Control', 'no-store');
		return response;
	};
	if (!locals.user) return refuse(new UnauthenticatedError());
	if (!platform?.env?.MEDIA_BUCKET || !platform?.env?.DB) {
		return refuse(new BindingUnavailableError('MEDIA_BUCKET or DB'));
	}

	const key = params.key;
	if (!key) return refuse(new ValidationError('Media object key required'));

	// Authorization runs before any cacheable answer: a request from a revoked viewer must never
	// receive a 304, and its failure must not be cached.
	let title: string | null;
	try {
		// The key is not a credential: the caller must be able to see the tree and the record it names.
		({ title } = await new MediaService(getDb(platform.env.DB)).requireRead(key, {
			user: locals.user,
			correlationId: locals.correlationId
		}));
	} catch (err) {
		return refuse(err);
	}

	const object = await platform.env.MEDIA_BUCKET.get(key);
	if (!object) {
		// A direct response, not `error(404)`: relying on SvelteKit's setHeaders-on-thrown-error
		// behaviour to attach no-store is fragile, and a missing object must never be cached.
		return refuse(new NotFoundError('Media object'));
	}

	// The stored content type comes from whoever uploaded the object, so it is never replayed: the
	// response type is chosen from an allowlist. This is what stops an uploaded `text/html` or
	// `image/svg+xml` from running as script on our own origin.
	const decision = mediaServeDecision(object.httpMetadata?.contentType, key, title);
	const headers = new Headers();
	headers.set('Content-Type', decision.contentType);
	headers.set('Content-Disposition', decision.contentDisposition);
	headers.set('etag', object.httpEtag);
	headers.set('X-Content-Type-Options', 'nosniff');
	// A PDF cannot render under a sandbox CSP in Chrome; see ADR-073 for what that leaves exposed.
	if (decision.shouldSandbox) headers.set('Content-Security-Policy', 'sandbox');
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
