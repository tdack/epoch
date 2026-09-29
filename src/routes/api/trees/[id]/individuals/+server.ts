import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { GenealogyService } from '#lib/server/services/genealogy-service.js';
import { DomainError } from '#lib/server/domain/errors.js';
import { individualCreateSchema } from '#lib/server/validation/schemas.js';
import { parseBody } from '#lib/server/validation/index.js';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
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
    const body = parseBody(individualCreateSchema, await request.json().catch(() => ({})));
    const { givenName, surname, sex = 'U', birthDate, birthPlace, deathDate, deathPlace } = body;
    if (!givenName?.trim() && !surname?.trim()) {
      return Response.json({ error: 'Given name or surname is required' }, { status: 400 });
    }

    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    const { individual, change } = await service.createIndividual(
      treeId,
      {
        givenName: givenName?.trim() || null,
        surname: surname?.trim() || null,
        sex: (sex as 'M' | 'F' | 'U') || 'U',
        birthDate: birthDate?.trim() || null,
        birthPlace: birthPlace?.trim() || null,
        deathDate: deathDate?.trim() || null,
        deathPlace: deathPlace?.trim() || null
      },
      {
        user: locals.user,
        correlationId: locals.correlationId
      }
    );

    return Response.json({ success: true, individual, change }, { status: 201 });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to create individual:', err);
    return Response.json({ error: err?.message || 'Failed to create individual' }, { status: 500 });
  }
};
