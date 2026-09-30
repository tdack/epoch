import type { D1Database } from '@cloudflare/workers-types';
import { getDb, type DbClient, individuals, events, trees, unions, unionPartners, parentChild, gedcomPreserved, personNames } from '../db';
import { dateColumnsFor, type EventDateColumns } from '../domain/date-columns';
import { parseGedcom, type ParsedGedcomData } from './index';
import { importNeutralModel } from './neutral-importer';
import { detectDuplicateFamilies, foldIntoExistingAliases, mergeExactDuplicateFamilies, type DuplicateFamilyReport } from './duplicate-families';
import { eq, getTableColumns, sql } from 'drizzle-orm';

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
 * The identity of an event for merge-mode de-duplication, shared by the preview and the import so
 * their counts agree. The value, cause, age and note are part of it: two undated occupations with
 * different values are two facts, not one repeated.
 */
function eventContentKey(e: {
  entityType: string;
  entityId: string;
  type: string;
  dateRaw?: string | null;
  place?: string | null;
  description?: string | null;
  value?: string | null;
  cause?: string | null;
  age?: string | null;
  notes?: string | null;
}): string {
  return [e.entityType, e.entityId, e.type, e.dateRaw, e.place, e.description, e.value, e.cause, e.age, e.notes]
    .map((part) => part ?? '')
    .join('\u0000');
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
  /** Families the file repeats: exact ones can be merged on import, possible ones are for review. */
  duplicates: DuplicateFamilyReport;
}

export interface ImportOptions {
  /**
   * Fold exact duplicate families into one, keeping every XREF as an alias. Off unless asked, so
   * a caller that does not know about duplicates gets the file exactly as written.
   */
  shouldMergeDuplicateFamilies?: boolean;
}

/** Preview for a file with no tree to compare against: a new tree, so only the file is analysed. */
export function previewGedcomFile(rawGedcom: string): ImportPreview {
  const parsed = parseGedcom(rawGedcom);
  return {
    mode: 'replace',
    incoming: countIncoming(parsed),
    duplicates: detectDuplicateFamilies(parsed)
  };
}

function countIncoming(parsed: ParsedGedcomData): ImportPreview['incoming'] {
  return {
    individuals: parsed.individuals.length,
    families: parsed.families.length,
    events:
      parsed.individuals.reduce((n, i) => n + i.events.length, 0) +
      parsed.families.reduce((n, f) => n + f.events.length, 0)
  };
}

/**
 * Compute what an import would do without writing anything.
 */
function treeScopedId(treeId: string, rawXrefOrId: string): string {
  // If it's already scoped to this tree, return as is
  if (rawXrefOrId.startsWith(`${treeId}:`)) return rawXrefOrId;
  return `${treeId}:${rawXrefOrId}`;
}

/** Alias XREF to surviving XREF for unions already in the tree that absorbed other families. */
async function aliasesInTree(db: DbClient, treeId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const union of await db.select().from(unions).where(eq(unions.treeId, treeId)).all()) {
    const survivor = union.id.startsWith(`${treeId}:`) ? union.id.slice(treeId.length + 1) : union.id;
    for (const alias of union.xrefAliases ?? []) map.set(alias, survivor);
  }
  return map;
}

export async function previewGedcomImport(
  d1: D1Database,
  treeId: string,
  rawGedcom: string
): Promise<ImportPreview> {
  const db = getDb(d1);
  const existingTree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
  const isEmpty = !existingTree;

  const fresh = parseGedcom(rawGedcom);
  const incoming = countIncoming(fresh);
  const duplicates = detectDuplicateFamilies(fresh);

  if (isEmpty) {
    return { mode: 'replace', incoming, duplicates };
  }

  // A family that was merged into another the last time counts as that one, so the counts match what the import will do.
  const parsed = foldIntoExistingAliases(fresh, await aliasesInTree(db, treeId)).parsed;

  const [treeInds, treeUnions, treeAssertions, treeEvents] = await Promise.all([
    db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
    db.select().from(unions).where(eq(unions.treeId, treeId)).all(),
    db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all(),
    db.select().from(events).where(eq(events.treeId, treeId)).all()
  ]);

  const deleteCounts = {
    individuals: treeInds.length,
    families: treeUnions.length,
    events: treeEvents.length,
    childLinks: treeAssertions.length
  };

  // Merge analysis — identity is the tree-scoped GEDCOM XREF, never a spouse
  // pair. A family that collides with an existing XREF maps onto that record;
  // a distinct XREF always stays distinct, even if the participants match.
  const existingEventKeys = new Set(treeEvents.map(eventContentKey));
  const existingChildKeys = new Set(treeAssertions.map((c) => `${c.unionId}:${c.childId}`));
  const existingIndIds = new Set(treeInds.map((i) => i.id));
  const existingIndXrefs = new Set(treeInds.map((i) => i.xrefId || i.id));
  const existingFamIds = new Set(treeUnions.map((f) => f.id));

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
      const evKey = eventContentKey({ entityType: 'FAMILY', entityId: targetFamId, ...ev });
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
      const evKey = eventContentKey({ entityType: 'INDIVIDUAL', entityId: scopedIndId, ...ev });
      if (existingEventKeys.has(evKey)) {
        merge.duplicateEvents++;
      } else {
        merge.newEvents++;
        existingEventKeys.add(evKey);
      }
    }
  }

  return { mode: 'merge', deleteCounts, merge, incoming, duplicates };
}

