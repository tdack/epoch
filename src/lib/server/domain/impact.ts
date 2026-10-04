/**
 * The preview of a change: exactly which people, partnerships, links and events it creates,
 * updates or deletes. Computed from the ops that will be written, so the list cannot drift from
 * what the save does.
 */

import { describeOps, type RowOp, type TreeRows } from './change-log';
import {
	PERSON_ROLES_IN_IMPACT,
	type ImpactMove,
	type ImpactPersonRole,
	type ImpactSummary
} from '../../shared/impact';
import { ENTITY_ORDER } from '../../shared/impact-groups';
import { makeLabeler } from './tree-labels';

import { displayNameOf, personName } from './tree-ops';

/** Every person a row belongs to or points at; a partnership belongs to its partners. */
function peopleOf(
	op: RowOp,
	partnersOf: (unionId: string) => string[],
	subjectPeople: (kind: string, id: string) => string[]
): string[] {
	const row = (op.after ?? op.before) as Record<string, any>;
	switch (op.table) {
		case 'individuals':
			return [op.id];
		case 'unions':
			return partnersOf(op.id);
		case 'person_names':
			return [row.personId];
		case 'union_partners':
			return [row.personId];
		case 'parent_child':
			return [row.parentId, row.childId];
		case 'events':
			return row.entityType === 'INDIVIDUAL' ? [row.entityId] : partnersOf(row.entityId);
		case 'media_items':
			return [row.entityId];
		case 'citations':
		case 'note_attachments':
			return subjectPeople(row.subjectKind, row.subjectId);
		case 'sources':
		case 'repositories':
		case 'source_repositories':
		case 'notes':
		case 'research_tasks':
			// Records of the library, not of any person; who they matter to is what cites or attaches them.
			return [];
	}
}

export function describeImpact(headline: string, rows: TreeRows, ops: RowOp[]): ImpactSummary {
	const labeler = makeLabeler(rows, ops);
	const records = describeOps(ops, labeler).sort(
		(a, b) => ENTITY_ORDER.indexOf(a.entityType) - ENTITY_ORDER.indexOf(b.entityType)
	);

	const names = new Map(rows.individuals.map((p) => [p.id, displayNameOf(rows, p.id)]));
	for (const op of ops)
		if (op.table === 'individuals' && op.after) names.set(op.id, personName(op.after as any));

	// Partners as they are before the change plus those it adds, so a deleted partnership still names them.
	const partnerIds = new Map<string, string[]>();
	for (const p of rows.unionPartners)
		partnerIds.set(p.unionId, [...(partnerIds.get(p.unionId) ?? []), p.personId]);
	for (const op of ops) {
		if (op.table === 'union_partners' && op.before === null) {
			const row = op.after as { unionId: string; personId: string };
			partnerIds.set(row.unionId, [...(partnerIds.get(row.unionId) ?? []), row.personId]);
		}
	}
	const partnersOf = (unionId: string) => partnerIds.get(unionId) ?? [];

	// The people a citation is about, from its subject, whether the change creates, keeps or deletes it.
	const subjectRows = new Map<string, Record<string, any>>();
	const remember = (kind: string, list: Array<{ id: string }>) =>
		list.forEach((r) => subjectRows.set(`${kind}|${r.id}`, r as Record<string, any>));
	remember('name', rows.personNames);
	remember('event', rows.events);
	remember('parent_child', rows.parentChild);
	remember('citation', rows.citations);
	for (const op of ops) {
		const kind = {
			person_names: 'name',
			events: 'event',
			parent_child: 'parent_child',
			citations: 'citation'
		}[op.table as string];
		if (kind && op.after) subjectRows.set(`${kind}|${op.id}`, op.after);
	}
	const subjectPeople = (kind: string, id: string): string[] => {
		if (kind === 'person') return [id];
		if (kind === 'union') return partnersOf(id);
		const row = subjectRows.get(`${kind}|${id}`);
		if (!row) return [];
		// A note on a citation is about whoever the citation is.
		if (kind === 'citation') return subjectPeople(row.subjectKind, row.subjectId);
		if (kind === 'name') return [row.personId];
		if (kind === 'event')
			return row.entityType === 'INDIVIDUAL' ? [row.entityId] : partnersOf(row.entityId);
		return [row.parentId, row.childId];
	};

	const roles = new Map<string, ImpactPersonRole>();
	for (const op of ops) {
		if (op.table === 'individuals' && op.before === null)
			roles.set(op.id, PERSON_ROLES_IN_IMPACT.CREATED);
		else if (op.table === 'individuals' && op.after === null)
			roles.set(op.id, PERSON_ROLES_IN_IMPACT.DELETED);
	}
	for (const op of ops) {
		for (const id of peopleOf(op, partnersOf, subjectPeople))
			if (!roles.has(id)) roles.set(id, PERSON_ROLES_IN_IMPACT.AFFECTED);
	}
	const people = [...roles].map(([id, role]) => ({ id, name: names.get(id) ?? 'Unknown', role }));

	const unionLabel = (id: unknown) =>
		typeof id === 'string' ? labeler('unions', { id }) : 'no partnership';
	const moves: ImpactMove[] = [];
	for (const op of ops) {
		if (!op.before || !op.after) continue;
		const [from, to] =
			op.table === 'parent_child'
				? [op.before.unionId, op.after.unionId]
				: op.table === 'events' && op.before.entityType === 'FAMILY'
					? [op.before.entityId, op.after.entityId]
					: [null, null];
		if (from === to) continue;
		moves.push({
			entityType: op.table === 'events' ? 'event' : 'link',
			entityId: op.id,
			label: labeler(op.table, op.after),
			from: unionLabel(from),
			to: unionLabel(to)
		});
	}

	return {
		headline,
		records,
		moves,
		people,
		isDestructive: records.some((r) => r.action === 'deleted')
	};
}
