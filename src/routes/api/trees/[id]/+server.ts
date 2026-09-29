import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { errorResponse } from '#lib/server/http/error-response.js';

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
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const treeData = await service.getTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json(treeData);
  } catch (err) {
    return errorResponse(err, 'Failed to fetch tree details');
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
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    await service.deleteTree(treeId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ success: true });
  } catch (err) {
    return errorResponse(err, 'Failed to delete tree');
  }
};
