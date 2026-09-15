import { json, type RequestHandler } from '@sveltejs/kit';
import { importGedcomToDb, previewGedcomImport, type ImportMode } from '$lib/server/gedcom/importer';
import { getDb, ensureDbSchema } from '$lib/server/db';
import { GenealogyService } from '$lib/server/services/genealogy-service';
import { DomainError } from '$lib/server/domain/errors';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const treeName = formData.get('treeName') as string | null;
  let treeId = formData.get('treeId') as string | null;
  const mode = (formData.get('mode') as string | null) === 'merge' ? 'merge' : 'replace';

  if (!file) {
    return json({ error: 'GEDCOM file is required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    // If importing into existing tree, verify 'gedcom:import' permission
    if (treeId) {
      await service.getTree(treeId, {
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
    if (fileSize > 2 * 1024 * 1024 && platform.env.GEDCOM_IMPORT_QUEUE && platform.env.MEDIA_BUCKET) {
      const stagingKey = `staging/gedcom-${treeId}-${Date.now()}.ged`;
      await platform.env.MEDIA_BUCKET.put(stagingKey, fileText);
      await platform.env.GEDCOM_IMPORT_QUEUE.send({
        treeId,
        r2ObjectKey: stagingKey,
        treeName: treeName || file.name.replace(/\.ged$/i, ''),
        mode
      });

      return json({
        status: 'queued',
        message: 'Large GEDCOM file queued for asynchronous background processing',
        treeId
      }, { status: 202 });
    }

    // Synchronous import for normal sized files
    const result = await importGedcomToDb(
      platform.env.DB,
      treeId,
      fileText,
      treeName || file.name.replace(/\.ged$/i, ''),
      mode
    );

    return json({
      status: 'complete',
      treeId,
      ...result
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Import error:', err);
    return json({ error: `Failed to import GEDCOM: ${err.message}` }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const treeId = formData.get('treeId') as string | null;

  if (!file || !treeId) {
    return json({ error: 'GEDCOM file and treeId are required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    // Verify tree view permission
    await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    const preview = await previewGedcomImport(platform.env.DB, treeId, await file.text());
    return json(preview);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Preview error:', err);
    return json({ error: `Failed to preview GEDCOM: ${err.message}` }, { status: 500 });
  }
};
