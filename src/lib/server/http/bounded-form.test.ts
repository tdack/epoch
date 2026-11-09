import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError } from '../domain/errors';
import { MAX_FORM_FIELDS_BYTES, parseBoundedFormData } from './bounded-form';

const FILE_CAP_BYTES = 1024;

const CHUNK_BYTES = 64 * 1024;

/**
 * The form, encoded and streamed in chunks. Not `body: form`: undici's FormData stream keeps
 * enqueueing after the limiter cancels it, an unhandled rejection workerd's request bodies never raise.
 */
async function formRequest(form: FormData): Promise<Request> {
	const encoded = new Response(form);
	const bytes = new Uint8Array(await encoded.arrayBuffer());
	let offset = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= bytes.byteLength) return controller.close();
			controller.enqueue(bytes.subarray(offset, (offset += CHUNK_BYTES)));
		}
	});
	return new Request('http://localhost/upload', {
		method: 'POST',
		body,
		headers: { 'content-type': encoded.headers.get('content-type')! },
		// Node requires it for a streamed body; workerd's RequestInit does not know it.
		...{ duplex: 'half' }
	});
}

describe('parseBoundedFormData', () => {
	it('accepts a file sent with more than 64 KB of other fields', async () => {
		const form = new FormData();
		form.set('file', new File(['x'.repeat(FILE_CAP_BYTES)], 'a.txt'));
		form.set('title', 'y'.repeat(200 * 1024));
		const parsed = await parseBoundedFormData(await formRequest(form), FILE_CAP_BYTES);
		expect((parsed.get('title') as string).length).toBe(200 * 1024);
	});

	it('refuses fields beyond their own budget', async () => {
		const form = new FormData();
		form.set('file', new File(['x'], 'a.txt'));
		form.set('title', 'y'.repeat(MAX_FORM_FIELDS_BYTES + 1));
		await expect(
			parseBoundedFormData(await formRequest(form), FILE_CAP_BYTES)
		).rejects.toBeInstanceOf(PayloadTooLargeError);
	});

	it('refuses a body far over the file cap while streaming', async () => {
		const form = new FormData();
		form.set('file', new File(['x'.repeat(3 * 1024 * 1024)], 'a.txt'));
		await expect(
			parseBoundedFormData(await formRequest(form), FILE_CAP_BYTES)
		).rejects.toBeInstanceOf(PayloadTooLargeError);
	});
});
