/**
 * Words for sources, repositories and citations in previews, summaries and the change log
 * (ADR-028): "Parish register", "the birth of Ann Ash". Pure.
 */

import type { TreeRows } from './change-log';
import {
	CITATION_SUBJECT_KINDS,
	sourceLabel,
	type CitationSubjectKind
} from '../../shared/evidence';
import { NOTE_SUBJECT_KINDS, noteTitle, type NoteSubjectKind } from '../../shared/notes';
import { displayNameOf, partnerIdsOf } from './tree-ops';
import { eventLabel } from './tree-labels';
import { NAME_TYPE_LABELS, type NameType } from '../../shared/name-types';

/** What a citation supports, in words: "Ann Ash", "the birth of Ann Ash", "the partnership of Ann Ash and Bob Ash". */
export function subjectLabel(rows: TreeRows, kind: CitationSubjectKind, id: string): string {
	switch (kind) {
		case CITATION_SUBJECT_KINDS.PERSON:
			return displayNameOf(rows, id);
		case CITATION_SUBJECT_KINDS.NAME: {
			const name = rows.personNames.find((n) => n.id === id);
			return name
				? `the ${NAME_TYPE_LABELS[name.type as NameType].toLowerCase()} of ${displayNameOf(rows, name.personId)}`
				: 'a name';
		}
		case CITATION_SUBJECT_KINDS.EVENT: {
			const event = rows.events.find((e) => e.id === id);
			if (!event) return 'a fact';
			const owner =
				event.entityType === 'INDIVIDUAL'
					? displayNameOf(rows, event.entityId)
					: partnerIdsOf(rows, event.entityId)
							.map((p) => displayNameOf(rows, p))
							.join(' and ') || 'a partnership';
			return `the ${eventLabel(event.type).toLowerCase()} of ${owner}`;
		}
		case CITATION_SUBJECT_KINDS.UNION: {
			const names = partnerIdsOf(rows, id).map((p) => displayNameOf(rows, p));
			return names.length > 0 ? `the partnership of ${names.join(' and ')}` : 'a partnership';
		}
		default: {
			const link = rows.parentChild.find((l) => l.id === id);
			return link
				? `${displayNameOf(rows, link.parentId)} as parent of ${displayNameOf(rows, link.childId)}`
				: 'a parent link';
		}
	}
}

/** What a note is attached to, in words: the subjects a citation can have, and a source, a repository or a citation. */
export function noteSubjectLabel(rows: TreeRows, kind: NoteSubjectKind, id: string): string {
	switch (kind) {
		case NOTE_SUBJECT_KINDS.SOURCE: {
			const source = rows.sources.find((s) => s.id === id);
			return source ? `the source “${sourceLabel(source)}”` : 'a source';
		}
		case NOTE_SUBJECT_KINDS.REPOSITORY: {
			const repository = rows.repositories.find((r) => r.id === id);
			return repository ? `the repository “${repository.name ?? 'Unnamed'}”` : 'a repository';
		}
		case NOTE_SUBJECT_KINDS.CITATION: {
			const citation = rows.citations.find((c) => c.id === id);
			return citation
				? `a citation of ${subjectLabel(rows, citation.subjectKind, citation.subjectId)}`
				: 'a citation';
		}
		default:
			return subjectLabel(rows, kind as CitationSubjectKind, id);
	}
}

/** “A shared note about Parish register”: how a shared note is named in a summary. */
export function sharedNoteLabel(rows: TreeRows, id: string, text?: string | null): string {
	const row = rows.notes.find((n) => n.id === id);
	return `“${noteTitle(row?.text ?? text ?? null, 40)}”`;
}
