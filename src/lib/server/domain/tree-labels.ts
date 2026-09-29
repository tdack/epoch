/**
 * Names for rows in previews and the change log: "Homer Simpson", "Homer Simpson–Marge Simpson
 * partnership", "Death of Homer Simpson". Labels are computed from the tree as it was before a
 * change plus the rows the change creates, so a deleted person is still named.
 */

import {
	type EventRow,
	type IndividualRow,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TreeRows,
	type UnionPartnerRow
} from './change-log';
import { personName, applyOpsToRows } from './tree-ops';
import { UNION_EVENT_LABELS, isUnionEventType } from '../../shared/union-events';

const EVENT_LABELS: Record<string, string> = {
	BIRT: 'Birth',
	DEAT: 'Death',
	BURI: 'Burial',
	CHR: 'Christening',
	...UNION_EVENT_LABELS
};

export function eventLabel(type: string): string {
	if (isUnionEventType(type)) return UNION_EVENT_LABELS[type];
	return EVENT_LABELS[type] ?? type;
}

export type RowLabeler = (table: RecordTable, image: RowImage) => string;

/** A labeller over the tree before `ops` and the rows `ops` create. */
export function makeLabeler(rows: TreeRows, ops: RowOp[]): RowLabeler {
	// Deleted rows only exist in `rows`; created ones only in the ops' after images.
	const known = applyOpsToRows(rows, ops.filter((op) => op.after !== null && op.before === null));
	const people = new Map<string, IndividualRow>(known.individuals.map((p) => [p.id, p]));
	const partnersByUnion = new Map<string, UnionPartnerRow[]>();
	for (const partner of known.unionPartners) {
		partnersByUnion.set(partner.unionId, [...(partnersByUnion.get(partner.unionId) ?? []), partner]);
	}

	const person = (id: string) => personName(people.get(id));
	const union = (id: string) => {
		const members = (partnersByUnion.get(id) ?? []).sort((a, b) => a.order - b.order).map((p) => person(p.personId));
		return members.length > 0 ? `${members.join('–')} partnership` : 'partnership';
	};

	return (table, image) => {
		const row = image as Record<string, any>;
		switch (table) {
			case 'individuals':
				return personName(row as IndividualRow);
			case 'person_names':
				return `Name of ${person(row.personId)}`;
			case 'unions':
				return union(row.id);
			case 'union_partners':
				return `${person(row.personId)} in the ${union(row.unionId)}`;
			case 'parent_child': {
				const kind = row.type === 'unknown' ? '' : `${row.type} `;
				return `${person(row.parentId)} as ${kind}parent of ${person(row.childId)}`;
			}
			case 'events': {
				const event = row as EventRow;
				const owner = event.entityType === 'FAMILY' ? union(event.entityId) : person(event.entityId);
				return `${eventLabel(event.type)} of ${owner}`;
			}
			case 'media_items':
				return `Attachment of ${person(row.entityId)}`;
		}
	};
}
