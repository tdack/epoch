/**
 * ADR-055, layer (b) for the evidence kinds: planning over `selectScope(whole, seed)` must equal
 * planning over the whole tree, for an unrestricted viewer, a restricted one and a contributor who
 * made some of the people. Three worlds: The Simpsons and a generated corpus, each with a spread of
 * evidence added in memory, and a small hand-built one whose records are placed to catch a seed
 * that is too small (a source or note that exists for a restricted viewer only through records the
 * seed did not load).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsons from '../../../../../test/data/The Simpsons.ged?raw';
import { ChangeStore } from '../../repositories/change-store';
import { insertCorpus } from '../../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../../testing/d1';
import {
	mkAttachment,
	mkCitation,
	mkLink,
	mkNote,
	mkRepository,
	mkSource,
	mkTask
} from '../../testing/evidence-rows';
import { importGedcomToDb } from '../../testing/gedcom';
import { treeRows } from '../../testing/rows';
import {
	expectScopedEqualsWhole,
	selectScopeWithFollowUp,
	viewerScopes
} from '../../testing/scope-equivalence';
import { addEvidence as addEvidenceToDb, seededRandom } from '../../testing/evidence-fixtures';
import { MutationRunner } from '../../services/mutation-runner';
import type { CitationRow, NoteAttachmentRow, ResearchTaskRow, TreeRows } from '../change-log';
import type { NoteSubjectRef } from '../../../shared/notes';
import type { RelationshipCommand } from '../relationship-commands';
import { selectScope, type ScopeSeed } from '../write-scope';
import { seedFor } from './index';

const CREATOR = 'creator-1';
const scopes = viewerScopes(CREATOR);

/** The kinds proved here. Each must have a seed, and the others must not. */
const ENABLED = [
	'create_source',
	'update_source',
	'delete_source',
	'create_repository',
	'add_citation',
	'update_citation',
	'remove_citation',
	'reorder_citations',
	'add_note',
	'reorder_notes',
	'create_note',
	'create_task',
	'update_repository',
	'delete_repository',
	'link_repository',
	'update_source_repository',
	'unlink_repository',
	'update_note',
	'remove_note',
	'share_note',
	'attach_note',
	'update_shared_note',
	'delete_shared_note',
	'update_task',
	'delete_task'
] as const;

/** The kinds scoped with the evidence follow-up; each is proved with and without it below. */
const NEWLY_SCOPED: string[] = [
	'update_repository',
	'delete_repository',
	'link_repository',
	'update_source_repository',
	'unlink_repository',
	'update_note',
	'remove_note',
	'share_note',
	'attach_note',
	'update_shared_note',
	'delete_shared_note',
	'update_task',
	'delete_task'
];

function rng(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let n = state;
		n = Math.imul(n ^ (n >>> 15), n | 1);
		n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
		return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
	};
}

type SubjectKind = 'person' | 'name' | 'event' | 'union' | 'parent_child';

/**
 * Evidence spread over a tree the way research spreads it: one source cited by very many records
 * and the last ones by a single record, citations on every kind of subject including living
 * people, shared notes used by many records and notes that sit only on a source or a repository,
 * inline notes, notes on citations, tasks about every kind of record, and a share of the records
 * made by the contributor. The first source, repository and note own the XREF a new record's id
 * would try first, so creating one has to look at the XREFs already taken.
 */
