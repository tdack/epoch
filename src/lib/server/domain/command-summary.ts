/**
 * One-line, past-tense summaries of what a command did ("Deleted John Smith"), stored in the
 * change log and shown in the undo toast.
 */

import { dateRewrites } from './date-ops';
import { MAX_DATE_REWRITES } from '../../shared/date-tidy';
import type { TreeRows } from './change-log';
import type { RelationshipCommand } from './relationship-commands';
import { factsAtPlace } from './place-ops';
import { displayNameOf, partnerIdsOf, personName } from './tree-ops';
import { factLabel } from '../../shared/fact-types';
import { NAME_TYPE_LABELS, formatFullName, type NameType } from '../../shared/name-types';
import { noteSubjectLabel, sharedNoteLabel, subjectLabel } from './evidence-labels';
import { sourceLabel } from '../../shared/evidence';
import { stepOf } from './evidence-carry';

/** “Parish register” for the source a command names, whether it exists yet or not. */
function sourceName(rows: TreeRows, id: string, input?: { title?: string | null }): string {
	const row = rows.sources.find((s) => s.id === id);
	return `“${row ? sourceLabel(row) : input?.title?.trim() || 'a source'}”`;
}

function repositoryName(rows: TreeRows, id: string, name?: string | null): string {
	return `“${rows.repositories.find((r) => r.id === id)?.name ?? name?.trim() ?? 'a repository'}”`;
}

/** What a citation supports, from the citation itself or the subject the command names. */
function citedSubject(rows: TreeRows, citationId: string): string {
	const citation = rows.citations.find((c) => c.id === citationId);
	return citation ? subjectLabel(rows, citation.subjectKind, citation.subjectId) : 'a record';
}

function nameOf(rows: TreeRows, id: string): string {
	return displayNameOf(rows, id);
}

function partnershipOf(rows: TreeRows, unionId: string): string {
	const names = partnerIdsOf(rows, unionId).map((id) => nameOf(rows, id));
	return names.length >= 2
		? `the partnership between ${names.join(' and ')}`
		: names.length === 1
			? `${names[0]}'s partnership`
			: 'a partnership';
}

/** "Alex will be recorded as Sam's parent." becomes "Alex was recorded as Sam's parent." */
export function pastTense(sentence: string): string {
	return sentence.replace(/ will be /g, ' was ').replace(/ will no longer be /g, ' was no longer ');
}

/** "Occupation" for the fact a command names, whether it exists yet or not. */
function factName(rows: TreeRows, factId: string, type?: string): string {
	return factLabel(type ?? rows.events.find((e) => e.id === factId)?.type ?? 'FACT').toLowerCase();
}

function factOwner(rows: TreeRows, factId: string): string {
	const owner = rows.events.find((e) => e.id === factId)?.entityId;
	return owner ? nameOf(rows, owner) : 'someone';
}

function nameOwner(rows: TreeRows, nameId: string): string {
	const owner = rows.personNames.find((n) => n.id === nameId)?.personId;
	return owner ? nameOf(rows, owner) : 'someone';
}

/** "married name" for the name a command names, whether it exists yet or not. */
function nameKind(rows: TreeRows, nameId: string, type?: NameType): string {
	return NAME_TYPE_LABELS[
		type ?? (rows.personNames.find((n) => n.id === nameId)?.type as NameType | undefined) ?? 'other'
	].toLowerCase();
}

const PRIVACY_SENTENCES = {
	auto: (name: string) => `Set the privacy of ${name} to follow their dates`,
	public: (name: string) => `Made ${name} always public`,
	private: (name: string) => `Made ${name} always private`
} as const;

const placeNamed = (rows: TreeRows, key: string) => factsAtPlace(rows, key)[0]?.place ?? 'a place';

const peopleCount = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;

/**
 * "Added emigration to 6 people": the summary of one fact copied onto a group. A group of one is
 * named, as a single added fact is, rather than reading "to 1 person".
 */
