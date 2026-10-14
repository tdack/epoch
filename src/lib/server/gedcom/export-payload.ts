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
	citations,
	events,
	gedcomPreserved,
	individuals,
	noteAttachments,
	notes,
	parentChild,
	personNames,
	repositories,
	sourceRepositories,
	sources,
	trees,
	unionPartners,
	unions
} from '../db';
import { CITATION_SUBJECT_KINDS, type CitationSubjectKind } from '../../shared/evidence';
import { NOTE_SUBJECT_KINDS, type NoteSubjectKind } from '../../shared/notes';
import type { ExportCitation, ExportNote, GedcomExportPayload } from './serializer';

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
	sources: Array<typeof sources.$inferSelect>;
	repositories: Array<typeof repositories.$inferSelect>;
	/** In link order within each source. */
	sourceRepositories: Array<typeof sourceRepositories.$inferSelect>;
	citations: Array<typeof citations.$inferSelect>;
	notes: Array<typeof notes.$inferSelect>;
	noteAttachments: Array<typeof noteAttachments.$inferSelect>;
}

/** A retained entry that is a whole level-0 record, not a structure kept under a person or family. */
function isRootRecord(entry: { lines: unknown }): boolean {
	return (entry.lines as string[])[0]?.startsWith('0 ') ?? false;
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
	// The lookbehind keeps an escaped `@@I1@` (model text the file wrote) out of the remap.
	const remap = (line: string) =>
		line.replace(/(?<!@)@[^@\s]+@/g, (token) => xrefToExportId.get(token) ?? token);
	// ---- Notes (ADR-029) ----
	const noteById = new Map(rows.notes.map((n) => [n.id, n] as const));
	const noteXrefs = new Map(rows.notes.map((n) => [n.id, n.xref ?? `@${n.id}@`] as const));
	const notesOf = new Map<string, ExportNote[]>();
	for (const a of [...rows.noteAttachments].sort((x, y) => x.sortOrder - y.sortOrder)) {
		const shared = a.noteId ? noteById.get(a.noteId) : undefined;
		// An attachment of a note that is gone is not written: it could only be a pointer at nothing.
		if (a.noteId && !shared) continue;
		const key = `${a.subjectKind}|${a.subjectId}`;
		const list = notesOf.get(key) ?? [];
		list.push({
			pointer: shared ? noteXrefs.get(shared.id)! : a.noteRef,
			pointerTag: shared ? (shared.gedcomTag ?? 'SNOTE') : (a.gedcomTag ?? 'NOTE'),
			text: a.text,
			layout: a.gedcomLayout,
			extra: a.gedcomExtra?.map(remap) ?? null
		});
		notesOf.set(key, list);
	}
	const notesFor = (kind: NoteSubjectKind, id: string) => notesOf.get(`${kind}|${id}`) ?? [];
	/** A child's FAMC is one link held on one row per parent: write each distinct note once. */
	const linkNotes = (links: Array<{ id: string }>) => {
		const seen = new Set<string>();
		return links
			.flatMap((l) => notesFor(NOTE_SUBJECT_KINDS.PARENT_CHILD, l.id))
			.filter((n) => {
				const key = JSON.stringify(n);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
	};

	// ---- Evidence (ADR-028) ----
	const sourceXrefs = new Map(rows.sources.map((s) => [s.id, s.xref ?? `@${s.id}@`] as const));
	const repositoryXrefs = new Map(
		rows.repositories.map((r) => [r.id, r.xref ?? `@${r.id}@`] as const)
	);
	const citationsOf = new Map<string, ExportCitation[]>();
	for (const c of [...rows.citations].sort((a, b) => a.sortOrder - b.sortOrder)) {
		const key = `${c.subjectKind}|${c.subjectId}`;
		const list = citationsOf.get(key) ?? [];
		list.push({
			pointer: c.sourceId ? (sourceXrefs.get(c.sourceId) ?? null) : c.sourceRef,
			description: c.description,
			page: c.page,
			quality: c.quality,
			entryDate: c.entryDateRaw,
			text: c.text,
			layout: c.gedcomLayout,
			extra: c.gedcomExtra?.map(remap) ?? null,
			notes: notesFor(NOTE_SUBJECT_KINDS.CITATION, c.id)
		});
		citationsOf.set(key, list);
	}
	const citationsFor = (kind: CitationSubjectKind, id: string) =>
		citationsOf.get(`${kind}|${id}`) ?? [];
	/** A child's FAMC is one link held on one row per parent: write each distinct citation once. */
	const linkCitations = (links: Array<{ id: string }>) => {
		const seen = new Set<string>();
		return links
			.flatMap((l) => citationsFor(CITATION_SUBJECT_KINDS.PARENT_CHILD, l.id))
			.filter((c) => {
				const key = JSON.stringify(c);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
	};
	const linksOfSource = new Map<string, typeof rows.sourceRepositories>();
	for (const link of [...rows.sourceRepositories].sort((a, b) => a.sortOrder - b.sortOrder))
		linksOfSource.set(link.sourceId, [...(linksOfSource.get(link.sourceId) ?? []), link]);
	// A record kept as lines before it was modelled is superseded by its row, so it is never written twice.
	const modelledXrefs = new Set(
		[...rows.sources, ...rows.repositories, ...rows.notes].flatMap((r) => (r.xref ? [r.xref] : []))
	);

	const withKeptLines = (list: typeof treeEvents) =>
		list.map((ev) => ({
			...ev,
			...(ev.gedcomExtra?.length ? { gedcomExtra: ev.gedcomExtra.map(remap) } : {}),
			// The place's sub-lines and the address's own lines can name a record too (a NOTE or SOUR pointer).
			...(ev.placeExtra?.length ? { placeExtra: ev.placeExtra.map(remap) } : {}),
			...(ev.addressLayout?.length ? { addressLayout: ev.addressLayout.map(remap) } : {}),
			citations: citationsFor(CITATION_SUBJECT_KINDS.EVENT, ev.id),
			noteLinks: notesFor(NOTE_SUBJECT_KINDS.EVENT, ev.id)
		}));

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
						extra: n.gedcomExtra?.map(remap) ?? null,
						citations: citationsFor(CITATION_SUBJECT_KINDS.NAME, n.id),
						notes: notesFor(NOTE_SUBJECT_KINDS.NAME, n.id)
					})),
				sex: ind.sex,
				privacy: ind.privacy,
				citations: citationsFor(CITATION_SUBJECT_KINDS.PERSON, ind.id),
				notes: notesFor(NOTE_SUBJECT_KINDS.PERSON, ind.id),
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
					...(c.parentPedigrees ? { parentPedigrees: c.parentPedigrees } : {}),
					citations: linkCitations(linksByChildUnion.get(`${u.id}|${c.childId}`) ?? []),
					notes: linkNotes(linksByChildUnion.get(`${u.id}|${c.childId}`) ?? [])
				})),
				...(u.xrefAliases && u.xrefAliases.length > 0 ? { aliases: u.xrefAliases } : {}),
				events: withKeptLines(eventsByEntity[u.id] || []),
				citations: citationsFor(CITATION_SUBJECT_KINDS.UNION, u.id),
				notes: notesFor(NOTE_SUBJECT_KINDS.UNION, u.id)
			};
		}),
		sources: rows.sources.map((s) => ({
			xref: sourceXrefs.get(s.id)!,
			title: s.title,
			author: s.author,
			publication: s.publication,
			abbreviation: s.abbreviation,
			text: s.text,
			layout: s.gedcomLayout,
			extra: s.gedcomExtra?.map(remap) ?? null,
			notes: notesFor(NOTE_SUBJECT_KINDS.SOURCE, s.id),
			repositories: (linksOfSource.get(s.id) ?? []).map((link) => ({
				pointer: link.repositoryId
					? (repositoryXrefs.get(link.repositoryId) ?? null)
					: link.repositoryRef,
				callNumber: link.callNumber,
				extra: link.gedcomExtra?.map(remap) ?? null
			}))
		})),
		repositories: rows.repositories.map((r) => ({
			xref: repositoryXrefs.get(r.id)!,
			name: r.name,
			address: r.address,
			layout: r.gedcomLayout,
			extra: r.gedcomExtra?.map(remap) ?? null,
			notes: notesFor(NOTE_SUBJECT_KINDS.REPOSITORY, r.id)
		})),
		notes: rows.notes.map((n) => ({
			xref: noteXrefs.get(n.id)!,
			tag: n.gedcomTag ?? ('SNOTE' as const),
			text: n.text,
			mime: n.mime,
			language: n.language,
			layout: n.gedcomLayout,
			extra: n.gedcomExtra?.map(remap) ?? null
		})),
		preserved: treePreserved
			.slice()
			.sort((a, b) => a.order - b.order)
			.filter((p) => !(p.ownerXref !== null && modelledXrefs.has(p.ownerXref) && isRootRecord(p)))
			.map((p) => {
				return {
					xref: p.ownerXref ? (xrefToExportId.get(p.ownerXref) ?? p.ownerXref) : null,
					lines: (p.lines as unknown as string[]).map(remap)
				};
			})
	};
}
