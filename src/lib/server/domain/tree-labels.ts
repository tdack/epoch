/**
 * Names for rows in previews and the change log: "Homer Simpson", "Homer Simpson–Marge Simpson
 * partnership", "Death of Homer Simpson". Labels are computed from the tree as it was before a
 * change plus the rows the change creates, so a deleted person is still named.
 */

import {
	type EventRow,
	type IndividualRow,
	type PersonNameRow,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TreeRows,
	type UnionPartnerRow
} from './change-log';
import { personName, applyOpsToRows, labelableUnionsOf } from './tree-ops';
import { displayNameWith } from '../../shared/name-types';
import { factLabel } from '../../shared/fact-types';
import { NAME_TYPE_LABELS, formatFullName, type NameType } from '../../shared/name-types';
import { UNION_EVENT_LABELS, isUnionEventType } from '../../shared/union-events';
import { ordinal as ordinalOf, partnershipLabels } from '../../shared/partnership-labels';

export function eventLabel(type: string): string {
	if (isUnionEventType(type)) return UNION_EVENT_LABELS[type];
	return factLabel(type);
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

	// Two partnerships between the same pair share a name, so a preview could not say which one
	// goes; the chronological label tells them apart.
	const chronology = partnershipLabels(labelableUnionsOf(known));

	const namesOfPerson = new Map<string, PersonNameRow[]>();
	for (const n of known.personNames) namesOfPerson.set(n.personId, [...(namesOfPerson.get(n.personId) ?? []), n]);
	const person = (id: string) => displayNameWith(people.get(id), namesOfPerson.get(id));
	const nameOfUnion = (id: string) => {
		const members = (partnersByUnion.get(id) ?? []).sort((a, b) => a.order - b.order).map((p) => person(p.personId));
		return members.length > 0 ? `${members.join('–')} partnership` : 'partnership';
	};
	// Records with a single partner have no chronology, but two of them still share a name; number them.
	const sameName = new Map<string, string[]>();
	for (const u of known.unions) sameName.set(nameOfUnion(u.id), [...(sameName.get(nameOfUnion(u.id)) ?? []), u.id]);
	const union = (id: string) => {
		const name = nameOfUnion(id);
		const label = chronology.get(id);
		const twins = (sameName.get(name) ?? []).sort();
		if (!label) return twins.length > 1 ? `${name} (${twins.indexOf(id) + 1} of ${twins.length})` : name;
		return `${name} (${ordinalOf(label.position)} of ${label.total}${label.dates ? `, ${label.dates}` : ''})`;
	};

	return (table, image) => {
		const row = image as Record<string, any>;
		switch (table) {
			case 'individuals':
				return personName(row as IndividualRow);
			case 'person_names':
				return `${NAME_TYPE_LABELS[(row.type as NameType) ?? 'other'] ?? 'Name'} ${formatFullName({ prefix: row.namePrefix, givenName: row.givenName, surnamePrefix: row.surnamePrefix, surname: row.surname, suffix: row.nameSuffix })} of ${person(row.personId)}`;
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
				// Two occupations or residences share a name, so a preview names the one it means.
				const detail = event.value ? ` (${event.value})` : '';
				return `${eventLabel(event.type)}${detail} of ${owner}`;
			}
			case 'media_items':
				return `Attachment of ${person(row.entityId)}`;
		}
	};
}