export function describeGroupFact(
	rows: TreeRows,
	type: string,
	personIds: readonly string[]
): string {
	const fact = factLabel(type).toLowerCase();
	return personIds.length === 1
		? `Added ${fact} to ${nameOf(rows, personIds[0]!)}`
		: `Added ${fact} to ${peopleCount(personIds.length)}`;
}

/** "Cited “Smith family book” for 6 people", or "… on 6 Birth facts" when it cites a fact type. */
export function describeGroupCitation(
	rows: TreeRows,
	sourceId: string,
	count: number,
	factType?: string
): string {
	if (factType)
		// Labels such as "Census" do not take a plain "s", so the noun is "fact".
		return `Cited ${sourceName(rows, sourceId)} on ${count} ${factLabel(factType)} fact${count === 1 ? '' : 's'}`;
	return `Cited ${sourceName(rows, sourceId)} for ${peopleCount(count)}`;
}

export function describeCommand(command: RelationshipCommand, rows: TreeRows): string {
	switch (command.kind) {
		case 'create_fact':
			return `Added ${factName(rows, command.factId, command.fact.type)} to ${nameOf(rows, command.personId)}`;
		case 'update_fact':
			return `Edited the ${factName(rows, command.factId)} of ${factOwner(rows, command.factId)}`;
		case 'delete_fact':
			return `Removed the ${factName(rows, command.factId)} of ${factOwner(rows, command.factId)}`;
		case 'reorder_facts':
			return `Reordered the facts of ${nameOf(rows, command.personId)}`;
		case 'create_source':
			return `Added the source ${sourceName(rows, command.sourceId, command.source)}`;
		case 'update_source':
			return `Edited the source ${sourceName(rows, command.sourceId)}`;
		case 'delete_source': {
			const step = stepOf(rows, command);
			if (step)
				return `Removed ${step.taken} of ${step.total} citations of the source ${sourceName(rows, command.sourceId)}, to delete it`;
			const count = rows.citations.filter((c) => c.sourceId === command.sourceId).length;
			const files = rows.mediaLinks.filter((l) => l.entityId === command.sourceId).length;
			const kept =
				files > 0 ? `; its ${files === 1 ? 'file is' : `${files} files are`} kept, detached` : '';
			return `Deleted the source ${sourceName(rows, command.sourceId)}${count > 0 ? ` and its ${count} ${count === 1 ? 'citation' : 'citations'}` : ''}${kept}`;
		}
		case 'merge_sources': {
			// The op ignores repeats and the survivor in `mergedIds`, so the count does too.
			const merged = new Set(command.mergedIds.filter((id) => id !== command.survivorId));
			const step = stepOf(rows, command);
			if (step)
				return `Moved ${step.taken} of ${step.total} citations to ${sourceName(rows, command.survivorId)}, to merge ${merged.size + 1} sources`;
			return `Merged ${merged.size + 1} sources into ${sourceName(rows, command.survivorId)}`;
		}
		case 'create_repository':
			return `Added the repository ${repositoryName(rows, command.repositoryId, command.repository.name)}`;
		case 'update_repository':
			return `Edited the repository ${repositoryName(rows, command.repositoryId)}`;
		case 'delete_repository':
			return `Deleted the repository ${repositoryName(rows, command.repositoryId)}`;
		case 'link_repository':
			return `Linked the source ${sourceName(rows, command.sourceId)} to the repository ${repositoryName(rows, command.repositoryId)}`;
		case 'update_source_repository':
		case 'unlink_repository': {
			const link = rows.sourceRepositories.find((l) => l.id === command.linkId);
			const where = link
				? `${sourceName(rows, link.sourceId)} at ${link.repositoryId ? repositoryName(rows, link.repositoryId) : 'a repository'}`
				: 'a source';
			return command.kind === 'unlink_repository'
				? `Unlinked ${where}`
				: `Changed the call number of ${where}`;
		}
		case 'add_citation':
			return `Cited ${sourceName(rows, command.citation.sourceId ?? '')} for ${subjectLabel(rows, command.subject.kind, command.subject.id)}`;
		case 'update_citation':
			return `Edited a citation of ${citedSubject(rows, command.citationId)}`;
		case 'remove_citation':
			return `Removed a citation of ${citedSubject(rows, command.citationId)}`;
		case 'reorder_citations':
			return `Reordered the citations of ${subjectLabel(rows, command.subject.kind, command.subject.id)}`;
		case 'add_note':
			return `Added a note to ${noteSubjectLabel(rows, command.subject.kind, command.subject.id)}`;
		case 'update_note':
		case 'remove_note': {
			const attachment = rows.noteAttachments.find((a) => a.id === command.attachmentId);
			const on = attachment
				? noteSubjectLabel(rows, attachment.subjectKind, attachment.subjectId)
				: 'a record';
			return command.kind === 'update_note'
				? `Edited a note on ${on}`
				: `Removed a note from ${on}`;
		}
		case 'reorder_notes':
			return `Reordered the notes of ${noteSubjectLabel(rows, command.subject.kind, command.subject.id)}`;
		case 'share_note': {
			const attachment = rows.noteAttachments.find((a) => a.id === command.attachmentId);
			return `Shared a note of ${attachment ? noteSubjectLabel(rows, attachment.subjectKind, attachment.subjectId) : 'a record'}`;
		}
		case 'attach_note':
			return `Attached the shared note ${sharedNoteLabel(rows, command.noteId)} to ${noteSubjectLabel(rows, command.subject.kind, command.subject.id)}`;
		case 'create_note':
			return `Added the shared note ${sharedNoteLabel(rows, command.noteId, command.note.text)}`;
		case 'update_shared_note':
			return `Edited the shared note ${sharedNoteLabel(rows, command.noteId)}`;
		case 'delete_shared_note': {
			const step = stepOf(rows, command);
			if (step)
				return `Detached the shared note ${sharedNoteLabel(rows, command.noteId)} from ${step.taken} of ${step.total} records, to delete it`;
			const uses = rows.noteAttachments.filter((a) => a.noteId === command.noteId).length;
			return `Deleted the shared note ${sharedNoteLabel(rows, command.noteId)}${uses > 0 ? ` and detached it from ${uses} ${uses === 1 ? 'record' : 'records'}` : ''}`;
		}
		case 'merge_notes': {
			const step = stepOf(rows, command);
			if (step)
				return `Moved ${step.taken} of ${step.total} uses to the shared note ${sharedNoteLabel(rows, command.survivorId)}, to merge ${command.mergedIds.length + 1} notes`;
			return `Merged ${command.mergedIds.length + 1} shared notes into ${sharedNoteLabel(rows, command.survivorId)}`;
		}
		case 'rename_media':
			return `Renamed the file “${command.title.trim().slice(0, 60)}”`;
		case 'link_media':
		case 'unlink_media': {
			const file = rows.mediaItems.find((m) => m.id === command.mediaId);
			const name = `“${(file?.title ?? 'a file').slice(0, 60)}”`;
			const target = rows.individuals.some((p) => p.id === command.entityId)
				? nameOf(rows, command.entityId)
				: rows.sources.some((s) => s.id === command.entityId)
					? `the source ${sourceName(rows, command.entityId)}`
					: partnershipOf(rows, command.entityId);
			return command.kind === 'link_media'
				? `Linked the file ${name} to ${target}`
				: `Unlinked the file ${name} from ${target}`;
		}
		case 'create_task':
			return `Added the task “${command.task.title.trim().slice(0, 60)}”`;
		case 'update_task': {
			const task = rows.researchTasks.find((t) => t.id === command.taskId);
			const status = command.task.status;
			const name = `“${(task?.title ?? 'a task').slice(0, 60)}”`;
			if (status === 'done' && task?.status !== 'done') return `Completed the task ${name}`;
			if (status === 'dropped' && task?.status !== 'dropped') return `Dropped the task ${name}`;
			if (status === 'open' && task && task.status !== 'open') return `Reopened the task ${name}`;
			return `Edited the task ${name}`;
		}
		case 'delete_task':
			return `Deleted the task “${(rows.researchTasks.find((t) => t.id === command.taskId)?.title ?? 'a task').slice(0, 60)}”`;
		case 'create_subtree':
			return `Added the sub-tree “${command.name.trim().slice(0, 60)}”`;
		case 'update_subtree':
			return `Edited the sub-tree “${(rows.subtrees.find((s) => s.id === command.subtreeId)?.name ?? 'a sub-tree').slice(0, 60)}”`;
		case 'delete_subtree':
			return `Deleted the sub-tree “${(rows.subtrees.find((s) => s.id === command.subtreeId)?.name ?? 'a sub-tree').slice(0, 60)}”`;
		case 'reorder_subtrees':
			return 'Reordered the sub-trees';
		case 'standardise_dates': {
			const count = Math.min(dateRewrites(rows).length, MAX_DATE_REWRITES);
			return `Standardised ${count === 1 ? '1 date' : `${count} dates`}`;
		}
		case 'rewrite_place': {
			const from = factsAtPlace(rows, command.fromKey)[0]?.place ?? 'a place';
			return `Changed the place ${from} to ${command.to.trim()}`;
		}
		case 'set_place_location':
			return `Set the location of the place ${placeNamed(rows, command.placeKey)}`;
		case 'ignore_place_location':
			return `Left the place ${placeNamed(rows, command.placeKey)} off the map`;
		case 'clear_place_location':
			return 'Cleared the location of a place';
		case 'merge_people':
			return `Merged ${nameOf(rows, command.mergedId)} into ${nameOf(rows, command.survivorId)}`;
		case 'create_name':
			return `Added ${nameKind(rows, command.nameId, command.name.type)} ${formatFullName(command.name)} to ${nameOf(rows, command.personId)}`;
		case 'update_name':
			return `Edited the ${nameKind(rows, command.nameId)} of ${nameOwner(rows, command.nameId)}`;
		case 'delete_name':
			return `Removed the ${nameKind(rows, command.nameId)} of ${nameOwner(rows, command.nameId)}`;
		case 'reorder_names':
			return `Reordered the names of ${nameOf(rows, command.personId)}`;
		case 'set_preferred_name':
			return `Chose the ${nameKind(rows, command.nameId)} as the preferred name of ${nameOf(rows, command.personId)}`;
		case 'create_person':
			return `Added ${personName({ givenName: command.givenName, surname: command.surname })}`;
		case 'update_person':
			return `Edited ${nameOf(rows, command.personId)}`;
		case 'delete_person':
			return `Deleted ${nameOf(rows, command.personId)}`;
		case 'set_person_privacy':
			return PRIVACY_SENTENCES[command.privacy](nameOf(rows, command.personId));
		case 'record_death':
			return `Recorded the death of ${nameOf(rows, command.personId)}`;
		case 'create_union':
			return 'Added a partnership';
		case 'add_partner_to_union':
			return `Added ${nameOf(rows, command.personId)} to ${partnershipOf(rows, command.unionId)}`;
		case 'remove_partner_from_union':
			return `Removed ${nameOf(rows, command.personId)} from ${partnershipOf(rows, command.unionId)}`;
		case 'assert_parent_child':
			return `Linked ${nameOf(rows, command.parentId)} as ${nameOf(rows, command.childId)}'s ${command.type === 'unknown' ? '' : `${command.type} `}parent`;
		case 'remove_parent_child':
			return `Removed the link between ${nameOf(rows, command.parentId)} and ${nameOf(rows, command.childId)}`;
		case 'change_parent_child_type':
			return `Changed ${nameOf(rows, command.parentId)} to ${command.toType === 'unknown' ? 'an unspecified' : `a ${command.toType}`} parent of ${nameOf(rows, command.childId)}`;
		case 'destroy_union':
			return `Deleted ${partnershipOf(rows, command.unionId)}`;
		case 'end_union':
			return `Recorded ${partnershipOf(rows, command.unionId)} as ${command.status}`;
		case 'update_union':
			return `Updated ${partnershipOf(rows, command.unionId)}`;
		case 'merge_unions':
			return `Merged ${command.mergedIds.length + 1} partnerships into ${partnershipOf(rows, command.survivorId)}`;
	}
}
