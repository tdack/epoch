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
    husbandId?: string | null;
    wifeId?: string | null;
    partner1Id?: string | null;
    partner2Id?: string | null;
    childrenIds?: string[];
    marriageDate?: string;
    marriagePlace?: string;
  };

  const partner1 = body.partner1Id !== undefined ? body.partner1Id : body.husbandId;
  const partner2 = body.partner2Id !== undefined ? body.partner2Id : body.wifeId;
  const { childrenIds = [], marriageDate, marriagePlace } = body;

  if (!partner1 && !partner2 && childrenIds.length === 0) {
    return json({ error: 'A family requires at least one spouse or child' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const service = new GenealogyService(db);

    const result = await service.createFamily(
      treeId,
      {
        partner1Id: partner1,
        partner2Id: partner2,
        husbandId: partner1,
        wifeId: partner2,
        childrenIds,
        marriageDate,
        marriagePlace
      },
      {
        user: locals.user,
        correlationId: locals.correlationId
      }
    );

    return json({ success: true, family: result.family, merged: result.merged }, { status: result.merged ? 200 : 201 });
  } catch (err: any) {
    if (err instanceof DomainError) {
      return json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('Failed to create family:', err);
    return json({ error: err?.message || 'Failed to create family' }, { status: 500 });
  }
};
