import type { DbClient } from '../db';
import { individuals, unions, unionPartners, parentChild, events, mediaItems } from '../db/schema';
import { eq, and, getTableColumns, sql } from 'drizzle-orm';

/** Map a neutral parent-child type to the legacy family-wide pedigree value. */
const TYPE_TO_PEDIGREE: Record<string, string> = {
  biological: 'birth',
  adoptive: 'adopted',
  foster: 'foster',
  guardian: 'foster',
  unknown: 'birth'
};

export class GenealogyRepository {
  constructor(private db: DbClient) {}

  async getTreeData(treeId: string) {
    const [indList, unionList, partnerList, pcList, eventList, mediaList] = await Promise.all([
      this.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
      this.db.select().from(unions).where(eq(unions.treeId, treeId)).all(),
      // union_partners has no tree_id; unscoped, this read every tree's partners on each load.
      this.db
        .select(getTableColumns(unionPartners))
        .from(unionPartners)
        .innerJoin(unions, eq(unionPartners.unionId, unions.id))
        .where(eq(unions.treeId, treeId))
        .all(),
      this.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all(),
      // Insertion order, said outright: export writes conflicting births in it, and without it the
      // plan picks whichever index it likes (adding `idx_event_place` once reordered them).
      this.db.select().from(events).where(eq(events.treeId, treeId)).orderBy(sql`${events}.rowid`).all(),
      this.db.select().from(mediaItems).where(eq(mediaItems.treeId, treeId)).all()
    ]);

    const eventsByEntity: Record<string, typeof eventList> = {};
    for (const ev of eventList) {
      if (!eventsByEntity[ev.entityId]) eventsByEntity[ev.entityId] = [];
      eventsByEntity[ev.entityId].push(ev);
    }

    const mediaByEntity: Record<string, typeof mediaList> = {};
    for (const med of mediaList) {
      if (!mediaByEntity[med.entityId]) mediaByEntity[med.entityId] = [];
      mediaByEntity[med.entityId].push(med);
    }

    // Ordered partners per union, projected to a binary (partner1/partner2)
    // read shape for the UI. The neutral order is preserved; further partners
    // remain in the graph but are not represented in this two-column view.
    const partnersByUnion = new Map<string, string[]>();
    for (const p of partnerList) {
      const list = partnersByUnion.get(p.unionId) ?? [];
      list[p.order] = p.personId;
      partnersByUnion.set(p.unionId, list);
    }

    // Collapse per-parent assertions into family-wide children for the UI.
    const childrenByUnion = new Map<string, Array<{ childId: string; pedigree: string | null }>>();
    const famcByChild: Record<string, string[]> = {};
    for (const pc of pcList) {
      if (!pc.unionId) continue;
      const children = childrenByUnion.get(pc.unionId) ?? [];
      if (!children.some((c) => c.childId === pc.childId)) {
        children.push({ childId: pc.childId, pedigree: TYPE_TO_PEDIGREE[pc.type] || 'birth' });
      }
      childrenByUnion.set(pc.unionId, children);

      if (!famcByChild[pc.childId]) famcByChild[pc.childId] = [];
      if (!famcByChild[pc.childId].includes(pc.unionId)) famcByChild[pc.childId].push(pc.unionId);
    }

    const famsByPerson: Record<string, string[]> = {};
    for (const u of unionList) {
      for (const personId of partnersByUnion.get(u.id) ?? []) {
        if (!personId) continue;
        if (!famsByPerson[personId]) famsByPerson[personId] = [];
        famsByPerson[personId].push(u.id);
      }
    }

    return {
      individuals: indList.map((ind) => ({
        ...ind,
        events: eventsByEntity[ind.id] || [],
        media: mediaByEntity[ind.id] || [],
        famc: famcByChild[ind.id] || [],
        fams: famsByPerson[ind.id] || []
      })),
      families: unionList.map((u) => {
        const partners = partnersByUnion.get(u.id) ?? [];
        return {
          id: u.id,
          partner1Id: partners[0] ?? null,
          partner2Id: partners[1] ?? null,
          status: u.status,
          version: u.version,
          children: childrenByUnion.get(u.id) || [],
          events: eventsByEntity[u.id] || []
        };
      })
    };
  }

  async getIndividual(treeId: string, individualId: string) {
    const individual = await this.db
      .select()
      .from(individuals)
      .where(and(eq(individuals.treeId, treeId), eq(individuals.id, individualId)))
      .get();

    if (!individual) return null;

    const indEvents = await this.db
      .select()
      .from(events)
      .where(and(eq(events.treeId, treeId), eq(events.entityId, individualId)))
      .orderBy(sql`${events}.rowid`)
      .all();

    return {
      ...individual,
      events: indEvents
    };
  }
}