export async function importGedcomToDb(
  d1: D1Database,
  treeId: string,
  rawGedcom: string,
  treeName?: string,
  mode: ImportMode = 'replace',
  options: ImportOptions = {}
): Promise<{ individualsCount: number; familiesCount: number; eventsCount: number; mergedFamiliesCount: number }> {
  const folded = options.shouldMergeDuplicateFamilies
    ? mergeExactDuplicateFamilies(parseGedcom(rawGedcom))
    : { parsed: parseGedcom(rawGedcom), mergedCount: 0 };
  let parsed = folded.parsed;
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
  } else if (mode === 'merge') {
    // A family merged into another in an earlier import must not come back under its old XREF.
    parsed = foldIntoExistingAliases(parsed, await aliasesInTree(db, treeId)).parsed;
  } else if (mode === 'replace') {
    // Wipe all existing tree data before re-import.
    await db.delete(events).where(eq(events.treeId, treeId));
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
    sex: ind.sex || 'U',
    createdAt: new Date()
  }));

  // Batch insert individuals (9 columns generated by Drizzle: id, treeId, xrefId, givenName, surname, sex, version, createdAt, updatedAt)
  if (indValues.length > 0) {
    for (const chunk of chunkByParamLimit(indValues, 9)) {
      await db.insert(individuals).values(chunk).onConflictDoNothing();
    }
  }

  // 2. Neutral model: unions + union_partners + parent_child + person_names.
  // This is now the single source of truth; the legacy `families`/`family_children`
  // tables have been expunged.
  await importNeutralModel(db, treeId, parsed);
  const eventValues: Array<{
    id: string;
    treeId: string;
    entityType: 'INDIVIDUAL' | 'FAMILY';
    entityId: string;
    type: string;
    dateRaw: string | null;
    dateSort: string | null;
    dateSortEnd: string | null;
    dateQualifier: EventDateColumns['dateQualifier'];
    datePrecision: EventDateColumns['datePrecision'];
    dateCalendar: EventDateColumns['dateCalendar'];
    place: string | null;
    description: string | null;
    value: string | null;
    cause: string | null;
    age: string | null;
    notes: string | null;
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
        ...dateColumnsFor(ev.dateRaw),
        place: ev.place || null,
        description: ev.description || null,
        value: ev.value || null,
        cause: ev.cause || null,
        age: ev.age || null,
        notes: ev.notes || null
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
        ...dateColumnsFor(ev.dateRaw),
        place: ev.place || null,
        description: ev.description || null,
        value: null,
        cause: null,
        age: null,
        notes: null
      });
    }
  }

  if (mode === 'merge') {
    // Deduplicate events by content: skip rows identical to what's already stored and
    // intra-file repeats.
    const existingEventKeys = new Set(
      (await db.select().from(events).where(eq(events.treeId, treeId)).all()).map(eventContentKey)
    );
    const deduped: typeof eventValues = [];
    for (const ev of eventValues) {
      const key = eventContentKey(ev);
      if (existingEventKeys.has(key)) continue;
      existingEventKeys.add(key);
      deduped.push(ev);
    }
    eventValues.length = 0;
    eventValues.push(...deduped);
  }

  // Batch insert events (21 columns generated by Drizzle: id, treeId, entityType, entityId, type, dateRaw, dateSort, dateSortEnd, dateQualifier, datePrecision, dateCalendar, place, description, value, cause, age, notes, sortOrder, version, createdAt, updatedAt)
  if (eventValues.length > 0) {
    for (const chunk of chunkByParamLimit(eventValues, 21)) {
      await db.insert(events).values(chunk).onConflictDoNothing();
    }
  }

  return {
    individualsCount: indValues.length,
    familiesCount: parsed.families.length,
    eventsCount: eventValues.length,
    mergedFamiliesCount: folded.mergedCount
  };
}

