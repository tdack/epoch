/**
 * Masks a set of tree rows for a viewer who may not see private people (ADR-015). Pure, and over
 * `TreeRows`, so every reader that works on loaded rows (the focus window, the record pages) shares
 * one rule; the paged reads that cannot load rows use the SQL form in `repositories/visibility.ts`.
 *
 * Two modes, set per tree:
 * - **omit:** a private person, their names and facts, every link and partner row that names them,
 *   and every partnership they are in are gone, as if they were never recorded. Counts, stubs and relationships are computed over
 *   what is left, so nothing says someone was removed.
 * - **placeholder:** structure stays, so a relationship can be drawn, but a private person has no
 *   name, sex, XREF, names or facts: they are "Private".
 * In both, a partnership with a private partner loses its own facts: a marriage date and place are
 * facts about the people in it.
 */

import { isPersonPrivate, type LivingFact } from './living-state';
import type { IndividualRow, RowOp, TreeRows } from './change-log';
import { CITATION_SUBJECT_KINDS } from '../../shared/evidence';
import { NOTE_SUBJECT_KINDS } from '../../shared/notes';
import { NotFoundError } from './errors';

export const PRIVATE_PLACEHOLDER_NAME = 'Private';

export interface MaskedRows {
	rows: TreeRows;
	/** The people that remain as placeholders; empty in omit mode, where none remain. */
	placeholderIds: Set<string>;
}

/** Everyone in these rows who is private, from their override and the facts the rows hold for them. */
export function privatePeople(
	rows: TreeRows,
	cutoff: string,
	creatorId: string | null = null
): Set<string> {
	const factsOf = new Map<string, LivingFact[]>();
	for (const e of rows.events) {
		if (e.entityType !== 'INDIVIDUAL') continue;
		const facts = factsOf.get(e.entityId) ?? [];
		facts.push({ type: e.type, dateSortEnd: e.dateSortEnd });
		factsOf.set(e.entityId, facts);
	}
	return new Set(
		rows.individuals
			.filter((i) =>
				isPersonPrivate(
					i.privacy,
					factsOf.get(i.id) ?? [],
					cutoff,
					creatorId !== null && i.createdBy === creatorId
				)
			)
			.map((i) => i.id)
	);
}

/**
 * The records a viewer may not see, as `kind|id` keys, for deciding which citations are theirs to see.
 * A citation is visible only if its subject is; a partnership with a private partner has no facts
 * to cite, in either mode, so its own citations go with them.
 */
function hiddenSubjectKeys(
	rows: TreeRows,
	hidden: Set<string>,
	unionsWithHiddenPartner: Set<string>
): Set<string> {
	const keys = new Set<string>();
	for (const id of hidden) keys.add(`${CITATION_SUBJECT_KINDS.PERSON}|${id}`);
	for (const id of unionsWithHiddenPartner) keys.add(`${CITATION_SUBJECT_KINDS.UNION}|${id}`);
	for (const n of rows.personNames)
		if (hidden.has(n.personId)) keys.add(`${CITATION_SUBJECT_KINDS.NAME}|${n.id}`);
	for (const e of rows.events) {
		if (
			e.entityType === 'INDIVIDUAL'
				? hidden.has(e.entityId)
				: unionsWithHiddenPartner.has(e.entityId)
		)
			keys.add(`${CITATION_SUBJECT_KINDS.EVENT}|${e.id}`);
	}
	for (const l of rows.parentChild) {
		if (
			hidden.has(l.parentId) ||
			hidden.has(l.childId) ||
			(l.unionId !== null && unionsWithHiddenPartner.has(l.unionId))
		)
			keys.add(`${CITATION_SUBJECT_KINDS.PARENT_CHILD}|${l.id}`);
	}
	return keys;
}

/**
 * The evidence a restricted viewer may see (ADR-028): citations of subjects they can see, the
 * sources and repositories those support, and what they made themselves. A source that supports
 * only private people is exactly as absent as one that does not exist.
 */
function visibleEvidence(
	rows: TreeRows,
	hiddenKeys: Set<string>,
	creatorId: string | null
): Pick<
	TreeRows,
	'sources' | 'repositories' | 'sourceRepositories' | 'citations' | 'notes' | 'noteAttachments'
