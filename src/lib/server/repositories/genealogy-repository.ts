import type { DbClient } from '../db';
import { individuals, unions, unionPartners, parentChild, events, mediaItems } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { ConcurrencyConflictError, NotFoundError } from '../domain/errors';
import type { IndividualRecord } from '../domain/genealogy';

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
      this.db.select().from(unionPartners).all(),
      this.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all(),
      this.db.select().from(events).where(eq(events.treeId, treeId)).all(),
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
          children: childrenByUnion.get(u.id) || [],
          events: eventsByEntity[u.id] || []
        };
      })
    };
  }

  async createIndividual(data: {
    treeId: string;
    xrefId?: string | null;
    givenName?: string | null;
    surname?: string | null;
    sex?: 'M' | 'F' | 'U';
    birthDate?: string | null;
    birthPlace?: string | null;
    deathDate?: string | null;
    deathPlace?: string | null;
  }): Promise<IndividualRecord> {
    const id = crypto.randomUUID();
    const now = new Date();

    const record = {
      id,
      treeId: data.treeId,
      xrefId: data.xrefId || `@I_${id.slice(0, 8)}@`,
      givenName: data.givenName?.trim() || null,
      surname: data.surname?.trim() || null,
      sex: data.sex || 'U',
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    await this.db.insert(individuals).values(record);

    if (data.birthDate?.trim() || data.birthPlace?.trim()) {
      await this.db.insert(events).values({
        id: crypto.randomUUID(),
        treeId: data.treeId,
        entityType: 'INDIVIDUAL',
        entityId: id,
        type: 'BIRT',
        dateRaw: data.birthDate?.trim() || null,
        dateSort: data.birthDate?.trim() || null,
        place: data.birthPlace?.trim() || null,
        description: null,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
    }

    if (data.deathDate?.trim() || data.deathPlace?.trim()) {
      await this.db.insert(events).values({
        id: crypto.randomUUID(),
        treeId: data.treeId,
        entityType: 'INDIVIDUAL',
        entityId: id,
        type: 'DEAT',
        dateRaw: data.deathDate?.trim() || null,
        dateSort: data.deathDate?.trim() || null,
        place: data.deathPlace?.trim() || null,
        description: null,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
    }

    return {
      id: record.id,
      treeId: record.treeId,
      xrefId: record.xrefId,
      givenName: record.givenName,
      surname: record.surname,
      sex: record.sex as 'M' | 'F' | 'U',
      version: record.version,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateIndividual(
    treeId: string,
    individualId: string,
    expectedVersion: number,
    data: {
      givenName?: string | null;
      surname?: string | null;
      sex?: 'M' | 'F' | 'U';
      birthDate?: string | null;
      birthPlace?: string | null;
      deathDate?: string | null;
      deathPlace?: string | null;
    }
  ): Promise<IndividualRecord> {
    const existing = await this.db
      .select()
      .from(individuals)
      .where(and(eq(individuals.treeId, treeId), eq(individuals.id, individualId)))
      .get();

    if (!existing) throw new NotFoundError('Individual', individualId);

    if (existing.version !== expectedVersion) {
      throw new ConcurrencyConflictError(
        `Individual '${individualId}' was modified concurrently (current: ${existing.version}, expected: ${expectedVersion})`
      );
    }

    const nextVersion = existing.version + 1;
    const now = new Date();

    await this.db
      .update(individuals)
      .set({
        givenName: data.givenName !== undefined ? data.givenName?.trim() || null : existing.givenName,
        surname: data.surname !== undefined ? data.surname?.trim() || null : existing.surname,
        sex: data.sex !== undefined ? data.sex : existing.sex,
        version: nextVersion,
        updatedAt: now
      })
      .where(and(eq(individuals.id, individualId), eq(individuals.version, expectedVersion)));

    // Update birth event if provided
    if (data.birthDate !== undefined || data.birthPlace !== undefined) {
      const birthEv = await this.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.treeId, treeId),
            eq(events.entityType, 'INDIVIDUAL'),
            eq(events.entityId, individualId),
            eq(events.type, 'BIRT')
          )
        )
        .get();

      if (birthEv) {
        await this.db
          .update(events)
          .set({
            dateRaw: data.birthDate !== undefined ? data.birthDate?.trim() || null : birthEv.dateRaw,
            dateSort: data.birthDate !== undefined ? data.birthDate?.trim() || null : birthEv.dateSort,
            place: data.birthPlace !== undefined ? data.birthPlace?.trim() || null : birthEv.place,
            version: birthEv.version + 1,
            updatedAt: now
          })
          .where(eq(events.id, birthEv.id));
      } else if (data.birthDate?.trim() || data.birthPlace?.trim()) {
        await this.db.insert(events).values({
          id: crypto.randomUUID(),
          treeId,
          entityType: 'INDIVIDUAL',
          entityId: individualId,
          type: 'BIRT',
          dateRaw: data.birthDate?.trim() || null,
          dateSort: data.birthDate?.trim() || null,
          place: data.birthPlace?.trim() || null,
          description: null,
          version: 1,
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Update death event if provided
    if (data.deathDate !== undefined || data.deathPlace !== undefined) {
      const deathEv = await this.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.treeId, treeId),
            eq(events.entityType, 'INDIVIDUAL'),
            eq(events.entityId, individualId),
            eq(events.type, 'DEAT')
          )
        )
        .get();

      if (deathEv) {
        await this.db
          .update(events)
          .set({
            dateRaw: data.deathDate !== undefined ? data.deathDate?.trim() || null : deathEv.dateRaw,
            dateSort: data.deathDate !== undefined ? data.deathDate?.trim() || null : deathEv.dateSort,
            place: data.deathPlace !== undefined ? data.deathPlace?.trim() || null : deathEv.place,
            version: deathEv.version + 1,
            updatedAt: now
          })
          .where(eq(events.id, deathEv.id));
      } else if (data.deathDate?.trim() || data.deathPlace?.trim()) {
        await this.db.insert(events).values({
          id: crypto.randomUUID(),
          treeId,
          entityType: 'INDIVIDUAL',
          entityId: individualId,
          type: 'DEAT',
          dateRaw: data.deathDate?.trim() || null,
          dateSort: data.deathDate?.trim() || null,
          place: data.deathPlace?.trim() || null,
          description: null,
          version: 1,
          createdAt: now,
          updatedAt: now
        });
      }
    }

    return {
      id: individualId,
      treeId,
      xrefId: existing.xrefId,
      givenName: data.givenName !== undefined ? data.givenName?.trim() || null : existing.givenName,
      surname: data.surname !== undefined ? data.surname?.trim() || null : existing.surname,
      sex: (data.sex !== undefined ? data.sex : existing.sex) as 'M' | 'F' | 'U',
      version: nextVersion,
      createdAt: existing.createdAt || now,
      updatedAt: now
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
      .all();

    return {
      ...individual,
      events: indEvents
    };
  }

  async deleteIndividual(treeId: string, individualId: string): Promise<void> {
    await this.db
      .delete(events)
      .where(
        and(
          eq(events.treeId, treeId),
          eq(events.entityType, 'INDIVIDUAL'),
          eq(events.entityId, individualId)
        )
      );

    // Neutral model: removing the person cascades union_partners and
    // parent_child assertions referencing them.
    await this.db
      .delete(individuals)
      .where(and(eq(individuals.treeId, treeId), eq(individuals.id, individualId)));
  }
}
