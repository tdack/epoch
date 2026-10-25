/**
 * Row operations for sources, repositories and citations (ADR-028): create, edit, delete, link,
 * merge, and cite. A citation is owned by one subject, so a merge or a delete of the subject moves or
 * removes it in the same change (`citationCascadeOps`, `makeCitationMover`) and an undo brings it back.
 *
 * Adding a citation does not touch its subject's version: a contributor may cite what they may see,
 * and citing is not an edit of the claim. Editing or removing one is an edit, like any other.
 */

import type {
	CitationRow,
	RepositoryRow,
	RowOp,
	SourceRepositoryRow,
	SourceRow,
	TreeRows
} from './change-log';
import { dateColumnsFor } from './date-columns';
import {
	ConcurrencyConflictError,
	NotFoundError,
	SourceInUseError,
	ValidationError
} from './errors';
import { makeNoteMover } from './note-ops';
import { relinkFiles, unlinkFilesOf } from './op-helpers';
import { makeTaskMover } from './task-ops';
import { NOTE_SUBJECT_KINDS } from '../../shared/notes';
import {
	CITATION_SUBJECT_KINDS,
	MAX_EVIDENCE_OPS,
	isCitationQuality,
	type CitationInput,
	type CitationSubjectRef,
	type RepositoryInput,
	type SourceInput
} from '../../shared/evidence';

export type EvidenceCommand =
	| { kind: 'create_source'; sourceId: string; source: SourceInput }
	| {
			kind: 'update_source';
			sourceId: string;
			expectedVersion?: number;
			source: SourceInput;
	  }
	| {
			kind: 'delete_source';
			sourceId: string;
			expectedVersion?: number;
			/** Without this, a source that is cited is refused. */
			shouldRemoveCitations?: boolean;
	  }
	| {
			kind: 'merge_sources';
			/** The source that remains; its XREF stays the primary one. */
			survivorId: string;
			/** The sources folded into it and deleted; their citations move to the survivor. */
			mergedIds: string[];
			expectedVersions?: Record<string, number>;
	  }
	| { kind: 'create_repository'; repositoryId: string; repository: RepositoryInput }
	| {
			kind: 'update_repository';
			repositoryId: string;
			expectedVersion?: number;
			repository: RepositoryInput;
	  }
	| { kind: 'delete_repository'; repositoryId: string; expectedVersion?: number }
	| {
			kind: 'link_repository';
			linkId: string;
			sourceId: string;
			repositoryId: string;
			callNumber?: string | null;
	  }
	| {
			kind: 'update_source_repository';
			linkId: string;
			expectedVersion?: number;
			callNumber: string | null;
	  }
	| { kind: 'unlink_repository'; linkId: string; expectedVersion?: number }
	| {
			kind: 'add_citation';
			citationId: string;
			subject: CitationSubjectRef;
			citation: CitationInput;
	  }
	| {
			kind: 'update_citation';
			citationId: string;
			expectedVersion?: number;
			citation: CitationInput;
	  }
	| { kind: 'remove_citation'; citationId: string; expectedVersion?: number }
	| {
			kind: 'reorder_citations';
			subject: CitationSubjectRef;
			/** Every citation of the subject, in the order they should now be written. */
			orderedCitationIds: string[];
	  };

