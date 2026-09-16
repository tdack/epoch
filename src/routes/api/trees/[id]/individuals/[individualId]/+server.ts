import type { RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { DomainError } from '#lib/server/domain/errors.js';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const individual = await service.getIndividual(treeId, individualId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ individual });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to get individual:', err);
    return Response.json({ error: err?.message || 'Failed to get individual' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    givenName?: string | null;
    surname?: string | null;
    sex?: 'M' | 'F' | 'U';
    birthDate?: string | null;
    birthPlace?: string | null;
    deathDate?: string | null;
    deathPlace?: string | null;
    version?: number;
  };

  const { givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace, version = 1 } = body;

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    const updated = await service.updateIndividual(
      treeId,
      individualId,
      version,
      {
        givenName,
        surname,
        sex,
        birthDate,
        birthPlace,
        deathDate,
        deathPlace
      },
      {
        user: locals.user,
        correlationId: locals.correlationId
      }
    );

    return Response.json({ success: true, individual: updated });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to update individual:', err);
    return Response.json({ error: err?.message || 'Failed to update individual' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return Response.json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return Response.json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    await service.deleteIndividual(treeId, individualId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return Response.json({ success: true });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to delete individual:', err);
    return Response.json({ error: err?.message || 'Failed to delete individual' }, { status: 500 });
  }
};