function addEvidence(rows: TreeRows, random: () => number, prefix: string): TreeRows {
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const id = (kind: string, n: number) => `${prefix}-${kind}-${n}`;
	const own = (n: number) => (n % 4 === 0 ? CREATOR : null);
	const xrefOf = (letter: string, recordId: string, n: number) =>
		n === 0
			? `@${letter}${recordId
					.replace(/[^A-Za-z0-9]/g, '')
					.toUpperCase()
					.slice(0, 8)}@`
			: `@${letter}${prefix}${n}@`;

	const sources = Array.from({ length: 14 }, (_, n) =>
		mkSource(id('source', n), {
			xref: xrefOf('S', id('source', n), n),
			createdBy: own(n + 1),
			version: 1 + (n % 3)
		})
	);
	const repositories = Array.from({ length: 5 }, (_, n) =>
		mkRepository(id('repository', n), {
			xref: xrefOf('R', id('repository', n), n),
			createdBy: own(n + 2)
		})
	);
	const sourceRepositories = sources
		.map((s, n) => ({ s, n }))
		.filter(({ n }) => n % 3 !== 2)
		.map(({ s, n }) => mkLink(id('link', n), s.id, repositories[n % 4]!.id));
	const notes = Array.from({ length: 10 }, (_, n) =>
		mkNote(id('sharednote', n), {
			xref: xrefOf('N', id('sharednote', n), n),
			createdBy: own(n + 3)
		})
	);

	const people = rows.individuals;
	const subjects: Array<[SubjectKind, string]> = [];
	for (let i = 0; i < 90; i++) {
		subjects.push(['person', pick(people).id]);
		if (rows.personNames.length > 0) subjects.push(['name', pick(rows.personNames).id]);
		if (rows.events.length > 0) subjects.push(['event', pick(rows.events).id]);
		if (rows.unions.length > 0 && i % 3 === 0) subjects.push(['union', pick(rows.unions).id]);
		if (rows.parentChild.length > 0 && i % 3 === 0)
			subjects.push(['parent_child', pick(rows.parentChild).id]);
	}
	const citations: CitationRow[] = [];
	const nextOrder = new Map<string, number>();
	subjects.forEach(([kind, subjectId], n) => {
		const key = `${kind}|${subjectId}`;
		const sortOrder = nextOrder.get(key) ?? 0;
		nextOrder.set(key, sortOrder + 1);
		const r = random();
		const sourceId =
			r < 0.35
				? sources[0]!.id
				: r < 0.9
					? pick(sources.slice(1, 11)).id
					: r < 0.97
						? null
						: sources[12]!.id;
		citations.push(mkCitation(id('cite', n), kind, subjectId, sourceId, sortOrder));
	});
	// The last source is cited once, by a person the contributor made.
	const mine = people.find((p) => p.createdBy === CREATOR) ?? people[0]!;
	citations.push(mkCitation(id('cite', 9000), 'person', mine.id, sources[13]!.id, 99));

	const attachments: NoteAttachmentRow[] = [];
	const orderOf = new Map<string, number>();
	const attach = (
		subjectKind: NoteAttachmentRow['subjectKind'],
		subjectId: string,
		noteId: string | null
	) => {
		const key = `${subjectKind}|${subjectId}`;
		const sortOrder = orderOf.get(key) ?? 0;
		orderOf.set(key, sortOrder + 1);
		attachments.push(
			mkAttachment(id('att', attachments.length), subjectKind, subjectId, noteId, sortOrder)
		);
	};
	for (let i = 0; i < 70; i++) {
		attach('person', pick(people).id, i % 2 === 0 ? pick(notes.slice(0, 7)).id : null);
		if (rows.events.length > 0)
			attach('event', pick(rows.events).id, i % 3 === 0 ? pick(notes).id : null);
		if (rows.personNames.length > 0 && i % 4 === 0) attach('name', pick(rows.personNames).id, null);
		if (rows.unions.length > 0 && i % 5 === 0)
			attach('union', pick(rows.unions).id, pick(notes).id);
		if (rows.parentChild.length > 0 && i % 5 === 0)
			attach('parent_child', pick(rows.parentChild).id, null);
	}
	for (let i = 0; i < 14; i++) {
		attach('citation', pick(citations).id, i % 2 === 0 ? pick(notes).id : null);
		attach('source', pick(sources).id, i % 2 === 0 ? pick(notes).id : null);
	}
	attach('source', sources[1]!.id, notes[7]!.id);
	attach('source', sources[5]!.id, notes[8]!.id);
	attach('repository', repositories[1]!.id, notes[9]!.id);
	attach('repository', repositories[2]!.id, null);

	const tasks: ResearchTaskRow[] = [mkTask(id('task', 0), null, null)];
	const task = (kind: ResearchTaskRow['subjectKind'], subjectId: string, n: number) =>
		tasks.push(
			mkTask(id('task', tasks.length), kind, subjectId, {
				status: n % 5 === 0 ? 'done' : 'open',
				createdBy: own(n)
			})
		);
	for (let i = 1; i <= 40; i++) {
		task('person', pick(people).id, i);
		if (rows.events.length > 0 && i % 2 === 0) task('event', pick(rows.events).id, i);
		if (rows.unions.length > 0 && i % 4 === 0) task('union', pick(rows.unions).id, i);
	}
	for (let i = 0; i < 12; i++) {
		task('source', pick(sources).id, i);
		task('note', pick(notes).id, i);
	}

	return {
		...rows,
		sources,
		repositories,
		sourceRepositories,
		citations,
		notes,
		noteAttachments: attachments,
		researchTasks: tasks
	};
}

/** A share of people made by the contributor, who sees them while they are still private. */
function markCreator(rows: TreeRows, random: () => number) {
	for (const p of rows.individuals) if (random() < 0.12) p.createdBy = CREATOR;
}

/**
 * The small world: every record is placed so that what a restricted viewer sees of it depends on
 * records a too-small seed would not load. `dead1`/`dead2` are public, `living` was made by the
 * contributor, `hidden` is living and made by no one.
 */