interface EvidenceContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	newId: () => string;
	/** The user making the change, recorded as the author of a record it creates. */
	actorId: string | null;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** Text that keeps its line breaks (a source's words, an address) but not stray space at the ends. */
const cleanBlock = (value: string | null | undefined): string | null =>
	value?.replace(/\r\n?/g, '\n').trim() || null;

function touch<T extends { version: number; updatedAt: number | null }>(
	row: T,
	ctx: EvidenceContext
): T {
	return { ...row, version: row.version + 1, updatedAt: ctx.now };
}

function checkVersion(
	row: { id: string; version: number },
	expected: number | undefined,
	entity: 'source' | 'repository' | 'citation' | 'source_link',
	snapshot: Record<string, unknown>
): void {
	if (expected === undefined || row.version === expected) return;
	throw new ConcurrencyConflictError(
		`This ${entity.replace('_', ' ')} was changed by someone else (you had version ${expected}, it is now ${row.version}).`,
		{
			reason: 'STALE_VERSION',
			entity,
			id: row.id,
			expectedVersion: expected,
			currentVersion: row.version,
			current: snapshot
		}
	);
}

function requireSource(rows: TreeRows, id: string): SourceRow {
	const source = rows.sources.find((s) => s.id === id);
	if (!source) throw new NotFoundError('Source', id);
	return source;
}

function requireRepository(rows: TreeRows, id: string): RepositoryRow {
	const repository = rows.repositories.find((r) => r.id === id);
	if (!repository) throw new NotFoundError('Repository', id);
	return repository;
}

function requireLink(rows: TreeRows, id: string): SourceRepositoryRow {
	const link = rows.sourceRepositories.find((l) => l.id === id);
	if (!link) throw new NotFoundError('Repository link', id);
	return link;
}

function requireCitation(rows: TreeRows, id: string): CitationRow {
	const citation = rows.citations.find((c) => c.id === id);
	if (!citation) throw new NotFoundError('Citation', id);
	return citation;
}

/** Throws when what a citation is about is not in the tree. */
function requireSubject(rows: TreeRows, subject: CitationSubjectRef): void {
	const lists = {
		[CITATION_SUBJECT_KINDS.PERSON]: rows.individuals,
		[CITATION_SUBJECT_KINDS.NAME]: rows.personNames,
		[CITATION_SUBJECT_KINDS.EVENT]: rows.events,
		[CITATION_SUBJECT_KINDS.UNION]: rows.unions,
		[CITATION_SUBJECT_KINDS.PARENT_CHILD]: rows.parentChild
	};
	if (!lists[subject.kind]?.some((row) => row.id === subject.id))
		throw new NotFoundError('Record to cite', subject.id);
}

/**
 * A short XREF for a source or repository made here: eight characters of its random id. The unique
 * index on (tree, xref) refuses a clash as a write to retry, so no other row is read to avoid one.
 * shortcut: a clash with another record's XREF alias is not caught, accepted for an 8+-char random
 * token; check aliases here if imported aliases ever take this shape.
 */
const newXref = (prefix: 'S' | 'R', id: string) =>
	`@${prefix}${id
		.replace(/[^A-Za-z0-9]/g, '')
		.toUpperCase()
		.slice(0, 8)}@`;

const sourceSnapshot = (s: SourceRow) => ({
	title: s.title,
	author: s.author,
	publication: s.publication,
	abbreviation: s.abbreviation,
	text: s.text
});
const repositorySnapshot = (r: RepositoryRow) => ({ name: r.name, address: r.address });
const citationSnapshot = (c: CitationRow) => ({
	sourceId: c.sourceId,
	page: c.page,
	quality: c.quality,
	entryDate: c.entryDateRaw,
	text: c.text
});

// ---- Sources ----

function createSource(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'create_source' }>
): RowOp[] {
	const { source } = command;
	const row: SourceRow = {
		id: command.sourceId,
		treeId: ctx.treeId,
		xref: newXref('S', command.sourceId),
		xrefAliases: null,
		title: cleanBlock(source.title),
		author: cleanBlock(source.author),
		publication: cleanBlock(source.publication),
		abbreviation: cleanBlock(source.abbreviation),
		text: cleanBlock(source.text),
		gedcomExtra: null,
		gedcomLayout: null,
		createdBy: ctx.actorId,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	if (!row.title && !row.abbreviation && !row.text)
		throw new ValidationError('A source needs a title, an abbreviation or its text.');
	return [{ table: 'sources', id: row.id, before: null, after: row }];
}

function updateSource(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'update_source' }>
): RowOp[] {
	const before = requireSource(rows, command.sourceId);
	checkVersion(before, command.expectedVersion, 'source', sourceSnapshot(before));
	const patch = command.source;
	const after: SourceRow = {
		...before,
		title: patch.title !== undefined ? cleanBlock(patch.title) : before.title,
		author: patch.author !== undefined ? cleanBlock(patch.author) : before.author,
		publication:
			patch.publication !== undefined ? cleanBlock(patch.publication) : before.publication,
		abbreviation:
			patch.abbreviation !== undefined ? cleanBlock(patch.abbreviation) : before.abbreviation,
		text: patch.text !== undefined ? cleanBlock(patch.text) : before.text
	};
	if (!after.title && !after.abbreviation && !after.text)
		throw new ValidationError('A source needs a title, an abbreviation or its text.');
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	return [{ table: 'sources', id: before.id, before, after: touch(after, ctx) }];
}

const citationsOfSource = (rows: TreeRows, sourceId: string) =>
	rows.citations.filter((c) => c.sourceId === sourceId);

