import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, families, familyChildren, events, ensureDbSchema } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    const family = await db.select().from(families).where(and(eq(families.id, familyId), eq(families.treeId, treeId))).get();
    if (!family) {
      return json({ error: 'Family not found' }, { status: 404 });
    }

    const [children, familyEvents] = await Promise.all([
      db.select().from(familyChildren).where(eq(familyChildren.familyId, familyId)).all(),
      db.select().from(events).where(and(eq(events.entityId, familyId), eq(events.treeId, treeId))).all()
    ]);

    return json({
      family: {
        ...family,
        children,
        events: familyEvents
      }
    });
  } catch (err: any) {
    console.error('Failed to get family:', err);
    return json({ error: err?.message || 'Failed to get family' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    husbandId?: string | null;
    wifeId?: string | null;
    childrenIds?: string[];
    marriageDate?: string;
    marriagePlace?: string;
    divorceDate?: string;
    divorcePlace?: string;
  };

  const { husbandId, wifeId, childrenIds, marriageDate, marriagePlace, divorceDate, divorcePlace } = body;

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    const existingFamily = await db.select().from(families).where(and(eq(families.id, familyId), eq(families.treeId, treeId))).get();
    if (!existingFamily) {
      return json({ error: 'Family not found' }, { status: 404 });
    }

    // 1. Update spouses
    await db.update(families)
      .set({
        husbandId: husbandId === undefined ? existingFamily.husbandId : (husbandId || null),
        wifeId: wifeId === undefined ? existingFamily.wifeId : (wifeId || null)
      })
      .where(and(eq(families.id, familyId), eq(families.treeId, treeId)));

    // 2. Update children if childrenIds is explicitly passed
    if (Array.isArray(childrenIds)) {
      await db.delete(familyChildren).where(eq(familyChildren.familyId, familyId));
      for (const childId of childrenIds) {
        if (childId?.trim()) {
          await db.insert(familyChildren).values({
            familyId,
            childId: childId.trim(),
            pedigree: 'birth'
          });
        }
      }
    }

    // 3. Update or remove marriage event
    const trimmedDate = marriageDate?.trim() || null;
    const trimmedPlace = marriagePlace?.trim() || null;

    if (trimmedDate || trimmedPlace) {
      const existingMarr = await db.select().from(events).where(and(
        eq(events.treeId, treeId),
        eq(events.entityType, 'FAMILY'),
        eq(events.entityId, familyId),
        eq(events.type, 'MARR')
      )).get();

      if (existingMarr) {
        await db.update(events)
          .set({
            dateRaw: trimmedDate,
            dateSort: trimmedDate,
            place: trimmedPlace
          })
          .where(eq(events.id, existingMarr.id));
      } else {
        await db.insert(events).values({
          id: crypto.randomUUID(),
          treeId,
          entityType: 'FAMILY',
          entityId: familyId,
          type: 'MARR',
          dateRaw: trimmedDate,
          dateSort: trimmedDate,
          place: trimmedPlace,
          description: null
        });
      }
    } else if (marriageDate !== undefined || marriagePlace !== undefined) {
      // Clear existing marriage event if empty string explicitly provided
      await db.delete(events).where(and(
        eq(events.treeId, treeId),
        eq(events.entityType, 'FAMILY'),
        eq(events.entityId, familyId),
        eq(events.type, 'MARR')
      ));
    }

    // 4. Update or remove divorce event
    const trimmedDivDate = divorceDate?.trim() || null;
    const trimmedDivPlace = divorcePlace?.trim() || null;

    if (trimmedDivDate || trimmedDivPlace) {
      const existingDiv = await db.select().from(events).where(and(
        eq(events.treeId, treeId),
        eq(events.entityType, 'FAMILY'),
        eq(events.entityId, familyId),
        eq(events.type, 'DIV')
      )).get();

      if (existingDiv) {
        await db.update(events)
          .set({
            dateRaw: trimmedDivDate,
            dateSort: trimmedDivDate,
            place: trimmedDivPlace
          })
          .where(eq(events.id, existingDiv.id));
      } else {
        await db.insert(events).values({
          id: crypto.randomUUID(),
          treeId,
          entityType: 'FAMILY',
          entityId: familyId,
          type: 'DIV',
          dateRaw: trimmedDivDate,
          dateSort: trimmedDivDate,
          place: trimmedDivPlace,
          description: null
        });
      }
    } else if (divorceDate !== undefined || divorcePlace !== undefined) {
      await db.delete(events).where(and(
        eq(events.treeId, treeId),
        eq(events.entityType, 'FAMILY'),
        eq(events.entityId, familyId),
        eq(events.type, 'DIV')
      ));
    }

    return json({ success: true });
  } catch (err: any) {
    console.error('Failed to update family:', err);
    return json({ error: err?.message || 'Failed to update family' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId, familyId } = params;
  if (!treeId || !familyId) {
    return json({ error: 'Tree ID and Family ID required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    await db.delete(familyChildren).where(eq(familyChildren.familyId, familyId));
    await db.delete(events).where(and(eq(events.treeId, treeId), eq(events.entityId, familyId)));
    await db.delete(families).where(and(eq(families.id, familyId), eq(families.treeId, treeId)));

    return json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete family:', err);
    return json({ error: err?.message || 'Failed to delete family' }, { status: 500 });
  }
};
