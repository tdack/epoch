import type { RequestHandler } from '@sveltejs/kit';
import { getTreeExportData } from '#lib/server/gedcom/importer.js';
import { buildGedcomString, type GedcomFormat } from '#lib/server/gedcom/index.js';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { DomainError } from '#lib/server/domain/errors.js';

function resolveFormat(raw: string | null): GedcomFormat {
  return raw === 'gedcom7' ? 'gedcom7' : 'gedcom551';
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const treeId = url.searchParams.get('treeId');
  if (!treeId) {
    return Response.json({ error: 'treeId query parameter required' }, { status: 400 });
  }

  const format = resolveFormat(url.searchParams.get('format'));

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    // Verifies tree access
    await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    const data = await getTreeExportData(platform.env.DB, treeId);
    const gedcom = buildGedcomString(data, format);

    return new Response(gedcom, {
      status: 200,
      headers: {
        'Content-Type': 'text/vnd.familysearch.gedcom; charset=utf-8',
        'Content-Disposition': `attachment; filename="${data.treeName.replace(/[^a-zA-Z0-9_-]/g, '_')}.ged"`
      }
    });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: `Export failed: ${err.message}` }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { treeId?: string; format?: string };
  const { treeId } = body;
  if (!treeId) {
    return Response.json({ error: 'treeId is required' }, { status: 400 });
  }

  const format = resolveFormat(body.format ?? null);

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    // Trigger Cloudflare Workflow if binding exists
    if (platform?.env?.GEDCOM_EXPORT_WORKFLOW) {
      const instance = await platform.env.GEDCOM_EXPORT_WORKFLOW.create({
        params: { treeId, format }
      });
      return Response.json({ status: 'started', instanceId: instance.id });
    }

    // Fallback direct execution
    if (!platform?.env?.MEDIA_BUCKET) {
      return Response.json({ error: 'Storage binding unavailable' }, { status: 500 });
    }

    const data = await getTreeExportData(platform.env.DB, treeId);
    const gedcom = buildGedcomString(data, format);
    const fileKey = `exports/${treeId}-${Date.now()}.ged`;

    await platform.env.MEDIA_BUCKET.put(fileKey, gedcom, {
      httpMetadata: {
        contentType: 'text/vnd.familysearch.gedcom',
        contentDisposition: `attachment; filename="${treeId}.ged"`
      }
    });

    return Response.json({ status: 'complete', fileKey });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: `Export failed: ${err?.message || err}` }, { status: 500 });
  }
};
