/**
 * Neutral-model importer: persists parsed GEDCOM into the Phase 1 neutral
 * tables (`unions`, `union_partners`, `parent_child`, `person_names`).
 *
 * Identity is the tree-scoped GEDCOM XREF. A union is created for every family
 * record; each participant becomes an ordered `union_partner`; each child link
 * becomes per-parent `parent_child` assertions carrying the relationship type
 * derived from the family-wide pedigree. Repeated unions between the same
 * participants remain distinct because identity is the XREF, not the spouse
 * pair.
 */

import { eq, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import {
	individuals,
	unions,
	unionPartners,
	parentChild,
	personNames,
	gedcomPreserved
} from '../db/schema';
import { dateColumnsFor } from '../domain/date-columns';
import type { ParsedGedcomData } from '../gedcom/parser';
import { treeScopedId } from '../gedcom/import-preview';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
import type { CitationTarget } from './gedcom-evidence-writer';
import { chunkByParamLimit } from './param-chunks';

/**
 * `sealing` and `other` have no neutral type; they become `unknown` and keep the PEDI word in
 * `gedcom_pedi` so export can write it back.
 */
const PEDIGREE_TO_TYPE = {
	birth: 'biological',
	adopted: 'adoptive',
	foster: 'foster',
	sealing: 'unknown',
	other: 'unknown'
} as const;

function deriveUnionStatus(fam: ParsedGedcomData['families'][number]): 'active' | 'divorced' {
	const hasDivorce = fam.events.some((e) => e.type === 'DIV');
	const hasAnnulment = fam.events.some((e) => e.type === 'ANUL');
	if (hasDivorce) return 'divorced';
	if (hasAnnulment) return 'divorced';
	return 'active';
}

/** Columns Drizzle writes for a `person_names` row; the insert is chunked by it under D1's parameter cap. */
const PERSON_NAME_COLUMNS = 23;

/** What makes two names the same for merge-mode de-duplication, as `eventContentKey` does for facts. */
function nameContentKey(
	type: string,
	n: {
		givenName?: string | null;
		surname?: string | null;
		namePrefix?: string | null;
		nameSuffix?: string | null;
		nickname?: string | null;
		surnamePrefix?: string | null;
	}
): string {
	return [type, n.givenName, n.surname, n.namePrefix, n.nameSuffix, n.nickname, n.surnamePrefix]
		.map((part) => part ?? '')
		.join('\u0000');
}

/**
 * Persist neutral-model rows for a parsed GEDCOM tree.
 * Callers are responsible for tree scoping IDs before invoking.
 *
 * Answers the citations of the names and child links it wrote, each against the stored row that now
 * holds it: a name or link a merge-mode import already had is the row its citations join.
 */
export async function importNeutralModel(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData
): Promise<CitationTarget[]> {
	const targets: CitationTarget[] = [];
	const scoped = (xrefOrId: string) => treeScopedId(treeId, xrefOrId);
	// One moment for every partnership of the file. Stored in whole seconds, a per-row default would
	// split copies of one family across a second boundary and, with their dates tied, decide which
	// is the "1st partnership" by the clock instead of by where they stand in the file.
	const importedAt = new Date();

	// 1. person_names: every NAME of the file, in file order; the first is the preferred one.
	// A merge import meets people who already have names, so a name is skipped when the person
	// already has one with the same content, and nobody gains a second preferred name.
	const known = new Map<string, Map<string, string>>();
	for (const row of await db
		.select({
			id: personNames.id,
			personId: personNames.personId,
			type: personNames.type,
			givenName: personNames.givenName,
			surname: personNames.surname,
			namePrefix: personNames.namePrefix,
			nameSuffix: personNames.nameSuffix,
			nickname: personNames.nickname,
			surnamePrefix: personNames.surnamePrefix
		})
		.from(personNames)
		.innerJoin(individuals, eq(personNames.personId, individuals.id))
		.where(eq(individuals.treeId, treeId))
		.all()) {
		const keys = known.get(row.personId) ?? new Map<string, string>();
		keys.set(nameContentKey(row.type, row), row.id);
		known.set(row.personId, keys);
	}

	const nameRows: Array<typeof personNames.$inferInsert> = [];
	for (const ind of parsed.individuals) {
		const personId = scoped(ind.id);
		const existing = known.get(personId);
		let order = 0;
		for (const name of ind.names ?? []) {
			// The family a name came from, by its own XREF or one it was merged under. A note that names a family the
			// file lacks stays as written, date and all, so export does not write it twice.
			const family = name.unionXref
				? parsed.families.find(
						(f) => f.id === name.unionXref || f.aliases?.includes(name.unionXref!)
					)
				: undefined;
			const extra =
				!family && name.changeNoteLine ? [name.changeNoteLine, ...name.extra] : name.extra;
			const key = nameContentKey(name.type, {
				givenName: name.givenName,
				surname: name.surname,
				namePrefix: name.prefix,
				nameSuffix: name.suffix,
				nickname: name.nickname,
				surnamePrefix: name.surnamePrefix
			});
			const knownId = existing?.get(key);
			if (knownId) {
				targets.push({
					kind: CITATION_SUBJECT_KINDS.NAME,
					id: knownId,
					citations: name.citations,
					notes: name.notes
				});
				continue;
			}
			const nameId = crypto.randomUUID();
			existing?.set(key, nameId);
			targets.push({
				kind: CITATION_SUBJECT_KINDS.NAME,
				id: nameId,
				citations: name.citations,
				notes: name.notes
			});
			nameRows.push({
				id: nameId,
				personId,
				type: name.type,
				givenName: name.givenName || null,
				surname: name.surname || null,
				namePrefix: name.prefix || null,
				nameSuffix: name.suffix || null,
				nickname: name.nickname || null,
				surnamePrefix: name.surnamePrefix || null,
				gedcomType: name.gedcomType || null,
				gedcomExtra: extra.length > 0 ? extra : null,
				...(name.dateText && (family || !name.unionXref)
					? { dateRaw: name.dateText, ...dateColumnsFor(name.dateText) }
					: {}),
				unionId: family ? scoped(family.id) : null,
				isPreferred: !existing && order === 0,
				order: order++
			});
		}
	}

	for (const chunk of chunkByParamLimit(nameRows, PERSON_NAME_COLUMNS)) {
		await db.insert(personNames).values(chunk).onConflictDoNothing();
	}

	// 2. unions + union_partners + parent_child per family
	const linkCitations: Array<{
		parentId: string;
		childId: string;
		type: string;
		citations: NonNullable<ParsedGedcomData['families'][number]['children'][number]['citations']>;
		notes: NonNullable<ParsedGedcomData['families'][number]['children'][number]['notes']>;
	}> = [];
	for (const fam of parsed.families) {
		const unionId = scoped(fam.id);
		const participants = [fam.husbandId, fam.wifeId].filter((id): id is string => Boolean(id));

		await db
			.insert(unions)
			.values({
				id: unionId,
				treeId,
				createdAt: importedAt,
				status: deriveUnionStatus(fam),
				xrefAliases: fam.aliases && fam.aliases.length > 0 ? fam.aliases : null
			})
			.onConflictDoNothing();

		const partnerRows = participants.map((personId, index) => ({
			id: crypto.randomUUID(),
			unionId,
			personId: scoped(personId),
			order: index
		}));
		for (const chunk of chunkByParamLimit(partnerRows, 4)) {
			await db.insert(unionPartners).values(chunk).onConflictDoNothing();
		}

		// Per-parent assertions: expand family-wide pedigree into per-parent type.
		for (const child of fam.children) {
			const childId = scoped(child.childId);
			if (
				participants.length > 0 &&
				((child.citations?.length ?? 0) > 0 || (child.notes?.length ?? 0) > 0)
			) {
				// The child's `FAMC` is one link to the family; its citations and notes belong to the first parent's row.
				linkCitations.push({
					parentId: scoped(participants[0]),
					childId,
					type: PEDIGREE_TO_TYPE[
						child.parentPedigrees?.[participants[0]] ?? child.pedigree ?? 'birth'
					],
					citations: child.citations ?? [],
					notes: child.notes ?? []
				});
			}

			for (const parentId of participants) {
				// PEDI is per link to the family; Epoch's `_PEDI_PARENT` refines it for one parent.
				const pedigree = child.parentPedigrees?.[parentId] ?? child.pedigree ?? 'birth';
				await db
					.insert(parentChild)
					.values({
						id: crypto.randomUUID(),
						treeId,
						parentId: scoped(parentId),
						childId,
						type: PEDIGREE_TO_TYPE[pedigree],
						gedcomPedi: pedigree === 'sealing' || pedigree === 'other' ? pedigree : null,
						status: 'active',
						unionId
					})
					.onConflictDoNothing();
			}
		}
	}

	if (linkCitations.length > 0) {
		// The row that holds each link now: a merge-mode import may have found it already stored.
		const stored = new Map(
			(
				await db
					.select({
						id: parentChild.id,
						parentId: parentChild.parentId,
						childId: parentChild.childId,
						type: parentChild.type
					})
					.from(parentChild)
					.where(eq(parentChild.treeId, treeId))
					.all()
			).map((row) => [`${row.parentId}|${row.childId}|${row.type}`, row.id])
		);
		for (const link of linkCitations) {
			const id = stored.get(`${link.parentId}|${link.childId}|${link.type}`);
			if (id)
				targets.push({
					kind: CITATION_SUBJECT_KINDS.PARENT_CHILD,
					id,
					citations: link.citations,
					notes: link.notes
				});
		}
	}

	// 3. Preserve unmodeled GEDCOM structures verbatim for lossless export.
	// A merge import meets structures it kept the last time; the same lines under the same owner are
	// not kept twice, or a root record would be written twice and its XREF would repeat.
	const kept = new Set(
		(
			await db
				.select({ owner: gedcomPreserved.ownerXref, lines: gedcomPreserved.lines })
				.from(gedcomPreserved)
				.where(eq(gedcomPreserved.treeId, treeId))
				.all()
		).map((r) => JSON.stringify([r.owner, r.lines]))
	);
	let order =
		(
			await db
				.select({ n: sql<number>`coalesce(max(${gedcomPreserved.order}), -1) + 1` })
				.from(gedcomPreserved)
				.where(eq(gedcomPreserved.treeId, treeId))
				.get()
		)?.n ?? 0;
	for (const entry of parsed.preserved) {
		const key = JSON.stringify([entry.xref, entry.lines]);
		if (kept.has(key)) continue;
		kept.add(key);
		await db
			.insert(gedcomPreserved)
			.values({
				id: crypto.randomUUID(),
				treeId,
				ownerXref: entry.xref,
				lines: entry.lines,
				order: order++
			})
			.onConflictDoNothing();
	}
	return targets;
}
