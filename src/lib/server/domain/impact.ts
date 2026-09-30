/**
 * The preview of a change: exactly which people, partnerships, links and events it creates,
 * updates or deletes. Computed from the ops that will be written, so the list cannot drift from
 * what the save does.
 */

import { describeOps, type RecordChange, type RowOp, type TreeRows } from './change-log';
import { ENTITY_ORDER, groupRecords } from '../../shared/impact-groups';
import { makeLabeler } from './tree-labels';

export { groupRecords };
import { displayNameOf, personName } from './tree-ops';

export const PERSON_ROLES_IN_IMPACT = { DELETED: 'deleted', CREATED: 'created', AFFECTED: 'affected' } as const;
export type ImpactPersonRole = (typeof PERSON_ROLES_IN_IMPACT)[keyof typeof PERSON_ROLES_IN_IMPACT];

export interface ImpactPerson {
	id: string;
	name: string;
	role: ImpactPersonRole;
}

/** A record that stays and is regrouped under another partnership: shown as a move, not an edit. */
export interface ImpactMove {
	entityType: 'link' | 'event';
	entityId: string;
	label: string;
	from: string;
	to: string;
}

export interface ImpactSummary {
	/** One line: what is being done. */
	headline: string;
	/** Every record written, in the order a person would read them. */
	records: RecordChange[];
	/** Links and events that change partnership, so a merge reads "moved from X to Y". */
	moves: ImpactMove[];
	/** People deleted or created by the change, and people whose relationships or events change. */
	people: ImpactPerson[];
	/** True when the change deletes any record. */
	isDestructive: boolean;
}

/** Every person a row belongs to or points at; a partnership belongs to its partners. */
function peopleOf(op: RowOp, partnersOf: (unionId: string) => string[]): string[] {
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
		}
}

export function describeImpact(headline: string, rows: TreeRows, ops: RowOp[]): ImpactSummary {
	const labeler = makeLabeler(rows, ops);
	const records = describeOps(ops, labeler).sort(
		(a, b) => ENTITY_ORDER.indexOf(a.entityType) - ENTITY_ORDER.indexOf(b.entityType)
	);

	const names = new Map(rows.individuals.map((p) => [p.id, displayNameOf(rows, p.id)]));
	for (const op of ops) if (op.table === 'individuals' && op.after) names.set(op.id, personName(op.after as any));

	// Partners as they are before the change plus those it adds, so a deleted partnership still names them.
	const partnerIds = new Map<string, string[]>();
	for (const p of rows.unionPartners) partnerIds.set(p.unionId, [...(partnerIds.get(p.unionId) ?? []), p.personId]);
	for (const op of ops) {
		if (op.table === 'union_partners' && op.before === null) {
			const row = op.after as { unionId: string; personId: string };
			partnerIds.set(row.unionId, [...(partnerIds.get(row.unionId) ?? []), row.personId]);
		}
	}
	const partnersOf = (unionId: string) => partnerIds.get(unionId) ?? [];

	const roles = new Map<string, ImpactPersonRole>();
	for (const op of ops) {
		if (op.table === 'individuals' && op.before === null) roles.set(op.id, PERSON_ROLES_IN_IMPACT.CREATED);
		else if (op.table === 'individuals' && op.after === null) roles.set(op.id, PERSON_ROLES_IN_IMPACT.DELETED);
	}
	for (const op of ops) {
		for (const id of peopleOf(op, partnersOf)) if (!roles.has(id)) roles.set(id, PERSON_ROLES_IN_IMPACT.AFFECTED);
	}
	const people = [...roles].map(([id, role]) => ({ id, name: names.get(id) ?? 'Unknown', role }));

	const unionLabel = (id: unknown) => (typeof id === 'string' ? labeler('unions', { id }) : 'no partnership');
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