> {
	const citations = rows.citations.filter(
		(c) => !hiddenKeys.has(`${c.subjectKind}|${c.subjectId}`)
	);
	const cited = new Set(citations.flatMap((c) => (c.sourceId ? [c.sourceId] : [])));
	const isOwn = (row: { createdBy: string | null }) =>
		creatorId !== null && row.createdBy === creatorId;
	const sources = rows.sources.filter((s) => cited.has(s.id) || isOwn(s));
	const keptSources = new Set(sources.map((s) => s.id));
	const sourceRepositories = rows.sourceRepositories.filter((l) => keptSources.has(l.sourceId));
	const linked = new Set(
		sourceRepositories.flatMap((l) => (l.repositoryId ? [l.repositoryId] : []))
	);
	const repositories = rows.repositories.filter((r) => linked.has(r.id) || isOwn(r));

	// Notes follow what they are on (ADR-029): an attachment is visible only if its subject is, and a
	// shared note only if a visible attachment uses it or the viewer made it. A note under a source,
	// a repository or a citation is as visible as that record is to this viewer.
	const keptCitations = new Set(citations.map((c) => c.id));
	const keptSourceIds = new Set(sources.map((s) => s.id));
	const keptRepositories = new Set(repositories.map((r) => r.id));
	const isSubjectVisible = (kind: string, id: string) => {
		switch (kind) {
			case NOTE_SUBJECT_KINDS.SOURCE:
				return keptSourceIds.has(id);
			case NOTE_SUBJECT_KINDS.REPOSITORY:
				return keptRepositories.has(id);
			case NOTE_SUBJECT_KINDS.CITATION:
				return keptCitations.has(id);
			default:
				return !hiddenKeys.has(`${kind}|${id}`);
		}
	};
	const noteAttachments = rows.noteAttachments.filter((a) =>
		isSubjectVisible(a.subjectKind, a.subjectId)
	);
	const used = new Set(noteAttachments.flatMap((a) => (a.noteId ? [a.noteId] : [])));
	return {
		sources,
		repositories,
		sourceRepositories,
		citations,
		notes: rows.notes.filter((n) => used.has(n.id) || isOwn(n)),
		noteAttachments
	};
}

/**
 * The tasks a restricted viewer may see (ADR-029): an unlinked task is visible to every member, and
 * one about a record only if that record is. A task's title is the author's own words and can name
 * the person it is about, so a task about a private person is as absent as the person.
 */
function visibleTasks(
	rows: TreeRows,
	hidden: Set<string>,
	unionsWithHiddenPartner: Set<string>,
	hiddenKeys: Set<string>,
	evidence: Pick<TreeRows, 'sources' | 'notes'>
): TreeRows['researchTasks'] {
	const sources = new Set(evidence.sources.map((s) => s.id));
	const notes = new Set(evidence.notes.map((n) => n.id));
	return rows.researchTasks.filter((t) => {
		switch (t.subjectKind) {
			case null:
				return true;
			case 'person':
				return !hidden.has(t.subjectId ?? '');
			case 'union':
				return !unionsWithHiddenPartner.has(t.subjectId ?? '');
			case 'event':
				return !hiddenKeys.has(`event|${t.subjectId}`);
			case 'source':
				return sources.has(t.subjectId ?? '');
			default:
				return notes.has(t.subjectId ?? '');
		}
	});
}

const placeholderOf = (row: IndividualRow): IndividualRow => ({
	...row,
	xrefId: null,
	givenName: PRIVATE_PLACEHOLDER_NAME,
	surname: null,
	sex: 'U'
});

