/**
 * Names for rows in previews and the change log: "John Smith", "John Smith–Jane Smith
 * partnership", "Death of John Smith". Labels are computed from the tree as it was before a
 * change plus the rows the change creates, so a deleted person is still named.
 */

import {
	type IndividualRow,
	type PersonNameRow,
	type RecordTable,
	type RowImage,
	type RowOp,
	type TableRow,
	type TreeRows,
	type UnionPartnerRow
} from './change-log';
import { personName, applyOpsToRows, labelableUnionsOf } from './tree-ops';
import { displayNameWith } from '../../shared/name-types';
import { factLabel } from '../../shared/fact-types';
import { NAME_TYPE_LABELS, formatFullName, type NameType } from '../../shared/name-types';
import { UNION_EVENT_LABELS, isUnionEventType } from '../../shared/union-events';
import { ordinal as ordinalOf, partnershipLabels } from '../../shared/partnership-labels';
import { CITATION_SUBJECT_KINDS, sourceLabel } from '../../shared/evidence';
import { NOTE_SUBJECT_KINDS, noteTitle } from '../../shared/notes';

export function eventLabel(type: string): string {
	if (isUnionEventType(type)) return UNION_EVENT_LABELS[type];
	return factLabel(type);
}

export type RowLabeler = (table: RecordTable, image: RowImage) => string;

