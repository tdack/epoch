/**
 * Shapes a tree's stored rows into the payload the serializers write.
 *
 * Reads the neutral model only: unions become binary husband/wife GEDCOM
 * families (first two ordered participants), parent-child assertions collapse
 * back into family-wide children with a per-family pedigree derived from the
 * per-parent type. Pure, so the repository's reads and this shaping can each
 * be tested alone.
 */

import type {
	events,
	gedcomPreserved,
	individuals,
	parentChild,
	personNames,
	trees,
	unionPartners,
	unions
} from '../db';
import type { GedcomExportPayload } from './serializer';

/** Every row of one tree the export needs, as the repository reads them. */
export interface ExportRows {
	tree: typeof trees.$inferSelect | undefined;
	individuals: Array<typeof individuals.$inferSelect>;
	unions: Array<typeof unions.$inferSelect>;
	partners: Array<typeof unionPartners.$inferSelect>;
	parentChild: Array<typeof parentChild.$inferSelect>;
	/** In insertion order, so facts keep the order they were written in. */
	events: Array<typeof events.$inferSelect>;
	/** In insertion order, so names keep the order they were written in. */
	names: Array<typeof personNames.$inferSelect>;
	preserved: Array<typeof gedcomPreserved.$inferSelect>;
}

export function exportPayloadFrom(
	treeId: string,
	rows: ExportRows
): GedcomExportPayload & { treeName: string } {
	const tree = rows.tree;
	const treeInds = rows.individuals;
	const treeUnions = rows.unions;
	const treePartners = rows.partners;
	const treeAssertions = rows.parentChild;
	const treeEvents = rows.events;
	const treeNames = rows.names;
	const treePreserved = rows.preserved;

	const namesByPerson = new Map<string, typeof treeNames>();
	for (const n of treeNames)
		namesByPerson.set(n.personId, [...(namesByPerson.get(n.personId) ?? []), n]);

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
	const orderOfParent = (unionId: string, parentId: string) =>
		(partnersByUnion.get(unionId) ?? []).indexOf(parentId);

	type ExportedChild = {
		childId: string;
		pedigree: string | null;
		parentPedigrees?: Record<string, string>;
	};
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
		const ordered = [...links].sort(
			(a, b) => orderOfParent(unionId, a.parentId) - orderOfParent(unionId, b.parentId)
		);
		const first = pedigreeOf(ordered[0]);
		const parentPedigrees: Record<string, string> = {};
		for (const link of ordered.slice(1)) {
			if (pedigreeOf(link) !== first)
				parentPedigrees[indXrefMap.get(link.parentId) || link.parentId] = pedigreeOf(link);
		}
		childrenByUnion.set(unionId, [
			...(childrenByUnion.get(unionId) ?? []),
			{
				childId,
				pedigree: first,
				...(Object.keys(parentPedigrees).length > 0 ? { parentPedigrees } : {})
			}
		]);
	}

	// Map stored XREFs to export IDs so preserved lines re-attach to their owner.
	const xrefToExportId = new Map<string, string>();
	for (const xref of indXrefMap.values()) {
		if (xref) xrefToExportId.set(xref, xref);
	}
	for (const xref of famXrefMap.values()) {
		if (xref) xrefToExportId.set(xref, xref);
	}
	// Structures preserved under a merged-away family or person re-attach to the record that absorbed it.
	for (const u of treeUnions) {
		for (const alias of u.xrefAliases ?? [])
			xrefToExportId.set(alias, famXrefMap.get(u.id) ?? u.id);
	}
	for (const ind of treeInds) {
		for (const alias of ind.xrefAliases ?? [])
			xrefToExportId.set(alias, indXrefMap.get(ind.id) || ind.id);
	}

	// Every pointer in a retained line (a FAMC, an ASSO, a custom tag, a kept citation) follows the
	// record that absorbed the one it names, so export never writes a pointer to a record that is gone.
	const remap = (line: string) =>
		line.replace(/@[^@\s]+@/g, (token) => xrefToExportId.get(token) ?? token);
	const withKeptLines = (list: typeof treeEvents) =>
		list.map((ev) =>
			ev.gedcomExtra?.length ? { ...ev, gedcomExtra: ev.gedcomExtra.map(remap) } : ev
		);

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
					// Before S6 the person form edited `individuals` and left the imported name row alone; where the two
					// still differ the person's own fields are the edited ones (ADR-013).
					.map((n) =>
						n.isPreferred ? { ...n, givenName: ind.givenName, surname: ind.surname } : n
					)
					.map((n) => ({
						type: n.type,
						gedcomType: n.gedcomType,
						givenName: n.givenName,
						surname: n.surname,
						prefix: n.namePrefix,
						suffix: n.nameSuffix,
						nickname: n.nickname,
						surnamePrefix: n.surnamePrefix,
						dateText: n.dateRaw,
						unionXref: n.unionId ? (famXrefMap.get(n.unionId) ?? null) : null,
						extra: n.gedcomExtra?.map(remap) ?? null
					})),
				sex: ind.sex,
				privacy: ind.privacy,
				events: withKeptLines(eventsByEntity[ind.id] || []),
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
				husbandId: husbandId ? indXrefMap.get(husbandId) || husbandId : null,
				wifeId: wifeId ? indXrefMap.get(wifeId) || wifeId : null,
				children: (childrenByUnion.get(u.id) || []).map((c) => ({
					childId: indXrefMap.get(c.childId) || c.childId,
					pedigree: c.pedigree,
					...(c.parentPedigrees ? { parentPedigrees: c.parentPedigrees } : {})
				})),
				...(u.xrefAliases && u.xrefAliases.length > 0 ? { aliases: u.xrefAliases } : {}),
				events: withKeptLines(eventsByEntity[u.id] || [])
			};
		}),
		preserved: treePreserved
			.slice()
			.sort((a, b) => a.order - b.order)
			.map((p) => {
				return {
					xref: p.ownerXref ? (xrefToExportId.get(p.ownerXref) ?? p.ownerXref) : null,
					lines: (p.lines as unknown as string[]).map(remap)
				};
			})
	};
}