function deleteSource(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'delete_source' }>
): RowOp[] {
	const source = requireSource(rows, command.sourceId);
	checkVersion(source, command.expectedVersion, 'source', sourceSnapshot(source));
	const cited = citationsOfSource(rows, source.id);
	if (cited.length > 0 && !command.shouldRemoveCitations) {
		throw new SourceInUseError(
			`${cited.length} ${cited.length === 1 ? 'citation cites' : 'citations cite'} this source. Remove ${cited.length === 1 ? 'it' : 'them'} too to delete the source.`,
			cited.length
		);
	}
	const ops: RowOp[] = [
		...cited.map((c): RowOp => ({ table: 'citations', id: c.id, before: c, after: null })),
		...rows.sourceRepositories
			.filter((l) => l.sourceId === source.id)
			.map((l): RowOp => ({ table: 'source_repositories', id: l.id, before: l, after: null })),
		// Files are kept, as they are when a person is deleted: the bytes stay and undo hangs them back.
		...unlinkFilesOf(rows, new Set([source.id])),
		{ table: 'sources', id: source.id, before: source, after: null }
	];
	return limited(ops, 'This source has too many citations to delete in one change');
}

function limited(ops: RowOp[], reason: string): RowOp[] {
	if (ops.length > MAX_EVIDENCE_OPS)
		throw new ValidationError(
			`${reason}: it would change ${ops.length} records, and one change writes at most ${MAX_EVIDENCE_OPS}.`
		);
	return ops;
}

function mergeSources(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'merge_sources' }>
): RowOp[] {
	const mergedIds = [...new Set(command.mergedIds)].filter((id) => id !== command.survivorId);
	if (mergedIds.length === 0) throw new ValidationError('Choose at least two sources to merge.');
	const survivor = requireSource(rows, command.survivorId);
	const merged = mergedIds.map((id) => requireSource(rows, id));
	for (const source of [survivor, ...merged])
		checkVersion(source, command.expectedVersions?.[source.id], 'source', sourceSnapshot(source));

	const ops: RowOp[] = [];
	const mergedSet = new Set(mergedIds);

	// Citations are evidence: every one moves to the survivor, in the order it had.
	for (const citation of rows.citations.filter((c) => c.sourceId && mergedSet.has(c.sourceId))) {
		ops.push({
			table: 'citations',
			id: citation.id,
			before: citation,
			after: touch({ ...citation, sourceId: survivor.id }, ctx)
		});
	}

	// A file on a merged source is the survivor's now, so merging never leaves a file pointing at nothing.
	ops.push(...relinkFiles(rows, ctx, mergedSet, survivor.id));

	// Notes on a source are about the source: they follow it to the survivor, in the order they had.
	const notes = makeNoteMover(rows, ctx);
	for (const id of mergedIds)
		ops.push(
			...notes.move(
				{ kind: NOTE_SUBJECT_KINDS.SOURCE, id },
				{ kind: NOTE_SUBJECT_KINDS.SOURCE, id: survivor.id }
			)
		);

	// A task about a source follows it to the survivor.
	const tasks = makeTaskMover(rows, ctx);
	for (const id of mergedIds)
		ops.push(
			...tasks.move(
				{ kind: NOTE_SUBJECT_KINDS.SOURCE, id },
				{ kind: NOTE_SUBJECT_KINDS.SOURCE, id: survivor.id }
			)
		);

	// A repository the survivor already links stays linked once; a new one moves over with its call number.
	const linked = new Set(
		rows.sourceRepositories
			.filter((l) => l.sourceId === survivor.id)
			.map((l) => l.repositoryId ?? `ref:${l.repositoryRef}`)
	);
	let nextLink = Math.max(
		-1,
		...rows.sourceRepositories.filter((l) => l.sourceId === survivor.id).map((l) => l.sortOrder)
	);
	for (const link of rows.sourceRepositories.filter((l) => mergedSet.has(l.sourceId))) {
		const key = link.repositoryId ?? `ref:${link.repositoryRef}`;
		if (linked.has(key) && (link.repositoryId !== null || link.repositoryRef !== null)) {
			ops.push({ table: 'source_repositories', id: link.id, before: link, after: null });
			continue;
		}
		linked.add(key);
		ops.push({
			table: 'source_repositories',
			id: link.id,
			before: link,
			after: touch({ ...link, sourceId: survivor.id, sortOrder: ++nextLink }, ctx)
		});
	}

	// The survivor's own words win; a blank one is filled from the others, and lines the model keeps
	// (a note, a custom tag) are carried over rather than dropped.
	const fill = <K extends 'title' | 'author' | 'publication' | 'abbreviation' | 'text'>(key: K) =>
		survivor[key] ?? merged.map((m) => m[key]).find((v) => v !== null) ?? null;
	const extras = [...(survivor.gedcomExtra ?? [])];
	for (const source of merged) {
		const block = source.gedcomExtra ?? [];
		if (block.length > 0 && !extras.join('\n').includes(block.join('\n'))) extras.push(...block);
	}
	const aliases = [...(survivor.xrefAliases ?? [])];
	for (const source of merged) {
		for (const alias of [source.xref, ...(source.xrefAliases ?? [])]) {
			if (alias && alias !== survivor.xref && !aliases.includes(alias)) aliases.push(alias);
		}
		ops.push({ table: 'sources', id: source.id, before: source, after: null });
	}
	ops.push({
		table: 'sources',
		id: survivor.id,
		before: survivor,
		after: touch(
			{
				...survivor,
				title: fill('title'),
				author: fill('author'),
				publication: fill('publication'),
				abbreviation: fill('abbreviation'),
				text: fill('text'),
				gedcomExtra: extras.length > 0 ? extras : null,
				xrefAliases: aliases.length > 0 ? aliases : null
			},
			ctx
		)
	});
	return limited(ops, 'These sources have too many citations to merge in one change');
}

