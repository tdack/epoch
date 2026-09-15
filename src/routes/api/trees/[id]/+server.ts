import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, trees, individuals, families, familyChildren, events, mediaItems, ensureDbSchema } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId } = params;
  if (!treeId) {
    return json({ error: 'Tree ID required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const tree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
    if (!tree) {
      return json({ error: 'Tree not found' }, { status: 404 });
    }

    // Single-trip multi-entity queries avoiding N+1 selects
    const [indList, famList, childrenList, eventList, mediaList] = await Promise.all([
      db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
      db.select().from(families).where(eq(families.treeId, treeId)).all(),
      db.select().from(familyChildren).all(),
      db.select().from(events).where(eq(events.treeId, treeId)).all(),
      db.select().from(mediaItems).where(eq(mediaItems.treeId, treeId)).all()
    ]);

    // Aggregate events by entity
    const eventsByEntity: Record<string, typeof eventList> = {};
    for (const ev of eventList) {
      if (!eventsByEntity[ev.entityId]) eventsByEntity[ev.entityId] = [];
      eventsByEntity[ev.entityId].push(ev);
    }

    // Aggregate media by entity
    const mediaByEntity: Record<string, typeof mediaList> = {};
    for (const med of mediaList) {
      if (!mediaByEntity[med.entityId]) mediaByEntity[med.entityId] = [];
      mediaByEntity[med.entityId].push(med);
    }

    // Map family relationships
    const childrenByFam: Record<string, typeof childrenList> = {};
    const famcByChild: Record<string, string[]> = {};
    for (const child of childrenList) {
      if (!childrenByFam[child.familyId]) childrenByFam[child.familyId] = [];
      childrenByFam[child.familyId].push(child);

      if (!famcByChild[child.childId]) famcByChild[child.childId] = [];
      famcByChild[child.childId].push(child.familyId);
    }

    const famsByPerson: Record<string, string[]> = {};
    for (const fam of famList) {
      if (fam.husbandId) {
        if (!famsByPerson[fam.husbandId]) famsByPerson[fam.husbandId] = [];
        famsByPerson[fam.husbandId].push(fam.id);
      }
      if (fam.wifeId) {
        if (!famsByPerson[fam.wifeId]) famsByPerson[fam.wifeId] = [];
        famsByPerson[fam.wifeId].push(fam.id);
      }
    }

    return json({
      tree,
      individuals: indList.map((ind) => ({
        ...ind,
        events: eventsByEntity[ind.id] || [],
        media: mediaByEntity[ind.id] || [],
        famc: famcByChild[ind.id] || [],
        fams: famsByPerson[ind.id] || []
      })),
      families: famList.map((fam) => ({
        ...fam,
        children: childrenByFam[fam.id] || [],
        events: eventsByEntity[fam.id] || []
      }))
    });
  } catch (err: any) {
    console.error('Failed to fetch tree details:', err);
    return json({ error: err?.message || 'Failed to fetch tree details' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const { id: treeId } = params;
  if (!treeId) return json({ error: 'Tree ID required' }, { status: 400 });

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    await db.delete(trees).where(eq(trees.id, treeId));

    return json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete tree:', err);
    return json({ error: err?.message || 'Failed to delete tree' }, { status: 500 });
  }
};