/** A labeller over the tree before `ops` and the rows `ops` create. */
export function makeLabeler(rows: TreeRows, ops: RowOp[]): RowLabeler {
	// Deleted rows only exist in `rows`; created ones only in the ops' after images.
	const known = applyOpsToRows(
		rows,
		ops.filter((op) => op.after !== null && op.before === null)
	);
	const people = new Map<string, IndividualRow>(known.individuals.map((p) => [p.id, p]));
	const partnersByUnion = new Map<string, UnionPartnerRow[]>();
	for (const partner of known.unionPartners) {
		partnersByUnion.set(partner.unionId, [
			...(partnersByUnion.get(partner.unionId) ?? []),
			partner
		]);
	}

	// Two partnerships between the same pair share a name, so a preview could not say which one
	// goes; the chronological label tells them apart.
	const chronology = partnershipLabels(labelableUnionsOf(known));

	const namesOfPerson = new Map<string, PersonNameRow[]>();
	for (const n of known.personNames)
		namesOfPerson.set(n.personId, [...(namesOfPerson.get(n.personId) ?? []), n]);
	const person = (id: string) => displayNameWith(people.get(id), namesOfPerson.get(id));
	const nameOfUnion = (id: string) => {
		const members = (partnersByUnion.get(id) ?? [])
			.sort((a, b) => a.order - b.order)
			.map((p) => person(p.personId));
		return members.length > 0 ? `${members.join('–')} partnership` : 'partnership';
	};
	// Records with a single partner have no chronology, but two of them still share a name; number them.
	const sameName = new Map<string, string[]>();
	for (const u of known.unions)
		sameName.set(nameOfUnion(u.id), [...(sameName.get(nameOfUnion(u.id)) ?? []), u.id]);
	const union = (id: string) => {
		const name = nameOfUnion(id);
		const label = chronology.get(id);
		const twins = (sameName.get(name) ?? []).sort();
		if (!label)
			return twins.length > 1 ? `${name} (${twins.indexOf(id) + 1} of ${twins.length})` : name;
		return `${name} (${ordinalOf(label.position)} of ${label.total}${label.dates ? `, ${label.dates}` : ''})`;
	};

	// What a citation supports. A name, fact or link that a change deletes is named from the rows before it.
	const subjectOf = (kind: string, id: string): string => {
		switch (kind) {
			case CITATION_SUBJECT_KINDS.PERSON:
				return person(id);
			case CITATION_SUBJECT_KINDS.UNION:
				return union(id);
			case CITATION_SUBJECT_KINDS.NAME: {
				const name = known.personNames.find((n) => n.id === id);
				return name
					? `${NAME_TYPE_LABELS[(name.type as NameType) ?? 'other']} of ${person(name.personId)}`
					: 'a name';
			}
			case CITATION_SUBJECT_KINDS.EVENT: {
				const event = known.events.find((e) => e.id === id);
				return event
					? `${eventLabel(event.type)} of ${event.entityType === 'FAMILY' ? union(event.entityId) : person(event.entityId)}`
					: 'a fact';
			}
			default: {
				const link = known.parentChild.find((l) => l.id === id);
				return link
					? `${person(link.parentId)} as parent of ${person(link.childId)}`
					: 'a parent link';
			}
		}
	};

	// What a note is attached to: the subjects a citation can have, and the library records and
	// citations that notes can also sit on.
	const noteSubjectOf = (kind: string, id: string): string => {
		switch (kind) {
			case NOTE_SUBJECT_KINDS.SOURCE: {
				const source = known.sources.find((s) => s.id === id);
				return source ? `source “${sourceLabel(source)}”` : 'a source';
			}
			case NOTE_SUBJECT_KINDS.REPOSITORY: {
				const repository = known.repositories.find((r) => r.id === id);
				return repository ? `repository “${repository.name ?? 'Unnamed'}”` : 'a repository';
			}
			case NOTE_SUBJECT_KINDS.CITATION: {
				const citation = known.citations.find((c) => c.id === id);
				if (!citation) return 'a citation';
				const source = known.sources.find((s) => s.id === citation.sourceId);
				return `a citation of “${source ? sourceLabel(source) : (citation.description ?? 'a source')}”`;
			}
			default:
				return subjectOf(kind, id);
		}
	};

	return (tableName, image) => {
		// The labeller is handed a table and a generic image (a stored inverse's rows included); this is
		// where the pair is trusted to match, once, so each case below sees its own table's row.
		const { table, row } = { table: tableName, row: image } as TableRow;
		switch (table) {
			case 'individuals':
				return personName(row);
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
				const owner = row.entityType === 'FAMILY' ? union(row.entityId) : person(row.entityId);
				// Two occupations or residences share a name, so a preview names the one it means.
				const detail = row.value ? ` (${row.value})` : '';
				return `${eventLabel(row.type)}${detail} of ${owner}`;
			}
			case 'media_items': {
				if (row.entityId === null) return 'Unattached file';
				const isPartnership = known.unions.some((u) => u.id === row.entityId);
				return `Attachment of ${isPartnership ? union(row.entityId) : person(row.entityId)}`;
			}
			case 'sources':
				return `Source “${sourceLabel(row)}”`;
			case 'repositories':
				return `Repository “${row.name ?? 'Unnamed'}”`;
			case 'source_repositories': {
				const source = known.sources.find((s) => s.id === row.sourceId);
				const repository = known.repositories.find((r) => r.id === row.repositoryId);
				return `${source ? sourceLabel(source) : 'Source'} at ${repository?.name ?? 'a repository'}`;
			}
			case 'citations': {
				const source = known.sources.find((s) => s.id === row.sourceId);
				const page = row.page ? `, ${row.page}` : '';
				return `Citation of “${source ? sourceLabel(source) : (row.description ?? 'a source')}”${page} for ${subjectOf(row.subjectKind, row.subjectId)}`;
			}
			case 'notes':
				return `Shared note “${noteTitle(row.text, 40)}”`;
			case 'research_tasks':
				return `Task “${String(row.title ?? '').slice(0, 60)}”`;
			case 'note_attachments': {
				const shared = row.noteId ? known.notes.find((n) => n.id === row.noteId) : undefined;
				const what = row.noteId ? `Shared note “${noteTitle(shared?.text ?? null, 40)}”` : 'Note';
				return `${what} on ${noteSubjectOf(row.subjectKind, row.subjectId)}`;
			}
		}
	};
}
