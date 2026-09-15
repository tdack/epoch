import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, individuals, events, families, familyChildren, ensureDbSchema } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    const individual = await db
      .select()
      .from(individuals)
      .where(and(eq(individuals.id, individualId), eq(individuals.treeId, treeId)))
      .get();

    if (!individual) {
      return json({ error: 'Individual not found' }, { status: 404 });
    }

    const individualEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.entityId, individualId), eq(events.treeId, treeId)))
      .all();

    return json({
      individual: {
        ...individual,
        events: individualEvents
      }
    });
  } catch (err: any) {
    console.error('Failed to get individual:', err);
    return json({ error: err?.message || 'Failed to get individual' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    givenName?: string | null;
    surname?: string | null;
    sex?: 'M' | 'F' | 'U';
    birthDate?: string | null;
    birthPlace?: string | null;
    deathDate?: string | null;
    deathPlace?: string | null;
  };

  const { givenName, surname, sex, birthDate, birthPlace, deathDate, deathPlace } = body;

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    const existing = await db
      .select()
      .from(individuals)
      .where(and(eq(individuals.id, individualId), eq(individuals.treeId, treeId)))
      .get();

    if (!existing) {
      return json({ error: 'Individual not found' }, { status: 404 });
    }

    // 1. Update individual fields
    const updatedFields: {
      givenName?: string | null;
      surname?: string | null;
      sex?: 'M' | 'F' | 'U';
    } = {};

    if (givenName !== undefined) updatedFields.givenName = givenName?.trim() || null;
    if (surname !== undefined) updatedFields.surname = surname?.trim() || null;
    if (sex !== undefined) updatedFields.sex = sex || 'U';

    if (Object.keys(updatedFields).length > 0) {
      await db
        .update(individuals)
        .set(updatedFields)
        .where(and(eq(individuals.id, individualId), eq(individuals.treeId, treeId)));
    }

    // 2. Helper to upsert or delete an event
    const handleEvent = async (
      type: 'BIRT' | 'DEAT',
      dateVal: string | null | undefined,
      placeVal: string | null | undefined
    ) => {
      // If neither date nor place is provided at all in body, leave unchanged
      if (dateVal === undefined && placeVal === undefined) return;

      const trimmedDate = dateVal?.trim() || null;
      const trimmedPlace = placeVal?.trim() || null;

      const existingEvent = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.treeId, treeId),
            eq(events.entityType, 'INDIVIDUAL'),
            eq(events.entityId, individualId),
            eq(events.type, type)
          )
        )
        .get();

      if (trimmedDate || trimmedPlace) {
        if (existingEvent) {
          await db
            .update(events)
            .set({
              dateRaw: trimmedDate,
              dateSort: trimmedDate,
              place: trimmedPlace
            })
            .where(eq(events.id, existingEvent.id));
        } else {
          await db.insert(events).values({
            id: crypto.randomUUID(),
            treeId,
            entityType: 'INDIVIDUAL',
            entityId: individualId,
            type,
            dateRaw: trimmedDate,
            dateSort: trimmedDate,
            place: trimmedPlace,
            description: null
          });
        }
      } else if (existingEvent) {
        // Cleared both fields
        await db.delete(events).where(eq(events.id, existingEvent.id));
      }
    };

    await handleEvent('BIRT', birthDate, birthPlace);
    await handleEvent('DEAT', deathDate, deathPlace);

    return json({ success: true });
  } catch (err: any) {
    console.error('Failed to update individual:', err);
    return json({ error: err?.message || 'Failed to update individual' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, individualId } = params;
  if (!treeId || !individualId) {
    return json({ error: 'Tree ID and Individual ID required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    // Delete events belonging to individual
    await db
      .delete(events)
      .where(
        and(
          eq(events.treeId, treeId),
          eq(events.entityType, 'INDIVIDUAL'),
          eq(events.entityId, individualId)
        )
      );

    // Remove from familyChildren junction
    await db.delete(familyChildren).where(eq(familyChildren.childId, individualId));

    // Clear husband/wife links in families where they were a spouse
    await db
      .update(families)
      .set({ husbandId: null })
      .where(and(eq(families.treeId, treeId), eq(families.husbandId, individualId)));

    await db
      .update(families)
      .set({ wifeId: null })
      .where(and(eq(families.treeId, treeId), eq(families.wifeId, individualId)));

    // Delete the individual
    await db
      .delete(individuals)
      .where(and(eq(individuals.id, individualId), eq(individuals.treeId, treeId)));

    return json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete individual:', err);
    return json({ error: err?.message || 'Failed to delete individual' }, { status: 500 });
  }
};
