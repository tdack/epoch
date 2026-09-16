import type { RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { DomainError } from '#lib/server/domain/errors.js';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId } = params;
  if (!treeId) {
    return Response.json({ error: 'Tree ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const treeData = await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json(treeData);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to fetch tree details:', err);
    return Response.json({ error: err?.message || 'Failed to fetch tree details' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId } = params;
  if (!treeId) return Response.json({ error: 'Tree ID required' }, { status: 400 });

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    await service.deleteTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ success: true });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to delete tree:', err);
    return Response.json({ error: err?.message || 'Failed to delete tree' }, { status: 500 });
  }
};