export function maskRows(
	rows: TreeRows,
	cutoff: string,
	shouldShowStructure: boolean,
	creatorId: string | null = null
): MaskedRows {
	const hidden = privatePeople(rows, cutoff, creatorId);
	const unionsWithHiddenPartner = new Set(
		rows.unionPartners.filter((p) => hidden.has(p.personId)).map((p) => p.unionId)
	);
	const hiddenKeys = hiddenSubjectKeys(rows, hidden, unionsWithHiddenPartner);
	const visible = visibleEvidence(rows, hiddenKeys, creatorId);
	const evidence = {
		...visible,
		researchTasks: visibleTasks(rows, hidden, unionsWithHiddenPartner, hiddenKeys, visible),
		// A sub-tree's name can name its root, so one rooted at a private person is as absent as they are.
		subtrees: rows.subtrees.filter((s) => !hidden.has(s.rootPersonId))
	};
	if (hidden.size === 0) {
		// Nothing is private, and a viewer who sees all the evidence is handed the rows as they were.
		const isEvidenceWhole = (Object.keys(evidence) as Array<keyof typeof evidence>).every(
			(key) => evidence[key].length === rows[key].length
		);
		return {
			rows: isEvidenceWhole ? rows : { ...rows, ...evidence },
			placeholderIds: new Set()
		};
	}
	const events = rows.events.filter((e) =>
		e.entityType === 'INDIVIDUAL'
			? !hidden.has(e.entityId)
			: !unionsWithHiddenPartner.has(e.entityId)
	);
	const personNames = rows.personNames.filter((n) => !hidden.has(n.personId));
	// Media of a private person is theirs; the window never carries media, but a reader that does must not show it.
	// A detached file has no owner to be private with, so a restricted viewer does not see it either.
	const mediaItems = rows.mediaItems.filter((m) => m.entityId !== null && !hidden.has(m.entityId));

	if (shouldShowStructure) {
		return {
			rows: {
				...rows,
				individuals: rows.individuals.map((i) => (hidden.has(i.id) ? placeholderOf(i) : i)),
				personNames,
				events,
				mediaItems,
				...evidence
			},
			placeholderIds: hidden
		};
	}

	// A partnership with a private partner is not left standing with the partner who remains: its page,
	// its facts and the list all treat it as absent, so a link to it from a page would be a dead end
	// that also says something is there. Its children keep their parent and lose the partnership.
	const unionPartners = rows.unionPartners.filter(
		(p) => !hidden.has(p.personId) && !unionsWithHiddenPartner.has(p.unionId)
	);
	const keptUnions = new Set(unionPartners.map((p) => p.unionId));
	return {
		rows: {
			individuals: rows.individuals.filter((i) => !hidden.has(i.id)),
			personNames,
			unions: rows.unions.filter((u) => keptUnions.has(u.id)),
			unionPartners,
			parentChild: rows.parentChild
				.filter((l) => !hidden.has(l.parentId) && !hidden.has(l.childId))
				.map((l) => (l.unionId && !keptUnions.has(l.unionId) ? { ...l, unionId: null } : l)),
			events: events.filter((e) => e.entityType === 'INDIVIDUAL' || keptUnions.has(e.entityId)),
			mediaItems,
			...evidence
		},
		placeholderIds: new Set()
	};
}

/** The part of a viewer's scope that decides what they see of private people; a `ViewerScope` has it. */
export interface MaskScope {
	isRestricted: boolean;
	cutoff: string;
	creatorId: string | null;
	shouldShowPrivateStructure: boolean;
}

/** The rows as this viewer may see them: untouched for roles that see everyone, else masked as the tree is set to. */
export function maskForScope(rows: TreeRows, scope: MaskScope): MaskedRows {
	return scope.isRestricted
		? maskRows(rows, scope.cutoff, scope.shouldShowPrivateStructure, scope.creatorId)
		: { rows, placeholderIds: new Set() };
}

/**
 * The rows with private people omitted, never shown as placeholders. For readers whose output
 * could be written back (a planner) or that have no use for a placeholder (the quality report).
 */
export function omitForScope(rows: TreeRows, scope: MaskScope): TreeRows {
	return scope.isRestricted ? maskRows(rows, scope.cutoff, false, scope.creatorId).rows : rows;
}

/**
 * Masks a loaded window for the viewer, first checking that every subject was found and is theirs
 * to see. A private subject answers as a missing one does, so asking for a person never says they
 * exist (ADR-015).
 */
export function requireVisibleSubject(
	window: { rows: TreeRows; foundStartIds: readonly string[] },
	personIds: string | readonly string[],
	scope: MaskScope
): MaskedRows {
	const hidden = scope.isRestricted
		? privatePeople(window.rows, scope.cutoff, scope.creatorId)
		: new Set<string>();
	for (const id of typeof personIds === 'string' ? [personIds] : personIds)
		if (!window.foundStartIds.includes(id) || hidden.has(id)) throw new NotFoundError('Person', id);
	return maskForScope(window.rows, scope);
}

/**
 * Whether any of these row operations reads or writes a record that belongs to a private person:
 * the person, their names, facts, links, partner rows and media, or a partnership they are in.
 * A restricted viewer's mutation is refused if it does (ADR-015), because the result would carry
 * or change something they may not see.
 */
