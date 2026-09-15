import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '$lib/server/db';
import { GenealogyService } from '$lib/server/services/genealogy-service';
import { DomainError } from '$lib/server/domain/errors';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId } = params;
  if (!treeId) {
    return json({ error: 'Tree ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const treeData = await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json(treeData);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to fetch tree details:', err);
    return json({ error: err?.message || 'Failed to fetch tree details' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId } = params;
  if (!treeId) return json({ error: 'Tree ID required' }, { status: 400 });

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    await service.deleteTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json({ success: true });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to delete tree:', err);
    return json({ error: err?.message || 'Failed to delete tree' }, { status: 500 });
  }
};