function trapWorld(): TreeRows {
	const dead = (id: string) => ({
		id: `birt-${id}`,
		entityId: id,
		type: 'BIRT',
		dateRaw: '1902',
		dateSort: '1902-01-01',
		dateSortEnd: '1902-12-31'
	});
	const rows = treeRows({
		people: ['dead1', 'dead2', 'dead3', 'dead4', 'dead5', 'dead6', 'living', 'hidden'].map(
			(id) => ({ id })
		),
		events: [
			dead('dead1'),
			dead('dead2'),
			dead('dead3'),
			dead('dead4'),
			dead('dead5'),
			dead('dead6')
		],
		unions: [
			{ id: 'u1', partners: ['dead1', 'dead2'] },
			// No partners: the whole tree's mask drops it as soon as anyone is private.
			{ id: 'u-lonely', partners: [], marriage: '1920' }
		],
		links: [
			{ parentId: 'dead1', childId: 'hidden', unionId: 'u1' },
			// Its partnership has no partners.
			{ parentId: 'dead5', childId: 'dead6', unionId: 'u-lonely' }
		]
	});
	rows.individuals.find((p) => p.id === 'living')!.createdBy = CREATOR;
	return {
		...rows,
		sources: [
			// Cited by a public person only: exists for everyone, but only through that citation.
			mkSource('s-public'),
			// Cited by a hidden person only: absent for a restricted viewer.
			mkSource('s-hidden'),
			// Cited by both.
			mkSource('s-both'),
			// Cited by nothing; the contributor made it.
			mkSource('s-own', { createdBy: CREATOR }),
			// Cited by nothing and made by no one: absent for a restricted viewer.
			mkSource('s-orphan'),
			// Cited by an unrelated public person.
			mkSource('s-solo')
		],
		repositories: [
			mkRepository('r-public'),
			mkRepository('r-hidden'),
			mkRepository('r-both'),
			mkRepository('r-none'),
			mkRepository('r-own', { createdBy: CREATOR })
		],
		sourceRepositories: [
			mkLink('l1', 's-public', 'r-public'),
			mkLink('l2', 's-hidden', 'r-hidden'),
			mkLink('l3', 's-public', 'r-both'),
			mkLink('l4', 's-both', 'r-both')
		],
		citations: [
			mkCitation('c-public', 'person', 'dead1', 's-public'),
			mkCitation('c-hidden', 'person', 'hidden', 's-hidden'),
			mkCitation('c-both-1', 'person', 'dead2', 's-both'),
			mkCitation('c-both-2', 'person', 'hidden', 's-both', 1),
			mkCitation('c-living', 'person', 'living', 's-public', 1),
			mkCitation('c-union', 'union', 'u1', null),
			mkCitation('c-solo', 'person', 'dead4', 's-solo')
		],
		notes: [
			mkNote('n-source'),
			mkNote('n-person'),
			mkNote('n-repository'),
			mkNote('n-hidden'),
			mkNote('n-both'),
			mkNote('n-loose'),
			mkNote('n-own', { createdBy: CREATOR }),
			mkNote('n-citation')
		],
		noteAttachments: [
			// Visible only because s-public is.
			mkAttachment('a-source', 'source', 's-public', 'n-source'),
			mkAttachment('a-person', 'person', 'dead2', 'n-person'),
			mkAttachment('a-person-2', 'person', 'dead2', null, 1),
			// Visible only because r-public is, which only s-public makes visible.
			mkAttachment('a-repository', 'repository', 'r-public', 'n-repository'),
			mkAttachment('a-hidden', 'person', 'hidden', 'n-hidden'),
			mkAttachment('a-both-1', 'person', 'dead1', 'n-both'),
			mkAttachment('a-both-2', 'person', 'hidden', 'n-both'),
			mkAttachment('a-hidden-source', 'source', 's-hidden', 'n-hidden', 1),
			mkAttachment('a-citation', 'citation', 'c-public', 'n-citation'),
			mkAttachment('a-inline-source', 'source', 's-public', null, 1)
		],
		researchTasks: [
			mkTask('t-none', null, null),
			mkTask('t-source', 'source', 's-public'),
			mkTask('t-hidden-source', 'source', 's-hidden'),
			mkTask('t-note', 'note', 'n-source'),
			mkTask('t-hidden-note', 'note', 'n-hidden'),
			mkTask('t-repository-note', 'note', 'n-repository'),
			mkTask('t-person', 'person', 'dead1'),
			mkTask('t-hidden-person', 'person', 'hidden'),
			mkTask('t-living', 'person', 'living', { createdBy: CREATOR })
		]
	};
}

// ---- Commands ----

const reversed = <T>(list: T[]) => [...list].reverse();

/**
 * The commands to try against a world: for each sampled record, every kind of command that names
 * it, plus commands naming a missing id and ones about living people. `limit` caps how many
 * records of a table are sampled; Infinity takes them all.
 */