// ---- Repositories ----

function createRepository(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'create_repository' }>
): RowOp[] {
	const name = cleanBlock(command.repository.name);
	if (!name) throw new ValidationError('A repository needs a name.');
	const row: RepositoryRow = {
		id: command.repositoryId,
		treeId: ctx.treeId,
		xref: newXref('R', command.repositoryId),
		xrefAliases: null,
		name,
		address: cleanBlock(command.repository.address),
		gedcomExtra: null,
		gedcomLayout: null,
		createdBy: ctx.actorId,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return [{ table: 'repositories', id: row.id, before: null, after: row }];
}

function updateRepository(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'update_repository' }>
): RowOp[] {
	const before = requireRepository(rows, command.repositoryId);
	checkVersion(before, command.expectedVersion, 'repository', repositorySnapshot(before));
	const patch = command.repository;
	const after: RepositoryRow = {
		...before,
		name: patch.name !== undefined ? cleanBlock(patch.name) : before.name,
		address: patch.address !== undefined ? cleanBlock(patch.address) : before.address
	};
	if (!after.name) throw new ValidationError('A repository needs a name.');
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	return [{ table: 'repositories', id: before.id, before, after: touch(after, ctx) }];
}

function deleteRepository(
	rows: TreeRows,
	_ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'delete_repository' }>
): RowOp[] {
	const repository = requireRepository(rows, command.repositoryId);
	checkVersion(repository, command.expectedVersion, 'repository', repositorySnapshot(repository));
	// A source keeps its other repositories and loses only the link; its citations are untouched.
	return [
		...rows.sourceRepositories
			.filter((l) => l.repositoryId === repository.id)
			.map((l): RowOp => ({ table: 'source_repositories', id: l.id, before: l, after: null })),
		{ table: 'repositories', id: repository.id, before: repository, after: null }
	];
}

function linkRepository(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'link_repository' }>
): RowOp[] {
	requireSource(rows, command.sourceId);
	requireRepository(rows, command.repositoryId);
	const links = rows.sourceRepositories.filter((l) => l.sourceId === command.sourceId);
	if (links.some((l) => l.repositoryId === command.repositoryId))
		throw new ValidationError('That repository is already linked to this source.');
	const row: SourceRepositoryRow = {
		id: command.linkId,
		sourceId: command.sourceId,
		repositoryId: command.repositoryId,
		repositoryRef: null,
		callNumber: clean(command.callNumber),
		gedcomExtra: null,
		sortOrder: Math.max(-1, ...links.map((l) => l.sortOrder)) + 1,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return [{ table: 'source_repositories', id: row.id, before: null, after: row }];
}

function updateSourceRepository(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'update_source_repository' }>
): RowOp[] {
	const before = requireLink(rows, command.linkId);
	checkVersion(before, command.expectedVersion, 'source_link', { callNumber: before.callNumber });
	const callNumber = clean(command.callNumber);
	if (callNumber === before.callNumber) return [];
	return [
		{
			table: 'source_repositories',
			id: before.id,
			before,
			after: touch({ ...before, callNumber }, ctx)
		}
	];
}

