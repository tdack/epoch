import type { RequestHandler } from '@sveltejs/kit';
import {
	importGedcomToDb,
	previewGedcomFile,
	previewGedcomImport,
	type ImportMode
} from '#lib/server/gedcom/importer.js';
import { getDb } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const treeName = formData.get('treeName') as string | null;
	let treeId = formData.get('treeId') as string | null;
	const mode = (formData.get('mode') as string | null) === 'merge' ? 'merge' : 'replace';
	const shouldMergeDuplicateFamilies = formData.get('mergeDuplicates') === 'true';

	if (!file) {
		return Response.json({ error: 'GEDCOM file is required' }, { status: 400 });
	}

	try {
		const db = getDb(platform.env.DB);
		const service = new GenealogyService(db);

		if (treeId) {
			await service.requireImport(treeId, {
				user: locals.user,
				correlationId: locals.correlationId
			});
		} else {
			// Creating a new tree for import
			const newTree = await service.createTree(
				treeName || file.name.replace(/\.ged$/i, '') || 'Imported Tree',
				null,
				{
					user: locals.user,
					correlationId: locals.correlationId
				}
			);
			treeId = newTree.id;
		}

		const fileText = await file.text();

		// If file is very large (> 2MB) and Queue is available, stage to R2 and enqueue
		const fileSize = file.size;
		if (
			fileSize > 2 * 1024 * 1024 &&
			platform.env.GEDCOM_IMPORT_QUEUE &&
			platform.env.MEDIA_BUCKET
		) {
			const stagingKey = `staging/gedcom-${treeId}-${Date.now()}.ged`;
			await platform.env.MEDIA_BUCKET.put(stagingKey, fileText);
			await platform.env.GEDCOM_IMPORT_QUEUE.send({
				treeId,
				r2ObjectKey: stagingKey,
				treeName: treeName || file.name.replace(/\.ged$/i, ''),
				mode,
				shouldMergeDuplicateFamilies
			});

			return Response.json(
				{
					status: 'queued',
					message: 'Large GEDCOM file queued for asynchronous background processing',
					treeId
				},
				{ status: 202 }
			);
		}

		// Synchronous import for normal sized files
		const result = await importGedcomToDb(
			platform.env.DB,
			treeId,
			fileText,
			treeName || file.name.replace(/\.ged$/i, ''),
			mode,
			{ shouldMergeDuplicateFamilies }
		);

		return Response.json({
			status: 'complete',
			treeId,
			...result
		});
	} catch (err) {
		return errorResponse(err, 'Failed to import GEDCOM', {
			messagePrefix: 'Failed to import GEDCOM: '
		});
	}
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}

	if (!platform?.env?.DB) {
		return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const treeId = formData.get('treeId') as string | null;

	if (!file) {
		return Response.json({ error: 'GEDCOM file is required' }, { status: 400 });
	}

	// No tree yet: the import will create one, so there is nothing to compare against.
	if (!treeId) {
		try {
			return Response.json(previewGedcomFile(await file.text()));
		} catch (err) {
			return errorResponse(err, 'Failed to preview GEDCOM', {
				messagePrefix: 'Failed to preview GEDCOM: '
			});
		}
	}

	try {
		const db = getDb(platform.env.DB);
		const service = new GenealogyService(db);
		// The preview reads the tree's rows to compare against, so it needs the same right as the import.
		await service.requireImport(treeId, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		const preview = await previewGedcomImport(platform.env.DB, treeId, await file.text());
		return Response.json(preview);
	} catch (err) {
		return errorResponse(err, 'Failed to preview GEDCOM', {
			messagePrefix: 'Failed to preview GEDCOM: '
		});
	}
};
