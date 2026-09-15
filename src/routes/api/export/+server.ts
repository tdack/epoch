import { json, type RequestHandler } from '@sveltejs/kit';
import { getTreeExportData } from '$lib/server/gedcom/importer';
import { buildGedcom551String } from '$lib/server/gedcom/index';

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const treeId = url.searchParams.get('treeId');
  if (!treeId) {
    return json({ error: 'treeId query parameter required' }, { status: 400 });
  }

  try {
    const data = await getTreeExportData(platform.env.DB, treeId);
    const gedcom = buildGedcom551String(data);

    return new Response(gedcom, {
      status: 200,
      headers: {
        'Content-Type': 'text/vnd.familysearch.gedcom; charset=utf-8',
        'Content-Disposition': `attachment; filename="${data.treeName.replace(/[^a-zA-Z0-9_-]/g, '_')}.ged"`
      }
    });
  } catch (err: any) {
    return json({ error: `Export failed: ${err.message}` }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const body = (await request.json().catch(() => ({}))) as { treeId?: string };
  const { treeId } = body;
  if (!treeId) {
    return json({ error: 'treeId is required' }, { status: 400 });
  }

  // Trigger Cloudflare Workflow if binding exists
  if (platform?.env?.GEDCOM_EXPORT_WORKFLOW) {
    const instance = await platform.env.GEDCOM_EXPORT_WORKFLOW.create({
      params: { treeId }
    });
    return json({ status: 'started', instanceId: instance.id });
  }

  // Fallback direct execution
  if (!platform?.env?.DB || !platform?.env?.MEDIA_BUCKET) {
    return json({ error: 'Storage or Database binding unavailable' }, { status: 500 });
  }

  const data = await getTreeExportData(platform.env.DB, treeId);
  const gedcom = buildGedcom551String(data);
  const fileKey = `exports/${treeId}-${Date.now()}.ged`;

  await platform.env.MEDIA_BUCKET.put(fileKey, gedcom, {
    httpMetadata: {
      contentType: 'text/vnd.familysearch.gedcom',
      contentDisposition: `attachment; filename="${treeId}.ged"`
    }
  });

  return json({ status: 'complete', fileKey });
};
