import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { assertUploadWithinSizeLimit, validateMediaUpload } from '#lib/server/media/media-type.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { PayloadTooLargeError, ValidationError } from '#lib/server/domain/errors.js';
import { MAX_MEDIA_UPLOAD_BYTES } from '#lib/shared/media.js';

/** Multipart framing around the file (boundaries, headers) costs a little over the file itself. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

/** The largest request body the route will read: the file cap plus its multipart framing. */
const MAX_UPLOAD_BODY_BYTES = MAX_MEDIA_UPLOAD_BYTES + MULTIPART_SLACK_BYTES;

/**
 * Parse a multipart upload while counting the bytes as they arrive, so an oversized body is aborted
 * mid-stream rather than buffered whole. This is the authoritative size control: it does not trust
 * `Content-Length`, which a client may omit (HTTP/2, chunked) or understate to slip a large body
 * into the isolate before rejection.
 *
 * @throws PayloadTooLargeError when the streamed body exceeds {@link MAX_UPLOAD_BODY_BYTES}.
 * @throws ValidationError when the body is missing or is not valid multipart form data.
 */
async function parseUploadForm(request: Request): Promise<FormData> {
	const body = request.body;
	if (!body) {
		throw new ValidationError('Upload body is missing');
	}

	const contentType = request.headers.get('content-type') ?? '';
	let totalBytes = 0;
	let isOverLimit = false;
	const bounded = body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				totalBytes += chunk.byteLength;
				if (totalBytes > MAX_UPLOAD_BODY_BYTES) {
					isOverLimit = true;
					controller.error(new Error('upload body exceeds the size limit'));
					return;
				}
				controller.enqueue(chunk);
			}
		})
	);

	try {
		return await new Response(bounded, {
			headers: { 'content-type': contentType }
		}).formData();
	} catch {
		// A stream error from the limiter is the size cap, not a malformed body; anything else is a
		// parse failure the caller fixes, so it is a 400 rather than a 500.
		if (isOverLimit) {
			throw new PayloadTooLargeError('Upload is too large');
		}
		throw new ValidationError('Upload body is not valid multipart form data');
	}
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}
	if (!platform?.env?.MEDIA_BUCKET || !platform?.env?.DB) {
		return Response.json({ error: 'R2 or DB binding unavailable' }, { status: 500 });
	}

	// Refuse a body whose declared length is already too large before reading anything. This is only
	// a cheap early exit: the length may be absent (HTTP/2, chunked) or understated, so the byte
	// count `parseUploadForm` enforces while streaming is what actually bounds the body.
	const declaredLength = request.headers.get('content-length');
	if (declaredLength !== null) {
		const declaredBytes = Number(declaredLength);
		if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPLOAD_BODY_BYTES) {
			return Response.json({ error: 'Upload is too large' }, { status: 413 });
		}
	}

	try {
		const formData = await parseUploadForm(request);
		const file = formData.get('file');
		const treeId = formData.get('treeId');
		const entityId = formData.get('entityId');
		const title = formData.get('title');

		// A text field named `file` is not a file; without this its `file.size` is `undefined` and
		// slips past the size cap below.
		const isMissingFields =
			!(file instanceof File) ||
			typeof treeId !== 'string' ||
			treeId === '' ||
			typeof entityId !== 'string' ||
			entityId === '';
		if (isMissingFields) {
			throw new ValidationError('file, treeId, and entityId are required');
		}

		assertUploadWithinSizeLimit(file.size);

		// Before a byte is stored: the caller must be allowed to add media to this record of this tree.
		const db = getDb(platform.env.DB);
		const service = new MediaService(db);
		await service.requireUpload(treeId, entityId, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		// The bytes decide the type; the declared type and filename are attacker-controlled and are
		// ignored. The extension comes from the sniffed type so it cannot disagree with the content.
		const bytes = new Uint8Array(await file.arrayBuffer());
		const { mimeType, extension } = validateMediaUpload(file.type, bytes);
		const objectKey = `media/${treeId}/${entityId}/${crypto.randomUUID()}.${extension}`;

		// Store in Cloudflare R2
		await platform.env.MEDIA_BUCKET.put(objectKey, bytes, {
			httpMetadata: {
				contentType: mimeType
			}
		});

		// Save metadata to D1
		const mediaId = crypto.randomUUID();
		const mediaTitle = typeof title === 'string' && title !== '' ? title : file.name;
		await service.record(treeId, entityId, {
			id: mediaId,
			objectKey,
			title: mediaTitle,
			mimeType
		});

		return Response.json(
			{
				success: true,
				media: {
					id: mediaId,
					objectKey,
					title: mediaTitle,
					mimeType
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		return errorResponse(err, 'Failed to upload media');
	}
};
