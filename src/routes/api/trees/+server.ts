import type { RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { DomainError } from '#lib/server/domain/errors.js';
import { treeCreateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const userTrees = await service.listTrees({
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ trees: userTrees });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to fetch trees:', err);
    return Response.json({ error: err?.message || 'Failed to fetch trees' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    const body = parseBody(treeCreateSchema, await request.json().catch(() => ({})));
    const { name, description } = body;

    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const newTree = await service.createTree(name, description ?? null, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ tree: newTree }, { status: 201 });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to create tree:', err);
    return Response.json({ error: err?.message || 'Failed to create tree' }, { status: 500 });
  }
};