function unlinkRepository(
	rows: TreeRows,
	_ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'unlink_repository' }>
): RowOp[] {
	const link = requireLink(rows, command.linkId);
	checkVersion(link, command.expectedVersion, 'source_link', { callNumber: link.callNumber });
	return [{ table: 'source_repositories', id: link.id, before: link, after: null }];
}

// ---- Citations ----

function validateQuality(quality: unknown): void {
	if (quality !== null && quality !== undefined && !isCitationQuality(quality))
		throw new ValidationError('A citation’s quality is a number from 0 to 3.');
}

function addCitation(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'add_citation' }>
): RowOp[] {
	requireSubject(rows, command.subject);
	const input = command.citation;
	if (!input.sourceId) throw new ValidationError('A citation needs a source.');
	requireSource(rows, input.sourceId);
	validateQuality(input.quality);
	const entryDate = clean(input.entryDate);
	const dates = dateColumnsFor(entryDate);
	const own = rows.citations.filter(
		(c) => c.subjectKind === command.subject.kind && c.subjectId === command.subject.id
	);
	const row: CitationRow = {
		id: command.citationId,
		treeId: ctx.treeId,
		subjectKind: command.subject.kind,
		subjectId: command.subject.id,
		sortOrder: Math.max(-1, ...own.map((c) => c.sortOrder)) + 1,
		sourceId: input.sourceId,
		sourceRef: null,
		description: null,
		page: clean(input.page),
		quality: input.quality ?? null,
		entryDateRaw: entryDate,
		entryDateSort: dates.dateSort,
		entryDateSortEnd: dates.dateSortEnd,
		entryDateQualifier: dates.dateQualifier,
		entryDatePrecision: dates.datePrecision,
		entryDateCalendar: dates.dateCalendar,
		text: cleanBlock(input.text),
		gedcomExtra: null,
		gedcomLayout: null,
		version: 1,
		createdAt: ctx.now,
		updatedAt: ctx.now
	};
	return [{ table: 'citations', id: row.id, before: null, after: row }];
}

function updateCitation(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'update_citation' }>
): RowOp[] {
	const before = requireCitation(rows, command.citationId);
	checkVersion(before, command.expectedVersion, 'citation', citationSnapshot(before));
	const patch = command.citation;
	validateQuality(patch.quality);
	if (patch.sourceId !== undefined && patch.sourceId !== before.sourceId) {
		if (!patch.sourceId) throw new ValidationError('A citation needs a source.');
		requireSource(rows, patch.sourceId);
	}
	const entryDate = patch.entryDate !== undefined ? clean(patch.entryDate) : before.entryDateRaw;
	const after: CitationRow = {
		...before,
		...(patch.sourceId ? { sourceId: patch.sourceId, sourceRef: null } : {}),
		page: patch.page !== undefined ? clean(patch.page) : before.page,
		quality: patch.quality !== undefined ? patch.quality : before.quality,
		text: patch.text !== undefined ? cleanBlock(patch.text) : before.text,
		// Unchanged date text keeps its columns as they are, so re-saving a form is not a write.
		...(entryDate !== before.entryDateRaw
			? (() => {
					const dates = dateColumnsFor(entryDate);
					return {
						entryDateRaw: entryDate,
						entryDateSort: dates.dateSort,
						entryDateSortEnd: dates.dateSortEnd,
						entryDateQualifier: dates.dateQualifier,
						entryDatePrecision: dates.datePrecision,
						entryDateCalendar: dates.dateCalendar
					};
				})()
			: {})
	};
	if (JSON.stringify(after) === JSON.stringify(before)) return [];
	return [{ table: 'citations', id: before.id, before, after: touch(after, ctx) }];
}

function removeCitation(
	rows: TreeRows,
	_ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'remove_citation' }>
): RowOp[] {
	const citation = requireCitation(rows, command.citationId);
	checkVersion(citation, command.expectedVersion, 'citation', citationSnapshot(citation));
	return [{ table: 'citations', id: citation.id, before: citation, after: null }];
}

function reorderCitations(
	rows: TreeRows,
	ctx: EvidenceContext,
	command: Extract<EvidenceCommand, { kind: 'reorder_citations' }>
): RowOp[] {
	requireSubject(rows, command.subject);
	const own = rows.citations.filter(
		(c) => c.subjectKind === command.subject.kind && c.subjectId === command.subject.id
	);
	const ids = command.orderedCitationIds;
	if (
		new Set(ids).size !== ids.length ||
		ids.length !== own.length ||
		!own.every((c) => ids.includes(c.id))
	)
		throw new ValidationError('The new order must list each citation of this record once.');
	const ops: RowOp[] = [];
	ids.forEach((id, index) => {
		const citation = own.find((c) => c.id === id)!;
		if (citation.sortOrder !== index)
			ops.push({
				table: 'citations',
				id,
				before: citation,
				after: touch({ ...citation, sortOrder: index }, ctx)
			});
	});
	return ops;
}

