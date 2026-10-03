/**
 * How many citations a merge carries over, for its preview (ADR-028). A merge never drops evidence:
 * the citations of the record folded away end up on the one that remains, and the person approving
 * it is told how many that is.
 */

import type { TreeRows } from './change-log';
import type { RelationshipCommand } from './relationship-commands';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';

/** Citations on a person, their names and facts, and the parent links they are in. */
export function citationsOfPerson(rows: TreeRows, personId: string): number {
	const subjects = new Set<string>([`${CITATION_SUBJECT_KINDS.PERSON}|${personId}`]);
	for (const n of rows.personNames)
		if (n.personId === personId) subjects.add(`${CITATION_SUBJECT_KINDS.NAME}|${n.id}`);
	for (const e of rows.events)
		if (e.entityType === 'INDIVIDUAL' && e.entityId === personId)
			subjects.add(`${CITATION_SUBJECT_KINDS.EVENT}|${e.id}`);
	for (const l of rows.parentChild)
		if (l.parentId === personId || l.childId === personId)
			subjects.add(`${CITATION_SUBJECT_KINDS.PARENT_CHILD}|${l.id}`);
	return rows.citations.filter((c) => subjects.has(`${c.subjectKind}|${c.subjectId}`)).length;
}

/** Citations on a partnership, its facts and the parent links filed under it. */
export function citationsOfUnion(rows: TreeRows, unionId: string): number {
	const subjects = new Set<string>([`${CITATION_SUBJECT_KINDS.UNION}|${unionId}`]);
	for (const e of rows.events)
		if (e.entityType === 'FAMILY' && e.entityId === unionId)
			subjects.add(`${CITATION_SUBJECT_KINDS.EVENT}|${e.id}`);
	for (const l of rows.parentChild)
		if (l.unionId === unionId) subjects.add(`${CITATION_SUBJECT_KINDS.PARENT_CHILD}|${l.id}`);
	return rows.citations.filter((c) => subjects.has(`${c.subjectKind}|${c.subjectId}`)).length;
}

/** The citations these commands fold into another record; undefined when none is a merge or none is cited. */
export function carriedCitations(
	rows: TreeRows,
	commands: readonly RelationshipCommand[]
): number | undefined {
	let total = 0;
	for (const command of commands) {
		if (command.kind === 'merge_people') total += citationsOfPerson(rows, command.mergedId);
		else if (command.kind === 'merge_unions')
			for (const id of command.mergedIds) total += citationsOfUnion(rows, id);
		else if (command.kind === 'merge_sources') {
			const merged = new Set(command.mergedIds);
			total += rows.citations.filter((c) => c.sourceId && merged.has(c.sourceId)).length;
		}
	}
	return total > 0 ? total : undefined;
}
