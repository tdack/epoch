import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError } from '../domain/errors';
import { MAX_FORM_FIELDS_BYTES, parseBoundedFormData } from './bounded-form';

const FILE_CAP_BYTES = 1024;

function formRequest(form: FormData): Request {
	return new Request('http://localhost/upload', { method: 'POST', body: form });
}

describe('parseBoundedFormData', () => {
	it('accepts a file sent with more than 64 KB of other fields', async () => {
		const form = new FormData();
		form.set('file', new File(['x'.repeat(FILE_CAP_BYTES)], 'a.txt'));
		form.set('title', 'y'.repeat(200 * 1024));
		const parsed = await parseBoundedFormData(formRequest(form), FILE_CAP_BYTES);
		expect((parsed.get('title') as string).length).toBe(200 * 1024);
	});

	it('refuses fields beyond their own budget', async () => {
		const form = new FormData();
		form.set('file', new File(['x'], 'a.txt'));
		form.set('title', 'y'.repeat(MAX_FORM_FIELDS_BYTES + 1));
		await expect(parseBoundedFormData(formRequest(form), FILE_CAP_BYTES)).rejects.toBeInstanceOf(
			PayloadTooLargeError
		);
	});

	it('refuses a body far over the file cap while streaming', async () => {
		const form = new FormData();
		form.set('file', new File(['x'.repeat(3 * 1024 * 1024)], 'a.txt'));
		await expect(parseBoundedFormData(formRequest(form), FILE_CAP_BYTES)).rejects.toBeInstanceOf(
			PayloadTooLargeError
		);
	});
});