export function buildEvidenceOps(
	rows: TreeRows,
	command: EvidenceCommand,
	ctx: EvidenceContext
): RowOp[] {
	switch (command.kind) {
		case 'create_source':
			return createSource(rows, ctx, command);
		case 'update_source':
			return updateSource(rows, ctx, command);
		case 'delete_source':
			return deleteSource(rows, ctx, command);
		case 'merge_sources':
			return mergeSources(rows, ctx, command);
		case 'create_repository':
			return createRepository(rows, ctx, command);
		case 'update_repository':
			return updateRepository(rows, ctx, command);
		case 'delete_repository':
			return deleteRepository(rows, ctx, command);
		case 'link_repository':
			return linkRepository(rows, ctx, command);
		case 'update_source_repository':
			return updateSourceRepository(rows, ctx, command);
		case 'unlink_repository':
			return unlinkRepository(rows, ctx, command);
		case 'add_citation':
			return addCitation(rows, ctx, command);
		case 'update_citation':
			return updateCitation(rows, ctx, command);
		case 'remove_citation':
			return removeCitation(rows, ctx, command);
		case 'reorder_citations':
			return reorderCitations(rows, ctx, command);
	}
}

// ---- Citations follow their subject ----

const SUBJECT_TABLES = {
	individuals: CITATION_SUBJECT_KINDS.PERSON,
	person_names: CITATION_SUBJECT_KINDS.NAME,
	events: CITATION_SUBJECT_KINDS.EVENT,
	unions: CITATION_SUBJECT_KINDS.UNION,
	parent_child: CITATION_SUBJECT_KINDS.PARENT_CHILD
} as const;

/**
 * Deletes for the citations of every subject these ops delete, so no command that removes a person,
 * a name, a fact, a partnership or a link has to remember its evidence, and an undo restores it with
 * them. A citation an op already handles (a merge moving it) is left to that op.
 */
export function citationCascadeOps(rows: TreeRows, ops: RowOp[]): RowOp[] {
	if (rows.citations.length === 0) return [];
	const gone = new Set(
		ops
			.filter((op) => op.after === null && op.table in SUBJECT_TABLES)
			.map((op) => `${SUBJECT_TABLES[op.table as keyof typeof SUBJECT_TABLES]}|${op.id}`)
	);
	if (gone.size === 0) return [];
	const handled = new Set(ops.filter((op) => op.table === 'citations').map((op) => op.id));
	return rows.citations
		.filter((c) => gone.has(`${c.subjectKind}|${c.subjectId}`) && !handled.has(c.id))
		.map((c): RowOp => ({ table: 'citations', id: c.id, before: c, after: null }));
}

/**
 * Moves what a subject owns, its citations, its notes and the tasks about it, to another subject: after the ones the
 * target has and in their own order, for the commands that fold one record into another. State is
 * kept across calls so two records folded into one survivor do not collide.
 */
export function makeEvidenceMover(rows: TreeRows, ctx: Pick<EvidenceContext, 'now'>) {
	const next = new Map<string, number>();
	for (const c of rows.citations) {
		const key = `${c.subjectKind}|${c.subjectId}`;
		next.set(key, Math.max(next.get(key) ?? 0, c.sortOrder + 1));
	}
	const notes = makeNoteMover(rows, ctx);
	const tasks = makeTaskMover(rows, ctx);
	return {
		move(from: CitationSubjectRef, to: CitationSubjectRef): RowOp[] {
			const moved = rows.citations
				.filter((c) => c.subjectKind === from.kind && c.subjectId === from.id)
				.sort((a, b) => a.sortOrder - b.sortOrder);
			const toKey = `${to.kind}|${to.id}`;
			const citationOps = moved.map((citation): RowOp => {
				const sortOrder = next.get(toKey) ?? 0;
				next.set(toKey, sortOrder + 1);
				return {
					table: 'citations',
					id: citation.id,
					before: citation,
					after: {
						...citation,
						subjectKind: to.kind,
						subjectId: to.id,
						sortOrder,
						version: citation.version + 1,
						updatedAt: ctx.now
					}
				};
			});
			return [...citationOps, ...notes.move(from, to), ...tasks.move(from, to)];
		}
	};
}