export function opsTouchPrivate(
	ops: readonly RowOp[],
	rows: TreeRows,
	cutoff: string,
	creatorId: string | null = null
): boolean {
	const hidden = privatePeople(rows, cutoff, creatorId);
	// An unowned file is editor-only whether or not anyone is private, so a snapshot that happens to
	// hold no private person must answer as the whole tree does. Only that one rule survives an
	// empty `hidden`, which keeps the early return cheap for every other op.
	if (hidden.size === 0 && !ops.some(touchesUnownedFile)) return false;
	const hiddenUnions = new Set(
		rows.unionPartners.filter((p) => hidden.has(p.personId)).map((p) => p.unionId)
	);
	const hiddenKeys = hiddenSubjectKeys(rows, hidden, hiddenUnions);
	const hiddenCitations = new Set(
		rows.citations.filter((c) => hiddenKeys.has(`${c.subjectKind}|${c.subjectId}`)).map((c) => c.id)
	);
	const visible = visibleEvidence(rows, hiddenKeys, creatorId);
	const keptSources = new Set(visible.sources.map((src) => src.id));
	const keptNotes = new Set(visible.notes.map((n) => n.id));
	const hiddenRecords = {
		sources: new Set(rows.sources.filter((src) => !keptSources.has(src.id)).map((src) => src.id)),
		notes: new Set(rows.notes.filter((n) => !keptNotes.has(n.id)).map((n) => n.id))
	};
	return ops.some((op) =>
		touchesHidden(op, hidden, hiddenUnions, hiddenKeys, hiddenCitations, hiddenRecords)
	);
}

function touchesUnownedFile(op: RowOp): boolean {
	return op.table === 'media_items' && [op.before, op.after].some((r) => r !== null && !r.entityId);
}

function touchesHidden(
	op: RowOp,
	hidden: Set<string>,
	hiddenUnions: Set<string>,
	hiddenKeys: Set<string>,
	hiddenCitations: Set<string>,
	hiddenRecords: { sources: Set<string>; notes: Set<string> }
): boolean {
	// Either image may carry the link to a hidden record, so a row hidden before or after hides the op.
	const some = <R>(before: R | null, after: R | null, isHidden: (row: R) => boolean) =>
		[before, after].some((row) => row !== null && isHidden(row));
	switch (op.table) {
		case 'individuals':
			return hidden.has(op.id);
		case 'person_names':
			return some(op.before, op.after, (r) => hidden.has(r.personId));
		case 'unions':
			return hiddenUnions.has(op.id);
		case 'union_partners':
			return some(
				op.before,
				op.after,
				(r) => hidden.has(r.personId) || hiddenUnions.has(r.unionId)
			);
		case 'parent_child':
			return some(
				op.before,
				op.after,
				(r) => hidden.has(r.parentId) || hidden.has(r.childId) || hiddenUnions.has(r.unionId ?? '')
			);
		case 'events':
			return some(op.before, op.after, (r) =>
				r.entityType === 'INDIVIDUAL' ? hidden.has(r.entityId) : hiddenUnions.has(r.entityId)
			);
		case 'media_items':
			// A detached file is editor-only, so an op on it is one a restricted viewer must not see.
			return some(op.before, op.after, (r) => !r.entityId || hidden.has(r.entityId));
		case 'citations':
			return some(op.before, op.after, (r) => hiddenKeys.has(`${r.subjectKind}|${r.subjectId}`));
		case 'note_attachments':
			// A note on a citation is as private as the citation's own subject; one on a source or
			// repository belongs to no person, like the record itself.
			return some(op.before, op.after, (r) =>
				r.subjectKind === 'citation'
					? hiddenCitations.has(r.subjectId)
					: hiddenKeys.has(`${r.subjectKind}|${r.subjectId}`)
			);
		case 'subtree':
			return some(op.before, op.after, (r) => hidden.has(r.rootPersonId));
		case 'research_tasks':
			// A task about a record the viewer cannot see is hidden with it, however it is changed.
			return some(op.before, op.after, (r) => {
				const subjectId = r.subjectId ?? '';
				switch (r.subjectKind) {
					case 'person':
						return hidden.has(subjectId);
					case 'union':
						return hiddenUnions.has(subjectId);
					case 'event':
						return hiddenKeys.has(`event|${subjectId}`);
					case 'source':
						return hiddenRecords.sources.has(subjectId);
					case 'note':
						return hiddenRecords.notes.has(subjectId);
					default:
						return false;
				}
			});
		default:
			// A source, a repository and the link between them belong to no person; what cites them is checked above.
			return false;
	}
}
