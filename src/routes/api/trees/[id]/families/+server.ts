import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, families, familyChildren, events, ensureDbSchema } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, request, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId } = params;
  if (!treeId) {
    return json({ error: 'Tree ID required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    husbandId?: string | null;
    wifeId?: string | null;
    childrenIds?: string[];
    marriageDate?: string;
    marriagePlace?: string;
  };

  const { husbandId, wifeId, childrenIds = [], marriageDate, marriagePlace } = body;

  if (!husbandId && !wifeId && childrenIds.length === 0) {
    return json({ error: 'A family requires at least one spouse or child' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);

    // Guard against duplicate families: if a family already exists with the
    // exact same parents, add children to it instead of creating a duplicate.
    const existingFamilies = await db
      .select()
      .from(families)
      .where(eq(families.treeId, treeId))
      .all();
    const duplicate = existingFamilies.find(
      (f) => (f.husbandId || null) === (husbandId || null) && (f.wifeId || null) === (wifeId || null)
    );

    if (duplicate) {
      const existingChildRows = await db
        .select()
        .from(familyChildren)
        .where(eq(familyChildren.familyId, duplicate.id))
        .all();
      const existingChildIds = new Set(existingChildRows.map((c) => c.childId));
      for (const childId of childrenIds) {
        if (childId?.trim() && !existingChildIds.has(childId.trim())) {
          await db.insert(familyChildren).values({
            familyId: duplicate.id,
            childId: childId.trim(),
            pedigree: 'birth'
          });
        }
      }

      if ((marriageDate?.trim() || marriagePlace?.trim()) && !existingChildRows.length) {
        const hasMarr = await db.select().from(events).where(and(
          eq(events.treeId, treeId),
          eq(events.entityType, 'FAMILY'),
          eq(events.entityId, duplicate.id),
          eq(events.type, 'MARR')
        )).get();
        if (!hasMarr) {
          await db.insert(events).values({
            id: crypto.randomUUID(),
            treeId,
            entityType: 'FAMILY',
            entityId: duplicate.id,
            type: 'MARR',
            dateRaw: marriageDate?.trim() || null,
            dateSort: marriageDate?.trim() || null,
            place: marriagePlace?.trim() || null,
            description: null
          });
        }
      }

      return json({ success: true, family: duplicate, merged: true }, { status: 200 });
    }

    const familyId = `@F_${crypto.randomUUID().slice(0, 8)}@`;
    const newFamily = {
      id: familyId,
      treeId,
      husbandId: husbandId || null,
      wifeId: wifeId || null
    };

    await db.insert(families).values(newFamily);

    // Add children links
    if (childrenIds && childrenIds.length > 0) {
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

    // Optional marriage event
    if (marriageDate?.trim() || marriagePlace?.trim()) {
      await db.insert(events).values({
        id: crypto.randomUUID(),
        treeId,
        entityType: 'FAMILY',
        entityId: familyId,
        type: 'MARR',
        dateRaw: marriageDate?.trim() || null,
        dateSort: marriageDate?.trim() || null,
        place: marriagePlace?.trim() || null,
        description: null
      });
    }

    return json({ success: true, family: newFamily }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create family:', err);
    return json({ error: err?.message || 'Failed to create family' }, { status: 500 });
  }
};
