import { PayloadTooLargeError, ValidationError } from '../domain/errors';

/** Multipart framing around the parts (boundaries, headers) costs a little over their content. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

/**
 * Budget for every non-file field together. It is its own cap, not borrowed from the file's slack,
 * so a legitimate file with many or long fields is not refused, yet the body stays strictly
 * bounded at file + fields + framing.
 */
export const MAX_FORM_FIELDS_BYTES = 1024 * 1024;

/**
 * Parse a multipart form while counting the bytes as they arrive, so an oversized body is aborted
 * mid-stream rather than buffered whole. This is the authoritative size control: it does not trust
 * `Content-Length`, which a client may omit (HTTP/2, chunked) or understate to slip a large body
 * into the isolate before rejection. `maxFileBytes` is the file's cap; the body may carry that plus
 * `MAX_FORM_FIELDS_BYTES` of other fields and the framing around them. Fields are re-checked against
 * their own budget once parsed, since the stream cannot tell a file's bytes from a field's.
 *
 * @throws PayloadTooLargeError when the body exceeds the cap, declared or streamed.
 * @throws ValidationError when the body is missing or is not valid multipart form data.
 */
export async function parseBoundedFormData(
	request: Request,
	maxFileBytes: number
): Promise<FormData> {
	const maxBodyBytes = maxFileBytes + MAX_FORM_FIELDS_BYTES + MULTIPART_SLACK_BYTES;

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

	let formData: FormData;
	try {
		formData = await new Response(bounded, {
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

	const encoder = new TextEncoder();
	let fieldBytes = 0;
	for (const [name, value] of formData.entries()) {
		if (typeof value === 'string') {
			fieldBytes += encoder.encode(name).byteLength + encoder.encode(value).byteLength;
		}
	}
	if (fieldBytes > MAX_FORM_FIELDS_BYTES) {
		throw new PayloadTooLargeError('Upload form fields are too large');
	}
	return formData;
}