function commandsFor(
	rows: TreeRows,
	prefix: string,
	limit: number,
	random: () => number
): RelationshipCommand[] {
	const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
	const choose = <T>(list: readonly T[], n: number): T[] =>
		n >= list.length ? [...list] : Array.from({ length: n }, () => pick(list));
	const commands: RelationshipCommand[] = [];
	let counter = 0;
	const fresh = (kind: string) => `new-${kind}-${counter++}`;
	const anyOf = <T extends { id: string }>(list: readonly T[], fallback = 'none') =>
		list.length > 0 ? pick(list).id : fallback;
	const subjectIn = (): { kind: SubjectKind; id: string } =>
		pick<{ kind: SubjectKind; id: string }>([
			{ kind: 'person', id: anyOf(rows.individuals) },
			{ kind: 'name', id: anyOf(rows.personNames) },
			{ kind: 'event', id: anyOf(rows.events) },
			{ kind: 'union', id: anyOf(rows.unions) },
			{ kind: 'parent_child', id: anyOf(rows.parentChild) }
		]);
	const anySource = () => anyOf(rows.sources);
	const missing = 'no-such-record';

	commands.push(
		{ kind: 'update_source', sourceId: missing, source: { title: 'x' } },
		{ kind: 'delete_source', sourceId: missing },
		{
			kind: 'add_citation',
			citationId: fresh('c'),
			subject: { kind: 'person', id: missing },
			citation: { sourceId: anySource() }
		},
		{
			kind: 'add_citation',
			citationId: fresh('c'),
			subject: subjectIn(),
			citation: { sourceId: missing }
		},
		{ kind: 'add_citation', citationId: fresh('c'), subject: subjectIn(), citation: {} },
		{ kind: 'update_citation', citationId: missing, citation: { page: 'x' } },
		{ kind: 'remove_citation', citationId: missing },
		{ kind: 'reorder_citations', subject: { kind: 'person', id: missing }, orderedCitationIds: [] },
		{
			kind: 'add_note',
			attachmentId: fresh('a'),
			subject: { kind: 'person', id: missing },
			text: 'x'
		},
		{ kind: 'reorder_notes', subject: { kind: 'person', id: missing }, orderedAttachmentIds: [] },
		{
			kind: 'create_task',
			taskId: fresh('t'),
			task: { title: 'T' },
			subject: { kind: 'person', id: missing }
		},
		{
			kind: 'create_task',
			taskId: fresh('t'),
			task: { title: 'T' },
			subject: { kind: 'note', id: missing }
		},
		{
			kind: 'create_task',
			taskId: fresh('t'),
			task: { title: 'T' },
			subject: { kind: 'source', id: missing }
		}
	);

	for (const s of choose(rows.sources, limit)) {
		commands.push(
			{ kind: 'update_source', sourceId: s.id, source: { title: 'Renamed', author: 'An Author' } },
			{ kind: 'update_source', sourceId: s.id, source: { title: '', text: '' } },
			{ kind: 'update_source', sourceId: s.id, expectedVersion: 99, source: { title: 'Stale' } },
			{ kind: 'delete_source', sourceId: s.id },
			{ kind: 'delete_source', sourceId: s.id, shouldRemoveCitations: true },
			{
				kind: 'add_citation',
				citationId: fresh('c'),
				subject: subjectIn(),
				citation: { sourceId: s.id, page: 'p. 1', quality: 3 }
			},
			{
				kind: 'add_note',
				attachmentId: fresh('a'),
				subject: { kind: 'source', id: s.id },
				text: 'On a source'
			},
			{
				kind: 'reorder_notes',
				subject: { kind: 'source', id: s.id },
				orderedAttachmentIds: reversed(
					rows.noteAttachments
						.filter((a) => a.subjectKind === 'source' && a.subjectId === s.id)
						.sort((a, b) => a.sortOrder - b.sortOrder)
						.map((a) => a.id)
				)
			},
			{
				kind: 'create_task',
				taskId: fresh('t'),
				task: { title: 'About a source' },
				subject: { kind: 'source', id: s.id }
			}
		);
	}
	commands.push(
		{ kind: 'create_source', sourceId: fresh('s'), source: { title: 'A new source' } },
		{ kind: 'create_source', sourceId: fresh('s'), source: {} },
		{ kind: 'create_source', sourceId: `${prefix}-source-new`, source: { title: 'Clash' } },
		{ kind: 'create_repository', repositoryId: fresh('r'), repository: { name: 'New repo' } },
		{ kind: 'create_repository', repositoryId: fresh('r'), repository: { name: ' ' } },
		{
			kind: 'create_repository',
			repositoryId: `${prefix}-repository-new`,
			repository: { name: 'Clash' }
		},
		{ kind: 'create_note', noteId: fresh('n'), note: { text: 'A new shared note' } },
		{ kind: 'create_note', noteId: fresh('n'), note: { text: '  ' } },
		{ kind: 'create_note', noteId: `${prefix}-sharednote-new`, note: { text: 'Clash' } }
	);

	for (const c of choose(rows.citations, limit)) {
		const siblings = rows.citations
			.filter((o) => o.subjectKind === c.subjectKind && o.subjectId === c.subjectId)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((o) => o.id);
		const subject = { kind: c.subjectKind as SubjectKind, id: c.subjectId };
		commands.push(
			{ kind: 'update_citation', citationId: c.id, citation: { page: 'p. 12', quality: 3 } },
			{ kind: 'update_citation', citationId: c.id, citation: { sourceId: anySource() } },
			{ kind: 'update_citation', citationId: c.id, citation: { sourceId: missing } },
			{ kind: 'update_citation', citationId: c.id, expectedVersion: 7, citation: { page: 'x' } },
			{ kind: 'remove_citation', citationId: c.id },
			{ kind: 'reorder_citations', subject, orderedCitationIds: reversed(siblings) },
			{ kind: 'reorder_citations', subject, orderedCitationIds: siblings.slice(1) },
			{
				kind: 'add_citation',
				citationId: fresh('c'),
				subject,
				citation: { sourceId: anySource(), page: 'new' }
			},
			{
				kind: 'add_note',
				attachmentId: fresh('a'),
				subject: { kind: 'citation', id: c.id },
				text: 'On a citation'
			}
		);
	}
	for (let i = 0; i < Math.min(limit, 40); i++)
		commands.push({
			kind: 'add_citation',
			citationId: fresh('c'),
			subject: subjectIn(),
			citation: { sourceId: anySource(), entryDate: '1 JAN 1900' }
		});

	for (const a of choose(rows.noteAttachments, limit)) {
		const siblings = rows.noteAttachments
			.filter((o) => o.subjectKind === a.subjectKind && o.subjectId === a.subjectId)
			.sort((x, y) => x.sortOrder - y.sortOrder)
			.map((o) => o.id);
		const subject = { kind: a.subjectKind as 'person', id: a.subjectId };
		commands.push(
			{ kind: 'reorder_notes', subject, orderedAttachmentIds: reversed(siblings) },
			{ kind: 'reorder_notes', subject, orderedAttachmentIds: siblings.slice(1) },
			{ kind: 'add_note', attachmentId: fresh('a'), subject, text: 'Another' }
		);
	}
	for (let i = 0; i < Math.min(limit, 30); i++) {
		const subject = pick<{
			kind: 'person' | 'event' | 'source' | 'citation' | 'repository' | 'union';
			id: string;
		}>([
			{ kind: 'person', id: anyOf(rows.individuals) },
			{ kind: 'event', id: anyOf(rows.events) },
			{ kind: 'source', id: anySource() },
			{ kind: 'citation', id: anyOf(rows.citations) },
			{ kind: 'repository', id: anyOf(rows.repositories) },
			{ kind: 'union', id: anyOf(rows.unions) }
		]);
		commands.push({ kind: 'add_note', attachmentId: fresh('a'), subject, text: 'Anywhere' });
	}
	for (const n of rows.notes.slice(0, limit)) {
		commands.push({
			kind: 'create_task',
			taskId: fresh('t'),
			task: { title: 'About a note' },
			subject: { kind: 'note', id: n.id }
		});
	}

	for (let i = 0; i < Math.min(limit, 12); i++) {
		commands.push(
			{
				kind: 'create_task',
				taskId: fresh('t'),
				task: { title: 'Person task' },
				subject: { kind: 'person', id: anyOf(rows.individuals) }
			},
			{
				kind: 'create_task',
				taskId: fresh('t'),
				task: { title: 'Fact task', dueDate: '2030-01-31' },
				subject: { kind: 'event', id: anyOf(rows.events) }
			},
			{
				kind: 'create_task',
				taskId: fresh('t'),
				task: { title: 'Union task' },
				subject: { kind: 'union', id: anyOf(rows.unions) }
			},
			{ kind: 'create_task', taskId: fresh('t'), task: { title: 'Loose task' }, subject: null },
			{ kind: 'create_task', taskId: fresh('t'), task: { title: 'No subject at all' } },
			{ kind: 'create_task', taskId: fresh('t'), task: { title: ' ' } }
		);
	}

	// Records about living people, whom a restricted viewer cannot see.
	const living = rows.individuals.filter(
		(p) => !rows.events.some((e) => e.entityId === p.id && e.type === 'DEAT')
	);
	for (const p of choose(living, Math.min(limit, 14))) {
		const citation = rows.citations.find((c) => c.subjectKind === 'person' && c.subjectId === p.id);
		commands.push(
			{
				kind: 'add_citation',
				citationId: fresh('c'),
				subject: { kind: 'person', id: p.id },
				citation: { sourceId: anySource() }
			},
			{
				kind: 'add_note',
				attachmentId: fresh('a'),
				subject: { kind: 'person', id: p.id },
				text: 'About a living person'
			},
			{
				kind: 'create_task',
				taskId: fresh('t'),
				task: { title: 'About a living person' },
				subject: { kind: 'person', id: p.id }
			}
		);
		if (citation)
			commands.push(
				{ kind: 'remove_citation', citationId: citation.id },
				{ kind: 'update_citation', citationId: citation.id, citation: { page: 'living' } },
				{
					kind: 'update_citation',
					citationId: citation.id,
					citation: { sourceId: anySource() }
				}
			);
	}

	// ---- Repositories, notes and tasks found by id ----
	const repoEdits = (id: string) =>
		[
			{
				kind: 'update_repository',
				repositoryId: id,
				repository: { name: 'Renamed', address: 'Here' }
			},
			{ kind: 'update_repository', repositoryId: id, repository: { name: ' ' } },
			{
				kind: 'update_repository',
				repositoryId: id,
				expectedVersion: 99,
				repository: { name: 'x' }
			},
			{ kind: 'delete_repository', repositoryId: id },
			{ kind: 'delete_repository', repositoryId: id, expectedVersion: 99 }
		] as RelationshipCommand[];
	commands.push(
		...repoEdits(missing),
		{
			kind: 'link_repository',
			linkId: fresh('l'),
			sourceId: missing,
			repositoryId: anyOf(rows.repositories)
		},
		{ kind: 'link_repository', linkId: fresh('l'), sourceId: anySource(), repositoryId: missing },
		{ kind: 'update_source_repository', linkId: missing, callNumber: 'x' },
		{ kind: 'unlink_repository', linkId: missing },
		{ kind: 'update_note', attachmentId: missing, text: 'x' },
		{ kind: 'remove_note', attachmentId: missing },
		{ kind: 'share_note', attachmentId: missing, noteId: fresh('n') },
		{
			kind: 'attach_note',
			attachmentId: fresh('a'),
			subject: { kind: 'person', id: missing },
			noteId: anyOf(rows.notes)
		},
		{
			kind: 'attach_note',
			attachmentId: fresh('a'),
			subject: { kind: 'person', id: anyOf(rows.individuals) },
			noteId: missing
		},
		{ kind: 'update_shared_note', noteId: missing, note: { text: 'x' } },
		{ kind: 'delete_shared_note', noteId: missing },
		{ kind: 'update_task', taskId: missing, task: { title: 'x' } },
		{ kind: 'delete_task', taskId: missing }
	);
	for (const r of choose(rows.repositories, limit)) {
		commands.push(...repoEdits(r.id));
		for (const source of choose(rows.sources, 2))
			commands.push({
				kind: 'link_repository',
				linkId: fresh('l'),
				sourceId: source.id,
				repositoryId: r.id,
				callNumber: 'Box 1'
			});
		commands.push({
			kind: 'add_note',
			attachmentId: fresh('a'),
			subject: { kind: 'repository', id: r.id },
			text: 'On a repository'
		});
	}
	for (const l of choose(rows.sourceRepositories, limit)) {
		commands.push(
			{ kind: 'update_source_repository', linkId: l.id, callNumber: 'MS 12' },
			{ kind: 'update_source_repository', linkId: l.id, callNumber: l.callNumber },
			{ kind: 'update_source_repository', linkId: l.id, callNumber: null },
			{ kind: 'update_source_repository', linkId: l.id, expectedVersion: 99, callNumber: 'x' },
			{ kind: 'unlink_repository', linkId: l.id },
			{ kind: 'unlink_repository', linkId: l.id, expectedVersion: 99 }
		);
	}

	for (const a of choose(rows.noteAttachments, limit)) {
		commands.push(
			{ kind: 'update_note', attachmentId: a.id, text: 'Reworded' },
			{ kind: 'update_note', attachmentId: a.id, text: ' ' },
			{ kind: 'update_note', attachmentId: a.id, expectedVersion: 99, text: 'Stale' },
			{ kind: 'remove_note', attachmentId: a.id },
			{ kind: 'remove_note', attachmentId: a.id, expectedVersion: 99 },
			{ kind: 'share_note', attachmentId: a.id, noteId: fresh('n') },
			{ kind: 'share_note', attachmentId: a.id, noteId: `${prefix}-sharednote-new` },
			{ kind: 'share_note', attachmentId: a.id, expectedVersion: 99, noteId: fresh('n') }
		);
	}
	// Notes on a source, on a repository, on a citation and on a person are all in play: sample each.
	for (const kind of ['source', 'repository', 'citation', 'person'] as const) {
		for (const a of choose(
			rows.noteAttachments.filter((x) => x.subjectKind === kind),
			Math.min(limit, 10)
		))
			commands.push(
				{ kind: 'update_note', attachmentId: a.id, text: `Edited on a ${kind}` },
				{ kind: 'remove_note', attachmentId: a.id },
				{ kind: 'share_note', attachmentId: a.id, noteId: fresh('n') }
			);
	}
	for (let i = 0; i < Math.min(limit, 40); i++) {
		const subject = pick<NoteSubjectRef>([
			{ kind: 'person', id: anyOf(rows.individuals) },
			{ kind: 'name', id: anyOf(rows.personNames) },
			{ kind: 'event', id: anyOf(rows.events) },
			{ kind: 'union', id: anyOf(rows.unions) },
			{ kind: 'parent_child', id: anyOf(rows.parentChild) },
			{ kind: 'source', id: anySource() },
			{ kind: 'citation', id: anyOf(rows.citations) },
			{ kind: 'repository', id: anyOf(rows.repositories) }
		]);
		const used = rows.noteAttachments.find(
			(x) => x.subjectKind === subject.kind && x.subjectId === subject.id && x.noteId
		);
		commands.push({
			kind: 'attach_note',
			attachmentId: fresh('a'),
			subject,
			noteId: anyOf(rows.notes)
		});
		// Already on the record: refused.
		if (used)
			commands.push({
				kind: 'attach_note',
				attachmentId: fresh('a'),
				subject,
				noteId: used.noteId!
			});
	}
	for (const n of choose(rows.notes, limit)) {
		commands.push(
			{ kind: 'update_shared_note', noteId: n.id, note: { text: 'Reworded', language: 'en-AU' } },
			{ kind: 'update_shared_note', noteId: n.id, note: {} },
			{ kind: 'update_shared_note', noteId: n.id, note: { text: ' ' } },
			{ kind: 'update_shared_note', noteId: n.id, expectedVersion: 99, note: { text: 'Stale' } },
			{ kind: 'delete_shared_note', noteId: n.id },
			{ kind: 'delete_shared_note', noteId: n.id, shouldDetach: true },
			{ kind: 'delete_shared_note', noteId: n.id, expectedVersion: 99, shouldDetach: true }
		);
	}

	for (const t of choose(rows.researchTasks, limit)) {
		commands.push(
			{ kind: 'update_task', taskId: t.id, task: { title: 'Retitled', status: 'done' } },
			{ kind: 'update_task', taskId: t.id, task: { details: 'More', dueDate: '2031-02-03' } },
			{ kind: 'update_task', taskId: t.id, task: {} },
			{ kind: 'update_task', taskId: t.id, task: { title: ' ' } },
			{ kind: 'update_task', taskId: t.id, expectedVersion: 99, task: { title: 'Stale' } },
			{ kind: 'delete_task', taskId: t.id },
			{ kind: 'delete_task', taskId: t.id, expectedVersion: 99 }
		);
	}
	// Tasks about each kind of subject are all in play: sample each.
	for (const kind of ['person', 'union', 'event', 'source', 'note'] as const) {
		for (const t of choose(
			rows.researchTasks.filter((x) => x.subjectKind === kind),
			Math.min(limit, 10)
		))
			commands.push(
				{ kind: 'update_task', taskId: t.id, task: { status: 'dropped' } },
				{ kind: 'delete_task', taskId: t.id }
			);
	}
	return commands;
}

