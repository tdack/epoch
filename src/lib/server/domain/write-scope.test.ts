import { describe, expect, it } from 'vitest';
import type { TreeRows } from './change-log';
import { treeRows, TEST_TREE_ID } from '../testing/rows';
import { emptySeed, mergeSeeds, seedOf, selectScope } from './write-scope';

const T0 = 1_000_000;
const base = { treeId: TEST_TREE_ID, version: 1, createdAt: T0, updatedAt: T0 };

/**
 * a and b are partners (u1) with child c; b's parent is d; d has another child e; c has a partner f
 * (u2); g stands alone. Everyone has a birth, so what is loaded shows in the events.
 */
function world(): TreeRows {
	const rows = treeRows({
		people: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, birth: '1900' })),
		unions: [
			{ id: 'u1', partners: ['a', 'b'], marriage: '1920' },
			{ id: 'u2', partners: ['c', 'f'], marriage: '1950' }
		],
		links: [
			{ parentId: 'a', childId: 'c', unionId: 'u1' },
			{ parentId: 'b', childId: 'c', unionId: 'u1' },
			{ parentId: 'd', childId: 'b' },
			{ parentId: 'd', childId: 'e' }
		],
		names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((personId) => ({
			id: `name-${personId}`,
			personId
		})),
		media: [
			{ id: 'file-a', linkedTo: ['a'] },
			{ id: 'file-g', linkedTo: ['g'] },
			{ id: 'file-u1', linkedTo: ['u1'] },
			{ id: 'file-loose' }
		]
	});
	return rows;
}

const source = (id: string) => ({
	...base,
	id,
	xref: null,
	xrefAliases: null,
	title: id,
	author: null,
	publication: null,
	abbreviation: null,
	text: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null
});
const repository = (id: string) => ({
	...base,
	id,
	xref: null,
	xrefAliases: null,
	name: id,
	address: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null
});
const sourceRepository = (id: string, sourceId: string, repositoryId: string | null) => ({
	id,
	sourceId,
	repositoryId,
	repositoryRef: null,
	callNumber: null,
	gedcomExtra: null,
	sortOrder: 0,
	version: 1,
	createdAt: T0,
	updatedAt: T0
});
const citation = (
	id: string,
	subjectKind: 'person' | 'name' | 'event' | 'union' | 'parent_child',
	subjectId: string,
	sourceId: string | null
) => ({
	...base,
	id,
	subjectKind,
	subjectId,
	sortOrder: 0,
	sourceId,
	sourceRef: null,
	description: null,
	page: null,
	quality: null,
	entryDateRaw: null,
	entryDateSort: null,
	entryDateSortEnd: null,
	entryDateQualifier: null,
	entryDatePrecision: null,
	entryDateCalendar: null,
	text: null,
	gedcomExtra: null,
	gedcomLayout: null
});
const note = (id: string) => ({
	...base,
	id,
	xref: null,
	xrefAliases: null,
	text: id,
	mime: null,
	language: null,
	gedcomTag: null,
	gedcomExtra: null,
	gedcomLayout: null,
	createdBy: null
});
const attachment = (
	id: string,
	subjectKind: TreeRows['noteAttachments'][number]['subjectKind'],
	subjectId: string,
	noteId: string | null
) => ({
	...base,
	id,
	subjectKind,
	subjectId,
	sortOrder: 0,
	noteId,
	noteRef: null,
	gedcomTag: null,
	text: noteId ? null : 'inline',
	gedcomExtra: null,
	gedcomLayout: null
});
const task = (
	id: string,
	subjectKind: TreeRows['researchTasks'][number]['subjectKind'],
	subjectId: string | null
) => ({
	...base,
	id,
	title: id,
	details: null,
	status: 'open' as const,
	assigneeId: null,
	dueDate: null,
	subjectKind,
	subjectId,
	findingKey: null,
	linkClearedKind: null,
	createdBy: null
});

