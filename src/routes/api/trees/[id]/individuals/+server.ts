import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, individuals, events, ensureDbSchema } from '$lib/server/db';

export const POST: RequestHandler = async ({ params, request, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId } = params;
  if (!treeId) {
    return json({ error: 'Tree ID required' }, { status: 400 });
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

    const individualId = `@I_${crypto.randomUUID().slice(0, 8)}@`;
    const newIndividual = {
      id: individualId,
      treeId,
      givenName: givenName?.trim() || null,
      surname: surname?.trim() || null,
      sex: sex || 'U',
      createdAt: new Date()
    };

    await db.insert(individuals).values(newIndividual);

    // Optional birth event
    if (birthDate?.trim() || birthPlace?.trim()) {
      await db.insert(events).values({
        id: crypto.randomUUID(),
        treeId,
        entityType: 'INDIVIDUAL',
        entityId: individualId,
        type: 'BIRT',
        dateRaw: birthDate?.trim() || null,
        dateSort: birthDate?.trim() || null,
        place: birthPlace?.trim() || null,
        description: null
      });
    }

    // Optional death event
    if (deathDate?.trim() || deathPlace?.trim()) {
      await db.insert(events).values({
        id: crypto.randomUUID(),
        treeId,
        entityType: 'INDIVIDUAL',
        entityId: individualId,
        type: 'DEAT',
        dateRaw: deathDate?.trim() || null,
        dateSort: deathDate?.trim() || null,
        place: deathPlace?.trim() || null,
        description: null
      });
    }

    return json({ success: true, individual: newIndividual }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create individual:', err);
    return json({ error: err?.message || 'Failed to create individual' }, { status: 500 });
  }
};
