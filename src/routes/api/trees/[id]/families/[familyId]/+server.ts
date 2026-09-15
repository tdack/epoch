import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, ensureDbSchema } from '$lib/server/db';
import { GenealogyService } from '$lib/server/services/genealogy-service';
import { DomainError } from '$lib/server/domain/errors';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);
    const family = await service.getFamily(treeId, familyId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json(family);
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to get family:', err);
    return json({ error: err?.message || 'Failed to get family' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    husbandId?: string | null;
    wifeId?: string | null;
    partner1Id?: string | null;
    partner2Id?: string | null;
    childrenIds?: string[];
    marriageDate?: string;
    marriagePlace?: string;
    divorceDate?: string;
    divorcePlace?: string;
    version?: number;
  };

  const partner1 = body.partner1Id !== undefined ? body.partner1Id : body.husbandId;
  const partner2 = body.partner2Id !== undefined ? body.partner2Id : body.wifeId;
  const { childrenIds, marriageDate, marriagePlace, divorceDate, divorcePlace, version } = body;

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    await service.updateFamily(
      treeId,
      familyId,
      version,
      {
        partner1Id: partner1,
        partner2Id: partner2,
        husbandId: partner1,
        wifeId: partner2,
        childrenIds,
        marriageDate,
        marriagePlace,
        divorceDate,
        divorcePlace
      },
      {
        user: locals.user,
        correlationId: locals.correlationId
      }
    );

    return json({ success: true });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to update family:', err);
    return json({ error: err?.message || 'Failed to update family' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    await service.deleteFamily(treeId, familyId, {
      user: locals.user,
      correlationId: locals.correlationId
    });

    return json({ success: true });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to delete family:', err);
    return json({ error: err?.message || 'Failed to delete family' }, { status: 500 });
  }
};
