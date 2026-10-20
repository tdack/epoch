import { BindingUnavailableError } from '#lib/server/domain/errors.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { mediaServeDecision } from '#lib/server/media/media-type.js';
import { ProfileService } from '#lib/server/services/profile-service.js';

/**
 * A person's avatar, for themself and for anyone who shares a tree with them. Not for the public
 * visitor: `apiHandler` refuses them, as it does for every endpoint that does not opt in.
 */
export const GET = apiHandler(
	{ failure: 'Failed to read the picture', params: ['userId'] },
	async ({ db, ctx, event, params }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');
		const object = await new ProfileService(db).readAvatar(params.userId, bucket, ctx);
		// The stored type is the one this app sniffed, but the allowlist still decides what is sent.
		const decision = mediaServeDecision(object.httpMetadata?.contentType, object.key);
		return new Response(object.body as unknown as ReadableStream, {
			headers: {
				'Content-Type': decision.contentType,
				'Content-Disposition': decision.contentDisposition,
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': 'sandbox',
				'Cross-Origin-Resource-Policy': 'same-origin',
				// Private: a shared cache would hand the picture to someone who never passed the check. The
				// `?v=` on the URL changes with the picture, so an hour is only how long a revoked
				// co-member keeps a copy they already fetched.
				'Cache-Control': 'private, max-age=3600'
			}
		});
	}
);
