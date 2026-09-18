import type { D1Database } from '@cloudflare/workers-types';
import { getDb, individuals, families, familyChildren, events, trees, unions, parentChild, gedcomPreserved, ensureDbSchema } from '../db';
import { parseGedcom, type ParsedGedcomData } from './index';
import { importNeutralModel } from './neutral-importer';
import { eq, inArray } from 'drizzle-orm';

// D1 limits a single query to 100 bound parameters, so batch inserts must be
// chunked by row count x column count, not by row count alone.
// We use a safe budget of 70 parameters per chunk to leave plenty of margin
// regardless of schema defaults or extra columns.
const MAX_BOUND_PARAMS = 70;

function chunkByParamLimit<T>(rows: T[], columnsPerRow: number): T[][] {
  const maxRows = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columnsPerRow));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    chunks.push(rows.slice(i, i + maxRows));
  }
  return chunks;
}

/**
 * Persists parsed GEDCOM data into D1 Database using batch transactions
 * chunked to comply with D1 bound parameter limits.
 */
export type ImportMode = 'replace' | 'merge';

export interface ImportPreview {
  mode: ImportMode;
  /** replace mode: what gets deleted */
  deleteCounts?: { individuals: number; families: number; events: number; childLinks: number };
  /** merge mode: what changes */
  merge?: {
    newIndividuals: number;
    existingIndividuals: number;
    newFamilies: number;
    mergedFamilies: number; // duplicate families in file that map onto existing ones
    newChildLinks: number;
    duplicateChildLinks: number;
    newEvents: number;
    duplicateEvents: number;
  };
  incoming: { individuals: number; families: number; events: number };
}

/**
 * Compute what an import would do without writing anything.
 */
function treeScopedId(treeId: string, rawXrefOrId: string): string {
  // If it's already scoped to this tree, return as is
  if (rawXrefOrId.startsWith(`${treeId}:`)) return rawXrefOrId;
  return `${treeId}:${rawXrefOrId}`;
}

export async function previewGedcomImport(
  d1: D1Database,
  treeId: string,
  rawGedcom: string
): Promise<ImportPreview> {
  await ensureDbSchema(d1);
  const parsed = parseGedcom(rawGedcom);
  const db = getDb(d1);

  const incomingEvents =
    parsed.individuals.reduce((n, i) => n + i.events.length, 0) +
    parsed.families.reduce((n, f) => n + f.events.length, 0);
  const incoming: ImportPreview['incoming'] = {
    individuals: parsed.individuals.length,
    families: parsed.families.length,
    events: incomingEvents
  };

  const existingTree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
  const isEmpty = !existingTree;

  if (isEmpty) {
    return { mode: 'replace', incoming };
  }

  const [treeInds, treeFams, treeChildren, treeEvents] = await Promise.all([
    db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
    db.select().from(families).where(eq(families.treeId, treeId)).all(),
    db.select().from(familyChildren).all(),
    db.select().from(events).where(eq(events.treeId, treeId)).all()
  ]);

  const deleteCounts = {
    individuals: treeInds.length,
    families: treeFams.length,
    events: treeEvents.length,
    childLinks: treeChildren.filter((c) => treeFams.some((f) => f.id === c.familyId)).length
  };

  // Merge analysis — identity is the tree-scoped GEDCOM XREF, never a spouse
  // pair. A family that collides with an existing XREF maps onto that record;
  // a distinct XREF always stays distinct, even if the participants match.
  const existingEventKeys = new Set(
    treeEvents.map((e) => `${e.entityType}:${e.entityId}:${e.type}:${e.dateRaw ?? ''}:${e.place ?? ''}`)
  );
  const existingChildKeys = new Set(treeChildren.map((c) => `${c.familyId}:${c.childId}`));
  const existingIndIds = new Set(treeInds.map((i) => i.id));
  const existingIndXrefs = new Set(treeInds.map((i) => i.xrefId || i.id));
  const existingFamIds = new Set(treeFams.map((f) => f.id));

  const merge: ImportPreview['merge'] = {
    newIndividuals: 0,
    existingIndividuals: 0,
    newFamilies: 0,
    mergedFamilies: 0,
    newChildLinks: 0,
    duplicateChildLinks: 0,
    newEvents: 0,
    duplicateEvents: 0
  };

  for (const fam of parsed.families) {
    const targetFamId = treeScopedId(treeId, fam.id);
    if (existingFamIds.has(targetFamId)) {
      merge.mergedFamilies++;
    } else {
      merge.newFamilies++;
    }
    for (const ch of fam.children) {
      const targetChildId = treeScopedId(treeId, ch.childId);
      if (existingChildKeys.has(`${targetFamId}:${targetChildId}`)) {
        merge.duplicateChildLinks++;
      } else {
        merge.newChildLinks++;
        existingChildKeys.add(`${targetFamId}:${targetChildId}`);
      }
    }
    for (const ev of fam.events) {
      const evKey = `FAMILY:${targetFamId}:${ev.type}:${ev.dateRaw ?? ''}:${ev.place ?? ''}`;
      if (existingEventKeys.has(evKey)) {
        merge.duplicateEvents++;
      } else {
        merge.newEvents++;
        existingEventKeys.add(evKey);
      }
    }
  }

  for (const ind of parsed.individuals) {
    const scopedIndId = treeScopedId(treeId, ind.id);
    if (existingIndIds.has(scopedIndId) || existingIndXrefs.has(ind.id)) {
      merge.existingIndividuals++;
    } else {
      merge.newIndividuals++;
    }
    for (const ev of ind.events) {
      const evKey = `INDIVIDUAL:${scopedIndId}:${ev.type}:${ev.dateRaw ?? ''}:${ev.place ?? ''}`;
      if (existingEventKeys.has(evKey)) {
        merge.duplicateEvents++;
      } else {
        merge.newEvents++;
        existingEventKeys.add(evKey);
      }
    }
  }

  return { mode: 'merge', deleteCounts, merge, incoming };
}

