/**
 * Words for sources, repositories and citations in previews, summaries and the change log
 * (ADR-028): "Parish register", "the birth of Ann Ash". Pure.
 */

import type { TreeRows } from './change-log';
import { CITATION_SUBJECT_KINDS, type CitationSubjectKind } from '../../shared/evidence';
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