interface Tally {
	compared: number;
	succeeded: number;
	covered: Set<string>;
	differences: string[];
}

/** Cases planned and cases refused (on both sides alike) per kind, across every world. */
const totals = new Map<string, { compared: number; refused: number }>();

/** Compares every command with a seed, for the three viewers; a difference is reported, not thrown. */
function compareAll(rows: TreeRows, commands: RelationshipCommand[]): Tally {
	const tally: Tally = { compared: 0, succeeded: 0, covered: new Set(), differences: [] };
	for (const command of commands) {
		const seed = seedFor([command]);
		if (!seed) continue;
		tally.covered.add(command.kind);
		for (const [who, scope] of Object.entries(scopes)) {
			try {
				const outcome = expectScopedEqualsWhole({
					whole: rows,
					commands: [command],
					scope,
					seed,
					label: `${who} ${JSON.stringify(command)}`
				});
				tally.compared++;
				const total = totals.get(command.kind) ?? { compared: 0, refused: 0 };
				total.compared++;
				if (outcome.failure) total.refused++;
				totals.set(command.kind, total);
				if (!outcome.failure) tally.succeeded++;
			} catch {
				tally.differences.push(`${who} ${JSON.stringify(command)}`);
			}
		}
	}
	return tally;
}

function expectEquivalent(tally: Tally) {
	expect(tally.differences, `${tally.differences.length} differences`).toEqual([]);
	// Nearly every case failing the same way on both sides would prove little.
	expect(tally.succeeded).toBeGreaterThan(tally.compared / 4);
	expect([...tally.covered].sort()).toEqual([...ENABLED].sort());
}

