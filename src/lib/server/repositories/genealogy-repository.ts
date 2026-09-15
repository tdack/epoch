import type { DbClient } from '../db';
import { individuals, families, familyChildren, events, mediaItems } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { ConcurrencyConflictError, NotFoundError } from '../domain/errors';
import type { IndividualRecord, FamilyRecord, EventRecord } from '../domain/genealogy';

export class GenealogyRepository {
  constructor(private db: DbClient) {}

  async getTreeData(treeId: string) {
    const [indList, famList, childrenList, eventList, mediaList] = await Promise.all([
      this.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
      this.db.select().from(families).where(eq(families.treeId, treeId)).all(),
      this.db.select().from(familyChildren).all(),
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

    return {
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

  async deleteIndividual(treeId: string, individualId: string): Promise<void> {
    await this.db
      .delete(individuals)
      .where(and(eq(individuals.treeId, treeId), eq(individuals.id, individualId)));
  }
}