/** Ids per table, so an expectation reads as a list. */
function ids(rows: TreeRows) {
	return {
		people: rows.individuals.map((r) => r.id),
		names: rows.personNames.map((r) => r.id),
		unions: rows.unions.map((r) => r.id),
		partners: rows.unionPartners.map((r) => r.id),
		links: rows.parentChild.map((r) => r.id),
		events: rows.events.map((r) => r.id),
		media: rows.mediaItems.map((r) => r.id),
		sources: rows.sources.map((r) => r.id),
		repositories: rows.repositories.map((r) => r.id),
		sourceRepositories: rows.sourceRepositories.map((r) => r.id),
		citations: rows.citations.map((r) => r.id),
		notes: rows.notes.map((r) => r.id),
		attachments: rows.noteAttachments.map((r) => r.id),
		tasks: rows.researchTasks.map((r) => r.id)
	};
}

/** The world plus evidence on a (loaded by a's seed) and on g (not loaded). */
function withEvidence(): TreeRows {
	const rows = world();
	rows.sources.push(source('s-a'), source('s-g'), source('s-census'));
	rows.repositories.push(repository('r-1'), repository('r-2'));
	rows.sourceRepositories.push(
		sourceRepository('sr-a', 's-a', 'r-1'),
		sourceRepository('sr-g', 's-g', 'r-2'),
		sourceRepository('sr-census', 's-census', 'r-1')
	);
	rows.citations.push(
		citation('c-a', 'person', 'a', 's-a'),
		citation('c-g', 'person', 'g', 's-g'),
		citation('c-census-g', 'person', 'g', 's-census'),
		citation('c-census-e', 'event', 'birt-e', 's-census')
	);
	rows.notes.push(note('n-shared'), note('n-lonely'));
	rows.noteAttachments.push(
		attachment('att-a', 'person', 'a', 'n-shared'),
		attachment('att-g', 'person', 'g', 'n-shared'),
		attachment('att-inline-a', 'person', 'a', null),
		attachment('att-on-cite', 'citation', 'c-a', null),
		attachment('att-on-source', 'source', 's-a', null)
	);
	rows.researchTasks.push(
		task('t-a', 'person', 'a'),
		task('t-g', 'person', 'g'),
		task('t-free', null, null),
		task('t-on-source', 'source', 's-a')
	);
	return rows;
}