/**
 * Retrieve tree data from D1 and build export payload.
 *
 * Reads the neutral model only: unions become binary husband/wife GEDCOM
 * families (first two ordered participants), parent-child assertions collapse
 * back into family-wide children with a per-family pedigree derived from the
 * per-parent type.
 */
export async function getTreeExportData(d1: D1Database, treeId: string) {
  const db = getDb(d1);
  const tree = await db.select().from(trees).where(eq(trees.id, treeId)).get();
  const treeInds = await db.select().from(individuals).where(eq(individuals.treeId, treeId)).all();
  const treeUnions = await db.select().from(unions).where(eq(unions.treeId, treeId)).all();
  // union_partners has no tree_id; unscoped, this exported every tree's partners into every export.
  const treePartners = await db
    .select(getTableColumns(unionPartners))
    .from(unionPartners)
    .innerJoin(unions, eq(unionPartners.unionId, unions.id))
    .where(eq(unions.treeId, treeId))
    .all();
  const treeAssertions = await db
    .select()
    .from(parentChild)
    .where(eq(parentChild.treeId, treeId))
    .all();
  const treeEvents = await db.select().from(events).where(eq(events.treeId, treeId)).all();
  const treeNames = await db
    .select(getTableColumns(personNames))
    .from(personNames)
    .innerJoin(individuals, eq(personNames.personId, individuals.id))
    .where(eq(individuals.treeId, treeId))
    .orderBy(sql`${personNames}.rowid`)
    .all();
  const treePreserved = await db
    .select()
    .from(gedcomPreserved)
    .where(eq(gedcomPreserved.treeId, treeId))
    .all();

  const namesByPerson = new Map<string, typeof treeNames>();
  for (const n of treeNames) namesByPerson.set(n.personId, [...(namesByPerson.get(n.personId) ?? []), n]);

  // Map events to individual or union (family) entity.
  const eventsByEntity: Record<string, typeof treeEvents> = {};
  for (const ev of treeEvents) {
    if (!eventsByEntity[ev.entityId]) {
      eventsByEntity[ev.entityId] = [];
    }
    eventsByEntity[ev.entityId].push(ev);
  }

  // Group ordered partners by union.
  const partnersByUnion = new Map<string, string[]>();
  for (const p of treePartners) {
    const list = partnersByUnion.get(p.unionId) ?? [];
    list[p.order] = p.personId;
    partnersByUnion.set(p.unionId, list);
  }

  // Collapse per-parent assertions into family-wide children. A child is listed once per union.
  // PEDI is per link to the family, so it is the first parent's type; a parent whose type differs
  // is carried in `parentPedigrees` and written as `_PEDI_PARENT`.
  const TYPE_TO_PEDIGREE: Record<string, string> = {
    biological: 'birth',
    adoptive: 'adopted',
    foster: 'foster',
    // No GEDCOM value for a guardian; foster is the closest, and the loss is documented (ADR-009).
    guardian: 'foster',
    unknown: 'birth'
  };
  const pedigreeOf = (a: { type: string; gedcomPedi: string | null }) =>
    a.type === 'unknown' && a.gedcomPedi ? a.gedcomPedi : TYPE_TO_PEDIGREE[a.type] || 'birth';
  const orderOfParent = (unionId: string, parentId: string) => (partnersByUnion.get(unionId) ?? []).indexOf(parentId);

  type ExportedChild = { childId: string; pedigree: string | null; parentPedigrees?: Record<string, string> };
  const childrenByUnion = new Map<string, ExportedChild[]>();
  const famcByChild: Record<string, string[]> = {};
  const linksByChildUnion = new Map<string, typeof treeAssertions>();
  for (const a of treeAssertions) {
    if (!a.unionId) continue; // direct (non-union) assertions have no GEDCOM family
    const key = `${a.unionId}|${a.childId}`;
    linksByChildUnion.set(key, [...(linksByChildUnion.get(key) ?? []), a]);
    if (!famcByChild[a.childId]) famcByChild[a.childId] = [];
    if (!famcByChild[a.childId].includes(a.unionId)) famcByChild[a.childId].push(a.unionId);
  }

  // Map spouse families by individual (unions where the person is a partner).
  const famsByInd: Record<string, string[]> = {};
  for (const u of treeUnions) {
    for (const personId of partnersByUnion.get(u.id) ?? []) {
      if (!personId) continue;
      if (!famsByInd[personId]) famsByInd[personId] = [];
      famsByInd[personId].push(u.id);
    }
  }

  // Format export IDs: prefer original xrefId if present, otherwise clean ID
  const indXrefMap = new Map<string, string>();
  for (const ind of treeInds) {
    indXrefMap.set(ind.id, ind.xrefId || ind.id.replace(new RegExp(`^${treeId}:`), ''));
  }

  const famXrefMap = new Map<string, string>();
  for (const u of treeUnions) {
    famXrefMap.set(u.id, u.id.replace(new RegExp(`^${treeId}:`), ''));
  }

  for (const [key, links] of linksByChildUnion) {
    const [unionId, childId] = key.split('|');
    const ordered = [...links].sort((a, b) => orderOfParent(unionId, a.parentId) - orderOfParent(unionId, b.parentId));
    const first = pedigreeOf(ordered[0]);
    const parentPedigrees: Record<string, string> = {};
    for (const link of ordered.slice(1)) {
      if (pedigreeOf(link) !== first) parentPedigrees[indXrefMap.get(link.parentId) || link.parentId] = pedigreeOf(link);
    }
    childrenByUnion.set(unionId, [
      ...(childrenByUnion.get(unionId) ?? []),
      { childId, pedigree: first, ...(Object.keys(parentPedigrees).length > 0 ? { parentPedigrees } : {}) }
    ]);
  }

  // Map stored XREFs to export IDs so preserved lines re-attach to their owner.
  const xrefToExportId = new Map<string, string>();
  for (const [id, xref] of indXrefMap) {
    if (xref) xrefToExportId.set(xref, xref);
  }
  for (const [id, xref] of famXrefMap) {
    if (xref) xrefToExportId.set(xref, xref);
  }
  // Structures preserved under a merged-away family re-attach to the family that absorbed it.
  for (const u of treeUnions) {
    for (const alias of u.xrefAliases ?? []) xrefToExportId.set(alias, famXrefMap.get(u.id) ?? u.id);
  }

  return {
    treeName: tree?.name || 'Family Tree',
    individuals: treeInds.map((ind) => {
      const exportId = indXrefMap.get(ind.id) || ind.id;
      return {
        id: exportId,
        givenName: ind.givenName,
        surname: ind.surname,
        // The preferred name first, because GEDCOM reads the first NAME as the primary one; the rest keep their order.
        names: (namesByPerson.get(ind.id) ?? [])
          .slice()
          .sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.order - b.order)
          .map((n) => ({
            type: n.type,
            gedcomType: n.gedcomType,
            givenName: n.givenName,
            surname: n.surname,
            prefix: n.namePrefix,
            suffix: n.nameSuffix,
            nickname: n.nickname,
            surnamePrefix: n.surnamePrefix,
            extra: n.gedcomExtra
          })),
        sex: ind.sex,
        events: eventsByEntity[ind.id] || [],
        famc: (famcByChild[ind.id] || []).map((fid) => famXrefMap.get(fid) || fid),
        fams: (famsByInd[ind.id] || []).map((fid) => famXrefMap.get(fid) || fid)
      };
    }),
    families: treeUnions.map((u) => {
      const exportFamId = famXrefMap.get(u.id) || u.id;
      const partners = partnersByUnion.get(u.id) ?? [];
      const husbandId = partners[0] ?? null;
      const wifeId = partners[1] ?? null;
      return {
        id: exportFamId,
        husbandId: husbandId ? (indXrefMap.get(husbandId) || husbandId) : null,
        wifeId: wifeId ? (indXrefMap.get(wifeId) || wifeId) : null,
        children: (childrenByUnion.get(u.id) || []).map((c) => ({
          childId: indXrefMap.get(c.childId) || c.childId,
          pedigree: c.pedigree,
          ...(c.parentPedigrees ? { parentPedigrees: c.parentPedigrees } : {})
        })),
        ...(u.xrefAliases && u.xrefAliases.length > 0 ? { aliases: u.xrefAliases } : {}),
        events: eventsByEntity[u.id] || []
      };
    }),
    preserved: treePreserved
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => {
        const lines = p.lines as unknown as string[];
        // Extras kept under a FAMC follow the family that absorbed it, so they land on the FAMC that is written.
        const famc = lines[0]?.trim().match(/^(1 FAMC\s+)(\S+)$/);
        return {
          xref: p.ownerXref ? xrefToExportId.get(p.ownerXref) ?? p.ownerXref : null,
          lines: famc ? [`${famc[1]}${xrefToExportId.get(famc[2]) ?? famc[2]}`, ...lines.slice(1)] : lines
        };
      })
  };
}