type FollowUpCase = [label: string, command: RelationshipCommand];

/** Kinds that have a seed with the follow-up, with the command that shows it matters. */
const FOLLOW_UP_CASES: FollowUpCase[] = [
	[
		'update_repository',
		{ kind: 'update_repository', repositoryId: 'r-public', repository: { name: 'x' } }
	],
	['delete_repository', { kind: 'delete_repository', repositoryId: 'r-public' }],
	[
		'link_repository',
		{ kind: 'link_repository', linkId: 'new', sourceId: 's-solo', repositoryId: 'r-public' }
	],
	['update_source_repository', { kind: 'update_source_repository', linkId: 'l1', callNumber: 'x' }],
	['unlink_repository', { kind: 'unlink_repository', linkId: 'l1' }],
	// A note on a source, on a repository and used on a repository.
	['update_note', { kind: 'update_note', attachmentId: 'a-source', text: 'x' }],
	['update_note on a repository', { kind: 'update_note', attachmentId: 'a-repository', text: 'x' }],
	['remove_note', { kind: 'remove_note', attachmentId: 'a-source' }],
	['share_note', { kind: 'share_note', attachmentId: 'a-inline-source', noteId: 'new' }],
	[
		'attach_note a note on a source',
		{
			kind: 'attach_note',
			attachmentId: 'new',
			subject: { kind: 'person', id: 'dead3' },
			noteId: 'n-source'
		}
	],
	[
		'attach_note on a repository',
		{
			kind: 'attach_note',
			attachmentId: 'new',
			subject: { kind: 'repository', id: 'r-public' },
			noteId: 'n-loose'
		}
	],
	['update_shared_note', { kind: 'update_shared_note', noteId: 'n-source', note: { text: 'x' } }],
	[
		'update_shared_note used on a repository',
		{ kind: 'update_shared_note', noteId: 'n-repository', note: { text: 'x' } }
	],
	['delete_shared_note', { kind: 'delete_shared_note', noteId: 'n-source', shouldDetach: true }],
	// A task about a source, about a note, and about a note that is used on a repository.
	['update_task', { kind: 'update_task', taskId: 't-source', task: { title: 'x' } }],
	['delete_task', { kind: 'delete_task', taskId: 't-note' }],
	[
		'delete_task about a note on a repository',
		{ kind: 'delete_task', taskId: 't-repository-note' }
	],
	[
		'create_task about a note used on a repository',
		{
			kind: 'create_task',
			taskId: 'new',
			task: { title: 'T' },
			subject: { kind: 'note', id: 'n-repository' }
		}
	]
];

