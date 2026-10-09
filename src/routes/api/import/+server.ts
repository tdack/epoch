import { decodeGedcomFile } from '#lib/server/gedcom/decode.js';
import { apiHandler } from '#lib/server/http/handler.js';
import { GedcomService } from '#lib/server/services/gedcom-service.js';

const importFailure = {
	failure: 'Failed to import GEDCOM',
	messagePrefix: 'Failed to import GEDCOM: '
};
/** The file's text, whatever version, character set or GEDZip archive it came as. */
async function readGedcom(file: File): Promise<string> {
	return decodeGedcomFile(new Uint8Array(await file.arrayBuffer()));
}

const previewFailure = {
	failure: 'Failed to preview GEDCOM',
	messagePrefix: 'Failed to preview GEDCOM: '
};

export const POST = apiHandler(importFailure, async ({ db, ctx, event }) => {
	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return Response.json({ error: 'GEDCOM file is required' }, { status: 400 });

	const text = await readGedcom(file);
	const env = event.platform?.env;
	const outcome = await new GedcomService(db, {
		bucket: env?.MEDIA_BUCKET,
		queue: env?.GEDCOM_IMPORT_QUEUE
	}).importFile(
		{
			treeId: formData.get('treeId') as string | null,
			treeName: formData.get('treeName') as string | null,
			fileName: file.name,
			text,
			// A .gdz is compressed, so its file size understates the import; the text decides the queue.
			sizeBytes: Math.max(file.size, text.length),
			mode: (formData.get('mode') as string | null) === 'merge' ? 'merge' : 'replace',
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
	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const treeId = formData.get('treeId') as string | null;
	if (!file) return Response.json({ error: 'GEDCOM file is required' }, { status: 400 });

	const service = new GedcomService(db);
	const text = await readGedcom(file);
	// No tree yet: the import will create one, so there is nothing to compare against.
	if (!treeId) return service.previewFile(text);
	return service.previewImport(treeId, text, ctx);
});
