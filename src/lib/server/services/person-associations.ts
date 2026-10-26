/**
 * A person's associations (`ASSO`) in both directions: the ones their own record and facts name,
 * and the ones on someone else's record or fact that name them (webtrees shows both). Nobody the
 * viewer may not see is named, in either direction.
 */

import type { EventRow, IndividualRow } from '../domain/change-log';
import { associationsIn } from '../domain/associations';
import type { RelationshipGraph } from '../../shared/relationship-graph';
import { AssociationRepository } from '../repositories/association-repository';
import type { GraphWindowRepository } from '../repositories/graph-window-repository';
import { visibleAmong } from '../repositories/visibility';
import { factLabel } from '../../shared/fact-types';
import { isUnionEventType, UNION_EVENT_LABELS } from '../../shared/union-events';
import type { AssociationDto } from '../../shared/person-page';
import { personSummaries } from './person-summaries';
import type { ViewerScope } from './tree-access';

interface Found {
	/** The other person, by XREF or, for a partnership's fact, by id. */
	xref?: string;
	personId?: string;
	role: string | null;
	factType: string | null;
	isNamedBy: boolean;
}

export async function personAssociations(
	repo: GraphWindowRepository,
	treeId: string,
	self: IndividualRow,
	ownFacts: readonly EventRow[],
	unionIds: readonly string[],
	graph: RelationshipGraph,
	scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>
): Promise<AssociationDto[]> {
	const store = new AssociationRepository(repo.client);
	const mine = new Set([self.xrefId, ...(self.xrefAliases ?? [])].filter((x) => x !== null));
	const xrefs = [...mine];
	const [[unionFacts], blocks, naming] = await Promise.all([
		repo.run(repo.eventsOf(treeId, 'FAMILY', unionIds)),
		store.keptBlocks(treeId, xrefs),
		store.factsNaming(treeId, xrefs)
	]);
	const found: Found[] = [];

	for (const block of blocks) {
		const isOwn = block.ownerXref !== null && mine.has(block.ownerXref);
		for (const a of associationsIn(block.lines)) {
			if (isOwn && !mine.has(a.pointer))
				found.push({ xref: a.pointer, role: a.role, factType: null, isNamedBy: false });
			else if (!isOwn && mine.has(a.pointer) && block.ownerXref)
				found.push({ xref: block.ownerXref, role: a.role, factType: null, isNamedBy: true });
		}
	}

	const ownIds = new Set<string>();
	for (const fact of [...ownFacts, ...unionFacts.map((f) => f.row)]) {
		ownIds.add(fact.id);
		for (const a of associationsIn(fact.gedcomExtra ?? []))
			if (!mine.has(a.pointer))
				found.push({ xref: a.pointer, role: a.role, factType: fact.type, isNamedBy: false });
	}

	const theirs = naming.filter((f) => !ownIds.has(f.id));
	const [partners] = await repo.run(
		repo.partnerRowsOfUnions(
			treeId,
			theirs.filter((f) => f.entityType === 'FAMILY').map((f) => f.entityId)
		)
	);
	for (const fact of theirs) {
		const owners =
			fact.entityType === 'INDIVIDUAL'
				? [fact.entityId]
				: partners.filter((p) => p.row.unionId === fact.entityId).map((p) => p.row.personId);
		for (const a of associationsIn(fact.gedcomExtra ?? []))
			if (mine.has(a.pointer))
				for (const personId of owners)
					found.push({ personId, role: a.role, factType: fact.type, isNamedBy: true });
	}

	const byXref = await store.peopleByXref(
		treeId,
		found.flatMap((f) => (f.xref ? [f.xref] : []))
	);
	const resolved = found.flatMap((f) => {
		const personId = f.personId ?? byXref.get(f.xref!);
		return personId && personId !== self.id ? [{ ...f, personId }] : [];
	});
	const seen = await visibleAmong(
		repo.client,
		treeId,
		resolved.map((f) => f.personId),
		scope
	);
	const shown = resolved.filter((f) => seen.has(f.personId));
	const summaries = await personSummaries(
		repo,
		treeId,
		graph,
		shown.map((f) => f.personId),
		scope
	);
	// A file can say the same thing twice (both partners' copies of a family fact, say).
	const keys = new Set<string>();
	return shown.flatMap((f) => {
		const key = JSON.stringify([f.personId, f.role, f.factType, f.isNamedBy]);
		if (keys.has(key)) return [];
		keys.add(key);
		return [
			{
				person: summaries.get(f.personId)!,
				role: f.role,
				factLabel: !f.factType
					? null
					: isUnionEventType(f.factType)
						? UNION_EVENT_LABELS[f.factType]
						: factLabel(f.factType),
				isNamedBy: f.isNamedBy
			}
		];
	});
}
