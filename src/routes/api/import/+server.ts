import type { RequestEvent } from '@sveltejs/kit';
import { decodeGedcomFile } from '#lib/server/gedcom/decode.js';
import { MAX_DATASET_BYTES, MAX_IMPORT_BYTES } from '#lib/server/gedcom/limits.js';
import { PayloadTooLargeError, ValidationError } from '#lib/server/domain/errors.js';
import { parseBoundedFormData } from '#lib/server/http/bounded-form.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { GedcomService } from '#lib/server/services/gedcom-service.js';

const importFailure = {
	failure: 'Failed to import GEDCOM'
};
/**
 * The file's text, whatever version, character set or GEDZip archive it came as. The size is refused
 * before the file is read, and the dataset is refused before it is returned: a small archive can
 * expand far past the upload cap.
 */
async function readGedcom(file: File): Promise<string> {
	if (file.size > MAX_IMPORT_BYTES) {
		throw new PayloadTooLargeError(`Import file exceeds the ${MAX_IMPORT_BYTES} byte limit`);
	}
	const text = decodeGedcomFile(new Uint8Array(await file.arrayBuffer()));
	// Every decoder yields at most one UTF-16 unit per input byte, so this bounds the dataset's bytes.
	if (text.length > MAX_DATASET_BYTES) {
		throw new PayloadTooLargeError(`The dataset exceeds the ${MAX_DATASET_BYTES} byte limit`);
	}
	return text;
}

/** One budget for the preview and the import: both parse a whole file, and a client does one then the other. */
function limitImports(event: RequestEvent, userId: string): Promise<void> {
	return enforceRateLimit({
		binding: event.platform?.env?.IMPORT_RATE_LIMIT,
		bindingName: 'IMPORT_RATE_LIMIT',
		key: userId,
		message: 'Too many imports; try again in a minute'
	});
}

/** A text field of the form, or null when absent. A file in its place is a 400, not a cast. */
function formText(formData: FormData, name: string): string | null {
	const value = formData.get(name);
	if (value === null || typeof value === 'string') return value;
	throw new ValidationError(`${name} must be text`);
}

const previewFailure = {
	failure: 'Failed to preview GEDCOM'
};

export const POST = apiHandler(importFailure, async ({ db, ctx, event }) => {
	await limitImports(event, ctx.user.id);
	const formData = await parseBoundedFormData(event.request, MAX_IMPORT_BYTES);
	const file = formData.get('file');
	if (!file) throw new ValidationError('GEDCOM file is required');
	if (!(file instanceof File)) throw new ValidationError('GEDCOM file must be a file upload');

	const text = await readGedcom(file);
	const env = event.platform?.env;
	const outcome = await new GedcomService(db, {
		bucket: env?.MEDIA_BUCKET,
		queue: env?.GEDCOM_IMPORT_QUEUE
	}).importFile(
		{
			treeId: formText(formData, 'treeId'),
			treeName: formText(formData, 'treeName'),
			fileName: file.name,
			text,
			// A .gdz is compressed, so its file size understates the import; the text decides the queue.
			sizeBytes: Math.max(file.size, text.length),
			mode: formText(formData, 'mode') === 'merge' ? 'merge' : 'replace',
			shouldMergeDuplicateFamilies: formData.get('mergeDuplicates') === 'true'
		},
		ctx
	);
	if (outcome.status === 'queued') {
		return Response.json(
			{
				...outcome,
				message: 'Large GEDCOM file queued for asynchronous background processing'
			},
			{ status: 202 }
		);
	}
	return outcome;
});

export const PUT = apiHandler(previewFailure, async ({ db, ctx, event }) => {
	await limitImports(event, ctx.user.id);
	const formData = await parseBoundedFormData(event.request, MAX_IMPORT_BYTES);
	const file = formData.get('file');
	const treeId = formText(formData, 'treeId');
	if (!file) throw new ValidationError('GEDCOM file is required');
	if (!(file instanceof File)) throw new ValidationError('GEDCOM file must be a file upload');

	const service = new GedcomService(db);
	const text = await readGedcom(file);
	// No tree yet: the import will create one, so there is nothing to compare against.
	if (!treeId) return service.previewFile(text);
	return service.previewImport(treeId, text, ctx);
});
