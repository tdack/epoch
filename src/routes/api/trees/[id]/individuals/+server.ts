import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '$lib/server/db';
import { GenealogyService } from '$lib/server/services/genealogy-service';
import { DomainError } from '$lib/server/domain/errors';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
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

  const body = (await request.json().catch(() => ({}))) as {
    givenName?: string;
    surname?: string;
    sex?: 'M' | 'F' | 'U';
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
  };

  const { givenName, surname, sex = 'U', birthDate, birthPlace, deathDate, deathPlace } = body;
  if (!givenName?.trim() && !surname?.trim()) {
    return json({ error: 'Given name or surname is required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    const individual = await service.createIndividual(
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

    return json({ success: true, individual }, { status: 201 });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to create individual:', err);
    return json({ error: err?.message || 'Failed to create individual' }, { status: 500 });
  }
};