// ---- The suites ----

let db: TestDatabase;
const worlds: Array<{ label: string; prefix: string; rows: TreeRows; limit: number }> = [];

beforeAll(async () => {
	db = await createTestDatabase();
	const actor = await createTestUser(db.db);

	const simpsonsTree = await createTestTree(db.db, actor);
	await importGedcomToDb(db.d1, simpsonsTree, simpsons, 'Simpsons');
	const small = await new ChangeStore(db.db).loadRows(simpsonsTree);
	// The GEDCOM carries no dates, so give people lives: the younger ones are living, hence private.
	small.events.push(
		...treeRows({
			events: small.individuals.flatMap((p, n) => {
				const year = 1900 + ((n * 37) % 100);
				const birth = {
					id: `birt-${p.id}`,
					entityId: p.id,
					type: 'BIRT',
					dateRaw: `${year}`,
					dateSort: `${year}-01-01`,
					dateSortEnd: `${year}-12-31`
				};
				const death = {
					id: `deat-${p.id}`,
					entityId: p.id,
					type: 'DEAT',
					dateRaw: `${year + 70}`,
					dateSort: `${year + 70}-01-01`,
					dateSortEnd: `${year + 70}-12-31`
				};
				return year < 1960 ? [birth, death] : [birth];
			})
		}).events
	);
	markCreator(small, rng(5));
	worlds.push({
		label: 'The Simpsons',
		prefix: 'sim',
		rows: addEvidence(small, rng(11), 'sim'),
		limit: 12
	});

	const corpusTree = await createTestTree(db.db, actor);
	await insertCorpus(db.db, corpusTree, {
		prefix: corpusTree.slice(0, 8),
		lineages: 3,
		generations: 6,
		shouldNameThePeople: true
	});
	const large = await new ChangeStore(db.db).loadRows(corpusTree);
	markCreator(large, rng(7));
	worlds.push({
		label: 'a generated corpus',
		prefix: 'cor',
		rows: addEvidence(large, rng(23), 'cor'),
		limit: 50
	});
}, 600_000);

afterAll(async () => {
	await db.dispose();
});

describe('evidence commands plan the same over a scoped snapshot', () => {
	it.each(['The Simpsons', 'a generated corpus'])(
		'on %s',
		(label) => {
			const world = worlds.find((w) => w.label === label)!;
			const rows = world.rows;
			// Some people are private to the restricted viewer, or the viewers could not differ.
			expect(rows.individuals.length).toBeGreaterThan(20);
			expectEquivalent(
				compareAll(rows, commandsFor(rows, world.prefix, world.limit, rng(label.length * 31)))
			);
		},
		600_000
	);

	it('on a small world built to catch a seed that is too small', () => {
		const rows = trapWorld();
		expectEquivalent(compareAll(rows, commandsFor(rows, 'trap', Infinity, rng(3))));
	}, 120_000);

	it('on a partnership with no partners, its fact and its link, wherever they are the subject', () => {
		const rows = trapWorld();
		const fact = rows.events.find((e) => e.entityId === 'u-lonely')!;
		const link = rows.parentChild.find((l) => l.unionId === 'u-lonely')!;
		const subjects: Array<{ kind: 'union' | 'event' | 'parent_child'; id: string }> = [
			{ kind: 'union', id: 'u-lonely' },
			{ kind: 'event', id: fact.id },
			{ kind: 'parent_child', id: link.id }
		];
		const commands: RelationshipCommand[] = subjects.flatMap((subject, n) => [
			{
				kind: 'add_citation',
				citationId: `new-c-${n}`,
				subject,
				citation: { sourceId: 's-public' }
			},
			{ kind: 'add_note', attachmentId: `new-a-${n}`, subject, text: 'On a lonely record' },
			{ kind: 'reorder_citations', subject, orderedCitationIds: [] },
			{ kind: 'reorder_notes', subject, orderedAttachmentIds: [] },
			...(subject.kind === 'parent_child'
				? []
				: ([
						{
							kind: 'create_task',
							taskId: `new-t-${n}`,
							task: { title: 'T' },
							subject: subject as { kind: 'union' | 'event'; id: string }
						}
					] as RelationshipCommand[]))
		]);
		const tally = compareAll(rows, commands);
		expect(tally.differences).toEqual([]);
		// The whole tree's mask drops the partnership, so the restricted viewer is refused; the
		// fallback applies to every seed, so even one without the flag agrees (partnerless.test.ts).
		const unflagged = (command: RelationshipCommand) =>
			expectScopedEqualsWhole({
				whole: rows,
				commands: [command],
				scope: scopes.restricted,
				seed: { ...seedFor([command])!, shouldFollowEvidence: undefined }
			});
		expect(() => unflagged(commands[1]!)).not.toThrow();
	}, 120_000);

	it('plans each kind scoped by the follow-up on more than 20 cases and refuses some', () => {
		for (const kind of NEWLY_SCOPED) {
			const total = totals.get(kind);
			expect(total?.compared, `${kind} compared`).toBeGreaterThan(20);
			expect(total?.refused, `${kind} refused`).toBeGreaterThan(0);
		}
	});

	it('leaves merges on the whole tree', () => {
		expect(seedFor([{ kind: 'merge_sources', survivorId: 'a', mergedIds: ['b'] }])).toBeNull();
		expect(seedFor([{ kind: 'merge_notes', survivorId: 'a', mergedIds: ['b'] }])).toBeNull();
	});
});

