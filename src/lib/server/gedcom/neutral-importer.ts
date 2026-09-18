/**
 * Neutral-model importer: persists parsed GEDCOM into the Phase 1 neutral
 * tables (`unions`, `union_partners`, `parent_child`, `person_names`) alongside
 * the legacy tables.
 *
 * Identity is the tree-scoped GEDCOM XREF. A union is created for every family
 * record; each participant becomes an ordered `union_partner`; each child link
 * becomes per-parent `parent_child` assertions carrying the relationship type
 * derived from the family-wide pedigree. Repeated unions between the same
 * participants remain distinct because identity is the XREF, not the spouse
 * pair.
 */

import type { DbClient } from '../db';
import { unions, unionPartners, parentChild, personNames, gedcomPreserved } from '../db/schema';
import type { ParsedGedcomData } from './index';

const PEDIGREE_TO_TYPE = {
	birth: 'biological',
	adopted: 'adoptive',
	foster: 'foster'
} as const;

function deriveUnionStatus(fam: ParsedGedcomData['families'][number]): 'active' | 'divorced' {
	const hasDivorce = fam.events.some((e) => e.type === 'DIV');
	const hasAnnulment = fam.events.some((e) => e.type === 'ANUL');
	if (hasDivorce) return 'divorced';
	if (hasAnnulment) return 'divorced';
	return 'active';
}

/**
 * Persist neutral-model rows for a parsed GEDCOM tree.
 * Callers are responsible for tree scoping IDs before invoking.
 */
export async function importNeutralModel(
	db: DbClient,
	treeId: string,
	parsed: ParsedGedcomData
): Promise<void> {
	const scoped = (xrefOrId: string) =>
		xrefOrId.startsWith(`${treeId}:`) ? xrefOrId : `${treeId}:${xrefOrId}`;

	// 1. person_names (one preferred birth name per individual)
	const nameRows: Array<{
		id: string;
		personId: string;
		type: 'birth';
		givenName: string | null;
		surname: string | null;
		namePrefix: string | null;
		nameSuffix: string | null;
		isPreferred: boolean;
		order: number;
	}> = parsed.individuals.map((ind) => ({
		id: crypto.randomUUID(),
		personId: scoped(ind.id),
		type: 'birth',
		givenName: ind.givenName || null,
		surname: ind.surname || null,
		namePrefix: null,
		nameSuffix: null,
		isPreferred: true,
		order: 0
	}));

	for (const chunk of chunkRows(nameRows, 9)) {
		await db.insert(personNames).values(chunk).onConflictDoNothing();
	}

	// 2. unions + union_partners + parent_child per family
	for (const fam of parsed.families) {
		const unionId = scoped(fam.id);
		const participants = [fam.husbandId, fam.wifeId].filter((id): id is string => Boolean(id));

		await db
			.insert(unions)
			.values({
				id: unionId,
				treeId,
				status: deriveUnionStatus(fam)
			})
			.onConflictDoNothing();

		const partnerRows = participants.map((personId, index) => ({
			id: crypto.randomUUID(),
			unionId,
			personId: scoped(personId),
			order: index
		}));
		for (const chunk of chunkRows(partnerRows, 4)) {
			await db.insert(unionPartners).values(chunk).onConflictDoNothing();
		}

		// Per-parent assertions: expand family-wide pedigree into per-parent type.
		for (const child of fam.children) {
			const type = PEDIGREE_TO_TYPE[child.pedigree ?? 'birth'];
			const childId = scoped(child.childId);

			for (const parentId of participants) {
				await db
					.insert(parentChild)
					.values({
						id: crypto.randomUUID(),
						treeId,
						parentId: scoped(parentId),
						childId,
						type,
						status: 'active',
						unionId
					})
					.onConflictDoNothing();
			}
		}
	}

	// 3. Preserve unmodeled GEDCOM structures verbatim for lossless export.
	let order = 0;
	for (const entry of parsed.preserved) {
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
}

function chunkRows<T>(rows: T[], columnsPerRow: number): T[][] {
	const MAX_BOUND_PARAMS = 70;
	const maxRows = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columnsPerRow));
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += maxRows) {
		chunks.push(rows.slice(i, i + maxRows));
	}
	return chunks;
}
