import { PayloadTooLargeError, ValidationError } from '../domain/errors';

/** Multipart framing around a file (boundaries, headers) costs a little over the file itself. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

/**
 * Parse a multipart form while counting the bytes as they arrive, so an oversized body is aborted
 * mid-stream rather than buffered whole. This is the authoritative size control: it does not trust
 * `Content-Length`, which a client may omit (HTTP/2, chunked) or understate to slip a large body
 * into the isolate before rejection. `maxFileBytes` is the file's cap; the body may carry that plus
 * the framing around it.
 *
 * @throws PayloadTooLargeError when the body exceeds the cap, declared or streamed.
 * @throws ValidationError when the body is missing or is not valid multipart form data.
 */
export async function parseBoundedFormData(
	request: Request,
	maxFileBytes: number
): Promise<FormData> {
	const maxBodyBytes = maxFileBytes + MULTIPART_SLACK_BYTES;

	// A cheap early exit. The length may be absent or understated, so the count below still decides.
	const declaredLength = request.headers.get('content-length');
	if (declaredLength !== null) {
		const declaredBytes = Number(declaredLength);
		if (Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes) {
			throw new PayloadTooLargeError('Upload is too large');
		}
	}

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
				if (totalBytes > maxBodyBytes) {
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
