/**
 * Tasks as the pages show them (ADR-029): the row, the record it is about named and linked, and who
 * it is assigned to. A task whose record is gone reads as unlinked and says what kind it was about.
 * The callers pass tasks the viewer may see, so a title and a label here name nobody they cannot.
 */

import type { ResearchTaskRow } from '../domain/change-log';
import { eventLabel } from '../domain/tree-labels';
import { sourceLabel } from '../../shared/evidence';
import { noteTitle } from '../../shared/notes';
import type { GraphWindowRepository } from '../repositories/graph-window-repository';
import type { EvidenceRepository } from '../repositories/evidence-repository';
import type { NoteRepository } from '../repositories/note-repository';
import type { MemberRow } from '../repositories/member-repository';
import { TASK_SUBJECT_KINDS, type TaskDto, type TaskSubjectKind } from '../../shared/tasks';
import { personSummaries } from './person-summaries';
import type { ViewerScope } from './tree-access';

export interface TaskReaders {
	graph: GraphWindowRepository;
	evidence: EvidenceRepository;
	notes: NoteRepository;
}

/** A member as the task pickers show them: a name, never an address. */
export const memberChoice = (m: Pick<MemberRow, 'userId' | 'name'>) => ({
	id: m.userId,
	name: m.name?.trim() || 'A member'
});

export async function loadTaskDtos(
	readers: TaskReaders,
	treeId: string,
	rows: readonly ResearchTaskRow[],
	members: readonly Pick<MemberRow, 'userId' | 'name'>[],
	scope: ViewerScope
): Promise<TaskDto[]> {
	if (rows.length === 0) return [];
	const idsOf = (kind: TaskSubjectKind) =>
		rows.filter((t) => t.subjectKind === kind && t.subjectId).map((t) => t.subjectId!);
	const [facts, sourceRows, noteRows] = await Promise.all([
		readers.evidence.eventsByIds(treeId, idsOf(TASK_SUBJECT_KINDS.EVENT)),
		readers.evidence.sourcesByIds(treeId, idsOf(TASK_SUBJECT_KINDS.SOURCE)),
		readers.notes.notesByIds(treeId, idsOf(TASK_SUBJECT_KINDS.NOTE))
	]);
	const unionIds = [
		...idsOf(TASK_SUBJECT_KINDS.UNION),
		...facts.filter((e) => e.entityType === 'FAMILY').map((e) => e.entityId)
	];
	const [partnerRows] = await readers.graph.run(
		readers.graph.partnerRowsOfUnions(treeId, unionIds)
	);
	const people = await personSummaries(
		readers.graph,
		treeId,
		undefined,
		[
			...idsOf(TASK_SUBJECT_KINDS.PERSON),
			...facts.filter((e) => e.entityType === 'INDIVIDUAL').map((e) => e.entityId),
			...partnerRows.map((p) => p.row.personId)
		],
		scope
	);
	const nameOf = (id: string) => people.get(id)?.displayName ?? 'Unknown';
	const together = (unionId: string) => {
		const names = partnerRows
			.filter((p) => p.row.unionId === unionId)
			.sort((a, b) => a.row.order - b.row.order)
			.map((p) => nameOf(p.row.personId));
		return names.length > 0 ? names.join(' and ') : 'a partnership';
	};
	const byEvent = new Map(facts.map((e) => [e.id, e]));
	const bySource = new Map(sourceRows.map((s) => [s.id, s]));
	const byNote = new Map(noteRows.map((n) => [n.id, n]));
	const unionExists = new Set(partnerRows.map((p) => p.row.unionId));
	const memberName = new Map(members.map((m) => [m.userId, memberChoice(m).name]));

	const blank = { personId: null, unionId: null, sourceId: null, noteId: null };
	function subjectOf(task: ResearchTaskRow): TaskDto['subject'] {
		const id = task.subjectId;
		if (task.subjectKind === null || id === null) return null;
		switch (task.subjectKind) {
			case TASK_SUBJECT_KINDS.PERSON:
				return people.get(id)
					? { kind: 'person', id, label: nameOf(id), ...blank, personId: id }
					: null;
			case TASK_SUBJECT_KINDS.UNION:
				return unionExists.has(id)
					? {
							kind: 'union',
							id,
							label: `the partnership of ${together(id)}`,
							...blank,
							unionId: id
						}
					: null;
			case TASK_SUBJECT_KINDS.EVENT: {
				const event = byEvent.get(id);
				if (!event) return null;
				const isPerson = event.entityType === 'INDIVIDUAL';
				return {
					kind: 'event',
					id,
					label: `the ${eventLabel(event.type).toLowerCase()} of ${isPerson ? nameOf(event.entityId) : together(event.entityId)}`,
					...blank,
					personId: isPerson ? event.entityId : null,
					unionId: isPerson ? null : event.entityId
				};
			}
			case TASK_SUBJECT_KINDS.SOURCE: {
				const source = bySource.get(id);
				return source
					? {
							kind: 'source',
							id,
							label: `the source “${sourceLabel(source)}”`,
							...blank,
							sourceId: id
						}
					: null;
			}
			default: {
				const note = byNote.get(id);
				return note
					? {
							kind: 'note',
							id,
							label: `the note “${noteTitle(note.text, 40)}”`,
							...blank,
							noteId: id
						}
					: null;
			}
		}
	}

	return rows.map((task): TaskDto => {
		const subject = subjectOf(task);
		return {
			isPrivate: false,
			id: task.id,
			version: task.version,
			title: task.title,
			details: task.details,
			status: task.status,
			assignee:
				task.assigneeId && memberName.has(task.assigneeId)
					? { id: task.assigneeId, name: memberName.get(task.assigneeId)! }
					: null,
			dueDate: task.dueDate,
			subject,
			findingKey: task.findingKey,
			// A link to a record that is no longer there reads as cleared, whichever way it went.
			clearedLinkKind: subject === null ? (task.linkClearedKind ?? task.subjectKind) : null,
			createdBy: task.createdBy,
			createdByName: task.createdBy ? (memberName.get(task.createdBy) ?? null) : null,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt
		};
	});
}