describe('selectScope', () => {
	it('selects nothing for an empty seed', () => {
		const picked = ids(selectScope(withEvidence(), emptySeed()));
		for (const list of Object.values(picked)) expect(list).toEqual([]);
	});

	it('ignores ids the tree does not have', () => {
		const picked = ids(
			selectScope(
				world(),
				seedOf({ people: ['nobody'], events: ['no-event'], citations: ['no-cite'], tasks: ['t'] })
			)
		);
		for (const list of Object.values(picked)) expect(list).toEqual([]);
	});

	it('loads a person with partners, links, the other ends and no further partnerships', () => {
		const picked = ids(selectScope(world(), seedOf({ people: ['a'] })));
		expect(picked.people).toEqual(['a', 'b', 'c', 'd']);
		expect(picked.unions).toEqual(['u1']);
		expect(picked.partners).toEqual(['u1-p0', 'u1-p1']);
		expect(picked.links).toEqual(['link-0', 'link-1', 'link-2']);
		// c has a partner f, but c is the far end of a link and brings no partnership.
		expect(picked.people).not.toContain('f');
		expect(picked.unions).not.toContain('u2');
	});

	it('gives every loaded person, including the far end of a link, all names and individual events', () => {
		const picked = ids(selectScope(world(), seedOf({ people: ['a'] })));
		expect(picked.names).toEqual(['name-a', 'name-b', 'name-c', 'name-d']);
		expect(picked.events).toEqual(['birt-a', 'birt-b', 'birt-c', 'birt-d', 'marr-u1']);
		expect(picked.events).not.toContain('birt-e');
	});

	it('loads the events of a private person like any other', () => {
		const rows = world();
		rows.individuals.find((p) => p.id === 'b')!.privacy = 'private';
		const picked = ids(selectScope(rows, seedOf({ people: ['a'] })));
		expect(picked.people).toContain('b');
		expect(picked.events).toContain('birt-b');
		expect(picked.names).toContain('name-b');
	});

	it('resolves an event to its person, and a family event to its partnership', () => {
		expect(ids(selectScope(world(), seedOf({ events: ['birt-g'] }))).people).toEqual(['g']);
		const family = ids(selectScope(world(), seedOf({ events: ['marr-u2'] })));
		expect(family.unions).toEqual(['u2']);
		expect(family.people).toEqual(['c', 'f', 'a', 'b'].sort());
	});

	it('resolves a name to its person', () => {
		expect(ids(selectScope(world(), seedOf({ names: ['name-g'] }))).people).toEqual(['g']);
	});

	it('resolves a link to both people and its partnership', () => {
		const picked = ids(selectScope(world(), seedOf({ links: ['link-0'] })));
		// c is a seeded link's end, so c is resolved like any seeded person and brings u2.
		expect(picked.unions).toEqual(['u1', 'u2']);
		expect(picked.people).toEqual(expect.arrayContaining(['a', 'b', 'c', 'f']));
	});

	it('loads the files of loaded people and partnerships, and a seeded loose file', () => {
		const picked = ids(selectScope(world(), seedOf({ people: ['a'], media: ['file-loose'] })));
		expect(picked.media).toEqual(['file-a', 'file-u1', 'file-loose']);
		expect(ids(selectScope(world(), seedOf({ media: ['file-g'] }))).people).toEqual(['g']);
	});

	it('brings the citations on loaded records with their sources, links and repositories', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ people: ['a'] })));
		expect(picked.citations).toEqual(['c-a']);
		expect(picked.sources).toEqual(['s-a']);
		expect(picked.sourceRepositories).toEqual(['sr-a']);
		expect(picked.repositories).toEqual(['r-1']);
	});

	it('does not pull a source’s other citations just because one is loaded', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ events: ['birt-e'] })));
		expect(picked.citations).toEqual(['c-census-e']);
		expect(picked.sources).toEqual(['s-census']);
	});

	it('resolves a citation to its subject and its source', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ citations: ['c-g'] })));
		expect(picked.people).toEqual(['g']);
		// g is loaded, so everything attached to g comes too: its other citation and that source.
		expect(picked.citations).toEqual(['c-g', 'c-census-g']);
		expect(picked.sources).toEqual(['s-g', 's-census']);
		expect(picked.repositories).toEqual(['r-1', 'r-2']);
	});

	it('pulls every citation of a seeded source, and their subjects', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ sources: ['s-census'] })));
		// c-g comes too: it is on g, who is loaded as the subject of a pulled citation.
		expect(picked.citations).toEqual(['c-g', 'c-census-g', 'c-census-e']);
		expect(picked.people).toEqual(expect.arrayContaining(['g', 'e']));
		expect(picked.repositories).toEqual(['r-1', 'r-2']);
	});

	it('pulls the repository links of a seeded repository, without their sources', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ repositories: ['r-1'] })));
		expect(picked.repositories).toEqual(['r-1']);
		expect(picked.sourceRepositories).toEqual(['sr-a', 'sr-census']);
		expect(picked.sources).toEqual([]);
	});

	it('resolves a seeded source link to its source and repository, and pulls neither', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ sourceRepositories: ['sr-census'] })));
		expect(picked.sourceRepositories).toEqual(['sr-census']);
		expect(picked.sources).toEqual(['s-census']);
		expect(picked.repositories).toEqual(['r-1']);
		// Not pulled: the other link of r-1 and the citations of s-census.
		expect(picked.citations).toEqual([]);
		expect(ids(selectScope(withEvidence(), seedOf({ sourceRepositories: ['nope'] })))).toEqual(
			ids(selectScope(withEvidence(), emptySeed()))
		);
	});

	it('resolves a link with no repository to its source alone', () => {
		const rows = withEvidence();
		rows.sources.push(source('s-lonely'));
		rows.sourceRepositories.push(sourceRepository('sr-ref', 's-lonely', null));
		const picked = ids(selectScope(rows, seedOf({ sourceRepositories: ['sr-ref'] })));
		expect(picked.sourceRepositories).toEqual(['sr-ref']);
		expect(picked.sources).toEqual(['s-lonely']);
		expect(picked.repositories).toEqual([]);
	});

	it('brings note attachments with their notes, and those on a loaded citation or source', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ people: ['a'] })));
		expect(picked.attachments).toEqual(['att-a', 'att-inline-a', 'att-on-cite', 'att-on-source']);
		expect(picked.notes).toEqual(['n-shared']);
	});

	it('pulls every attachment of a seeded shared note, and their subjects', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ notes: ['n-shared'] })));
		expect(picked.attachments).toEqual([
			'att-a',
			'att-g',
			'att-inline-a',
			'att-on-cite',
			'att-on-source'
		]);
		expect(picked.people).toEqual(expect.arrayContaining(['a', 'g']));
		expect(picked.notes).toEqual(['n-shared']);
	});

	it('resolves an attachment on a citation through the citation to its subject', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ noteAttachments: ['att-on-cite'] })));
		expect(picked.citations).toEqual(['c-a']);
		expect(picked.people).toEqual(expect.arrayContaining(['a']));
	});

	it('brings tasks about loaded records, and resolves a seeded task to its subject', () => {
		const picked = ids(selectScope(withEvidence(), seedOf({ people: ['a'] })));
		expect(picked.tasks).toEqual(['t-a', 't-on-source']);
		const seeded = ids(selectScope(withEvidence(), seedOf({ tasks: ['t-g', 't-free'] })));
		expect(seeded.tasks).toEqual(['t-g', 't-free']);
		expect(seeded.people).toEqual(['g']);
	});

	it('copies a whole table when asked, and still selects the rest by closure', () => {
		const picked = ids(
			selectScope(world(), seedOf({ people: ['g'], wholeTables: ['parentChild'] }))
		);
		expect(picked.links).toEqual(['link-0', 'link-1', 'link-2', 'link-3']);
		expect(picked.people).toEqual(['g']);
	});

	it('keeps each table in the order of the whole tree whatever order the seed names things', () => {
		const rows = world();
		const picked = selectScope(rows, seedOf({ people: ['d', 'c', 'a'], events: ['birt-g'] }));
		const positions = (table: 'events' | 'individuals') =>
			picked[table].map((r) => rows[table].findIndex((w) => w.id === r.id));
		for (const table of ['events', 'individuals'] as const)
			expect(positions(table)).toEqual([...positions(table)].sort((x, y) => x - y));
	});

	it('does not mutate the whole snapshot', () => {
		const rows = withEvidence();
		const before = JSON.stringify(rows);
		selectScope(rows, seedOf({ people: ['a'] }));
		expect(JSON.stringify(rows)).toBe(before);
	});
});

describe('mergeSeeds', () => {
	it('unions every id set and the whole-table requests', () => {
		const merged = mergeSeeds(
			seedOf({ people: ['a'], wholeTables: ['parentChild'] }),
			seedOf({ people: ['b'], tasks: ['t'], wholeTables: ['parentChild', 'events'] })
		);
		expect([...merged.people]).toEqual(['a', 'b']);
		expect([...merged.tasks]).toEqual(['t']);
		expect(merged.wholeTables).toEqual(['parentChild', 'events']);
	});

	it('unions the link ids and keeps either follow-up flag', () => {
		const merged = mergeSeeds(
			seedOf({ sourceRepositories: ['l1'], shouldFollowEvidence: true }),
			seedOf({ sourceRepositories: ['l2'] })
		);
		expect([...merged.sourceRepositories]).toEqual(['l1', 'l2']);
		expect(merged.shouldFollowEvidence).toBe(true);
		expect(mergeSeeds(seedOf({}), seedOf({})).shouldFollowEvidence).toBeUndefined();
	});
});