/**
 * Why the follow-up is load-bearing. Each case plans a command in the trap world as a restricted
 * viewer: with the seed the kind has, scoped equals whole; with the same seed minus the follow-up,
 * the answer differs, because the record the command names exists for that viewer only through
 * records the first snapshot does not hold (the citations of a source, the sources of a repository).
 */
describe('the evidence follow-up is load-bearing', () => {
	const strippedOf = (seed: ScopeSeed): ScopeSeed => ({ ...seed, shouldFollowEvidence: undefined });
	const asRestricted = (command: RelationshipCommand, seed: ScopeSeed) => () =>
		expectScopedEqualsWhole({
			whole: trapWorld(),
			commands: [command],
			scope: scopes.restricted,
			seed
		});

	it.each(FOLLOW_UP_CASES)('%s', (_label, command) => {
		const seed = seedFor([command]);
		expect(seed, `${command.kind} must have a seed`).not.toBeNull();
		expect(seed!.shouldFollowEvidence).toBe(true);
		expect(asRestricted(command, seed!)).not.toThrow();
		expect(asRestricted(command, strippedOf(seed!))).toThrow();
	});
});

describe('the D1 loader, with its follow-up, returns what the selector does', () => {
	it('for the repository, note and task kinds', async () => {
		// Its own database: the equivalence tests hold the shared connection idle for a long time.
		const own = await createTestDatabase();
		try {
			const actor = await createTestUser(own.db);
			const treeId = await createTestTree(own.db, actor);
			await importGedcomToDb(own.d1, treeId, simpsons, 'Evidence loader');
			const store = new ChangeStore(own.db);
			await addEvidenceToDb(own.db, treeId, await store.loadRows(treeId), seededRandom(31));
			const whole = await store.loadRows(treeId);
			const runner = new MutationRunner(own.db);

			const commands: RelationshipCommand[] = [];
			for (const r of whole.repositories)
				commands.push(
					{ kind: 'update_repository', repositoryId: r.id, repository: { name: 'x' } },
					{ kind: 'delete_repository', repositoryId: r.id }
				);
			for (const l of whole.sourceRepositories)
				commands.push(
					{
						kind: 'link_repository',
						linkId: 'new-link',
						sourceId: l.sourceId,
						repositoryId: l.repositoryId!
					},
					{ kind: 'update_source_repository', linkId: l.id, callNumber: 'x' },
					{ kind: 'unlink_repository', linkId: l.id }
				);
			for (const a of whole.noteAttachments)
				commands.push(
					{ kind: 'update_note', attachmentId: a.id, text: 'x' },
					{ kind: 'remove_note', attachmentId: a.id },
					{ kind: 'share_note', attachmentId: a.id, noteId: 'new-note' }
				);
			for (const subject of [
				{ kind: 'repository' as const, id: whole.repositories[0]!.id },
				{ kind: 'source' as const, id: whole.sources[0]!.id },
				{ kind: 'person' as const, id: whole.individuals[0]!.id }
			])
				commands.push({
					kind: 'attach_note',
					attachmentId: 'new-att',
					subject,
					noteId: whole.notes[0]!.id
				});
			for (const n of whole.notes)
				commands.push(
					{ kind: 'update_shared_note', noteId: n.id, note: { text: 'x' } },
					{ kind: 'delete_shared_note', noteId: n.id, shouldDetach: true }
				);
			for (const task of whole.researchTasks)
				commands.push(
					{ kind: 'update_task', taskId: task.id, task: { title: 'x' } },
					{ kind: 'delete_task', taskId: task.id }
				);

			const followed = new Set<string>();
			const compared = new Set<string>();
			for (const command of commands) {
				const seed = seedFor([command]);
				if (!seed) continue;
				const loaded = await runner.loadForSeed(treeId, seed);
				expect(loaded, JSON.stringify(command)).toEqual(selectScopeWithFollowUp(whole, seed));
				compared.add(command.kind);
				const first = selectScope(whole, seed);
				if (loaded.sources.length > first.sources.length) followed.add(command.kind);
			}
			expect([...compared].sort()).toEqual([...NEWLY_SCOPED].sort());
			// The second load found records the first did not, for the kinds that need it.
			expect(followed.size).toBeGreaterThan(0);
		} finally {
			await own.dispose();
		}
	}, 300_000);
});