export async function importGedcomToDb(
  d1: D1Database,
  treeId: string,
  rawGedcom: string,
  treeName?: string,
  mode: ImportMode = 'replace'
): Promise<{ individualsCount: number; familiesCount: number; eventsCount: number }> {
  await ensureDbSchema(d1);
  const parsed = parseGedcom(rawGedcom);
  const db = getDb(d1);

  // Ensure tree exists or update tree name
  const existingTree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
  if (!existingTree) {
    await db.insert(trees).values({
      id: treeId,
      name: treeName || parsed.treeName || 'Imported Tree',
      description: `Imported with ${parsed.individuals.length} individuals and ${parsed.families.length} families`,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else if (mode === 'replace') {
    // Wipe all existing tree data before re-import.
    const famIds = (await db.select({ id: families.id }).from(families).where(eq(families.treeId, treeId)).all()).map((f) => f.id);
    if (famIds.length > 0) {
      // Chunk inArray delete to stay within bound parameter limits
      for (const famChunk of chunkByParamLimit(famIds, 1)) {
        await db.delete(familyChildren).where(inArray(familyChildren.familyId, famChunk));
      }
    }
    await db.delete(events).where(eq(events.treeId, treeId));
    await db.delete(families).where(eq(families.treeId, treeId));
    // Neutral tables: deleting unions cascades union_partners; parent_child and
    // person_names are removed via the individuals cascade below.
    await db.delete(unions).where(eq(unions.treeId, treeId));
    await db.delete(individuals).where(eq(individuals.treeId, treeId));
  }

  // 1. Prepare Individual Inserts
  const indValues = parsed.individuals.map((ind) => ({
    id: treeScopedId(treeId, ind.id),
    treeId,
    xrefId: ind.id,
    givenName: ind.givenName || null,
    surname: ind.surname || null,
    // The legacy individuals table only stores M/F/U; GEDCOM 7 `X` (non-binary)
    // is stored as U until the neutral model adopts its own sex representation.
    sex: ind.sex === 'X' ? 'U' : (ind.sex || 'U'),
    createdAt: new Date()
  }));

  // Batch insert individuals (9 columns generated by Drizzle: id, treeId, xrefId, givenName, surname, sex, version, createdAt, updatedAt)
  if (indValues.length > 0) {
    for (const chunk of chunkByParamLimit(indValues, 9)) {
      await db.insert(individuals).values(chunk).onConflictDoNothing();
    }
  }

  // 2. Prepare Family Inserts — identity is the tree-scoped GEDCOM XREF.
  // A family with a colliding XREF maps onto the existing record via
  // onConflictDoNothing; distinct XREFs stay distinct regardless of spouse pair.
  const famValues = parsed.families.map((fam) => {
    const scopedFamId = treeScopedId(treeId, fam.id);
    return {
      id: scopedFamId,
      treeId,
      xrefId: fam.id,
      husbandId: fam.husbandId ? treeScopedId(treeId, fam.husbandId) : null,
      wifeId: fam.wifeId ? treeScopedId(treeId, fam.wifeId) : null
    };
  });

  // Batch insert families (8 columns generated by Drizzle: id, treeId, xrefId, husbandId, wifeId, version, createdAt, updatedAt)
  if (famValues.length > 0) {
    for (const chunk of chunkByParamLimit(famValues, 8)) {
      await db.insert(families).values(chunk).onConflictDoNothing();
    }
  }

  // 3. Prepare Family Children Junction
  const childJunctions: Array<{
    familyId: string;
    childId: string;
    pedigree: 'birth' | 'adopted' | 'foster';
  }> = [];

  for (const fam of parsed.families) {
    const scopedFamId = treeScopedId(treeId, fam.id);
    for (const child of fam.children) {
      childJunctions.push({
        familyId: scopedFamId,
        childId: treeScopedId(treeId, child.childId),
        pedigree: (child.pedigree as 'birth' | 'adopted' | 'foster') || 'birth'
      });
    }
  }

  if (childJunctions.length > 0) {
    for (const chunk of chunkByParamLimit(childJunctions, 3)) {
      await db.insert(familyChildren).values(chunk).onConflictDoNothing();
    }
  }

  // 4. Prepare Events (Individuals + Families)
  const eventValues: Array<{
    id: string;
    treeId: string;
    entityType: 'INDIVIDUAL' | 'FAMILY';
    entityId: string;
    type: string;
    dateRaw: string | null;
    dateSort: string | null;
    place: string | null;
    description: string | null;
  }> = [];

  for (const ind of parsed.individuals) {
    const scopedIndId = treeScopedId(treeId, ind.id);
    for (const ev of ind.events) {
      eventValues.push({
        id: crypto.randomUUID(),
        treeId,
        entityType: 'INDIVIDUAL',
        entityId: scopedIndId,
        type: ev.type,
        dateRaw: ev.dateRaw || null,
        dateSort: ev.dateSort || null,
        place: ev.place || null,
        description: ev.description || null
      });
    }
  }

  for (const fam of parsed.families) {
    const scopedFamId = treeScopedId(treeId, fam.id);
    for (const ev of fam.events) {
      eventValues.push({
        id: crypto.randomUUID(),
        treeId,
        entityType: 'FAMILY',
        entityId: scopedFamId,
        type: ev.type,
        dateRaw: ev.dateRaw || null,
        dateSort: ev.dateSort || null,
        place: ev.place || null,
        description: ev.description || null
      });
    }
  }

  if (mode === 'merge') {
    // Deduplicate events by content: skip rows identical to what's already
    // stored (same entity, type, date, place) and intra-file repeats.
    const existingEventKeys = new Set(
      (await db.select().from(events).where(eq(events.treeId, treeId)).all()).map(
        (e) => `${e.entityType}:${e.entityId}:${e.type}:${e.dateRaw ?? ''}:${e.place ?? ''}`
      )
    );
    const deduped: typeof eventValues = [];
    for (const ev of eventValues) {
      const key = `${ev.entityType}:${ev.entityId}:${ev.type}:${ev.dateRaw ?? ''}:${ev.place ?? ''}`;
      if (existingEventKeys.has(key)) continue;
      existingEventKeys.add(key);
      deduped.push(ev);
    }
    eventValues.length = 0;
    eventValues.push(...deduped);
  }

  // Batch insert events (12 columns generated by Drizzle: id, treeId, entityType, entityId, type, dateRaw, dateSort, place, description, version, createdAt, updatedAt)
  if (eventValues.length > 0) {
    for (const chunk of chunkByParamLimit(eventValues, 12)) {
      await db.insert(events).values(chunk).onConflictDoNothing();
    }
  }

  // 5. Populate the neutral model alongside the legacy tables.
  await importNeutralModel(db, treeId, parsed);

  return {
    individualsCount: indValues.length,
    familiesCount: famValues.length,
    eventsCount: eventValues.length
  };
}

/**
 * Retrieve tree data from D1 and build export payload
 */
export async function getTreeExportData(d1: D1Database, treeId: string) {
  const db = getDb(d1);
  const tree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
  const treeInds = await db.select().from(individuals).where(eq(individuals.treeId, treeId)).all();
  const treeFams = await db.select().from(families).where(eq(families.treeId, treeId)).all();
  const treeChildren = await db.select().from(familyChildren).all();
  const treeEvents = await db.select().from(events).where(eq(events.treeId, treeId)).all();
  const treePreserved = await db
    .select()
    .from(gedcomPreserved)
    .where(eq(gedcomPreserved.treeId, treeId))
    .all();

  // Map events to individual or family
  const eventsByEntity: Record<string, typeof treeEvents> = {};
  for (const ev of treeEvents) {
    if (!eventsByEntity[ev.entityId]) {
      eventsByEntity[ev.entityId] = [];
    }
    eventsByEntity[ev.entityId].push(ev);
  }

  // Map children by family
  const childrenByFam: Record<string, Array<{ childId: string; pedigree: string | null }>> = {};
  const famcByChild: Record<string, string[]> = {};
  for (const c of treeChildren) {
    if (!childrenByFam[c.familyId]) childrenByFam[c.familyId] = [];
    childrenByFam[c.familyId].push({ childId: c.childId, pedigree: c.pedigree });

    if (!famcByChild[c.childId]) famcByChild[c.childId] = [];
    famcByChild[c.childId].push(c.familyId);
  }

  // Map spouse families by individual
  const famsByInd: Record<string, string[]> = {};
  for (const f of treeFams) {
    if (f.husbandId) {
      if (!famsByInd[f.husbandId]) famsByInd[f.husbandId] = [];
      famsByInd[f.husbandId].push(f.id);
    }
    if (f.wifeId) {
      if (!famsByInd[f.wifeId]) famsByInd[f.wifeId] = [];
      famsByInd[f.wifeId].push(f.id);
    }
  }

  // Format export IDs: prefer original xrefId if present, otherwise clean ID
  const indXrefMap = new Map<string, string>();
  for (const ind of treeInds) {
    indXrefMap.set(ind.id, ind.xrefId || ind.id.replace(new RegExp(`^${treeId}:`), ''));
  }

  const famXrefMap = new Map<string, string>();
  for (const fam of treeFams) {
    famXrefMap.set(fam.id, fam.xrefId || fam.id.replace(new RegExp(`^${treeId}:`), ''));
  }

  // Map stored XREFs to export IDs so preserved lines re-attach to their owner.
  const xrefToExportId = new Map<string, string>();
  for (const [id, xref] of indXrefMap) {
    if (xref) xrefToExportId.set(xref, xref);
  }
  for (const [id, xref] of famXrefMap) {
    if (xref) xrefToExportId.set(xref, xref);
  }

  return {
    treeName: tree?.name || 'Family Tree',
    individuals: treeInds.map((ind) => {
      const exportId = indXrefMap.get(ind.id) || ind.id;
      return {
        id: exportId,
        givenName: ind.givenName,
        surname: ind.surname,
        sex: ind.sex,
        events: eventsByEntity[ind.id] || [],
        famc: (famcByChild[ind.id] || []).map((fid) => famXrefMap.get(fid) || fid),
        fams: (famsByInd[ind.id] || []).map((fid) => famXrefMap.get(fid) || fid)
      };
    }),
    families: treeFams.map((fam) => {
      const exportFamId = famXrefMap.get(fam.id) || fam.id;
      return {
        id: exportFamId,
        husbandId: fam.husbandId ? (indXrefMap.get(fam.husbandId) || fam.husbandId) : null,
        wifeId: fam.wifeId ? (indXrefMap.get(fam.wifeId) || fam.wifeId) : null,
        children: (childrenByFam[fam.id] || []).map((c) => ({
          childId: indXrefMap.get(c.childId) || c.childId,
          pedigree: c.pedigree
        })),
        events: eventsByEntity[fam.id] || []
      };
    }),
    preserved: treePreserved
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        xref: p.ownerXref ? xrefToExportId.get(p.ownerXref) ?? p.ownerXref : null,
        lines: p.lines as unknown as string[]
      }))
  };
}
