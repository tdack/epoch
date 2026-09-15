import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '$lib/server/db';
import { GenealogyService } from '$lib/server/services/genealogy-service';
import { DomainError } from '$lib/server/domain/errors';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const userTrees = await service.listTrees({
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json({ trees: userTrees });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to fetch trees:', err);
    return json({ error: err?.message || 'Failed to fetch trees' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
  const { name, description } = body;

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const newTree = await service.createTree(name || '', description || null, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json({ tree: newTree }, { status: 201 });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to create tree:', err);
    return json({ error: err?.message || 'Failed to create tree' }, { status: 500 });
  }
};
