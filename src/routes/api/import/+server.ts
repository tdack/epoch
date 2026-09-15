import { json, type RequestHandler } from '@sveltejs/kit';
import { importGedcomToDb, previewGedcomImport, type ImportMode } from '$lib/server/gedcom/importer';

export const POST: RequestHandler = async ({ request, platform }) => {
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

  if (!treeId) {
    treeId = crypto.randomUUID();
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
  try {
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
    console.error('Import error:', err);
    return json({ error: `Failed to import GEDCOM: ${err.message}` }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request, platform }) => {
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
    const preview = await previewGedcomImport(platform.env.DB, treeId, await file.text());
    return json(preview);
  } catch (err: any) {
    console.error('Preview error:', err);
    return json({ error: `Failed to preview GEDCOM: ${err.message}` }, { status: 500 });
  }
};
