import { describe, expect, it } from 'vitest';
import type { TreeRows } from '../change-log';
import { treeRows } from '../../testing/rows';
import { mergeSeeds, seedOf, selectScope } from '../write-scope';
import { selectScopeWithFollowUp } from '../../testing/scope-equivalence';
import { FOLLOW_UP_WHOLE, MAX_FOLLOW_UP_LOADS, followUpSeed, seedWithFollowUp } from './follow-up';

/** u1 is a and b's; u2 is a second partnership of the same pair; c is their child, d a stranger. */
const whole = treeRows({
	people: ['a', 'b', 'c', 'd'].map((id) => ({ id, birth: '1900' })),
	unions: [
		{ id: 'u1', partners: ['a', 'b'] },
		{ id: 'u2', partners: ['a', 'b'] },
		{ id: 'u3', partners: ['d'] }
	],
	links: [{ parentId: 'a', childId: 'c', unionId: 'u1' }]
});

const ids = (rows: { unions: Array<{ id: string }> }) => rows.unions.map((u) => u.id);

describe('followUpSeed', () => {
	it('is null for a seed that does not opt in, so its round trips are unchanged', () => {
		const seed = seedOf({ unions: ['u1'] });
		expect(followUpSeed(selectScope(whole, seed), seed)).toBeNull();
	});

	it('names the partners of the partnerships found, whose partnerships are the twins', () => {
		const seed = seedOf({ unions: ['u1'], shouldFollowFamily: true });
		const first = selectScope(whole, seed);
		expect(ids(first)).toEqual(['u1']);
		const extra = followUpSeed(first, seed)!;
		expect([...extra.people].sort()).toEqual(['a', 'b']);
		expect(ids(selectScope(whole, mergeSeeds(seed, extra)))).toEqual(['u1', 'u2']);
	});

	it('names the parents of a seeded child', () => {
		const seed = seedOf({ people: ['c'], shouldFollowFamily: true });
		expect([...followUpSeed(selectScope(whole, seed), seed)!.people]).toEqual(['a']);
	});

	it('is null when it adds nobody the seed did not already name', () => {
		const seed = seedOf({ people: ['d'], shouldFollowFamily: true });
		expect(followUpSeed(selectScope(whole, seed), seed)).toBeNull();
		const missing = seedOf({ unions: ['nope'], shouldFollowFamily: true });
		expect(seedWithFollowUp(selectScope(whole, missing), missing)).toBeNull();
	});

	it('signals the whole tree for a named partnership with no partners', () => {
		const lonely = treeRows({ people: [{ id: 'a' }], unions: [{ id: 'none', partners: [] }] });
		const seed = seedOf({ unions: ['none'], shouldFollowFamily: true });
		expect(seedWithFollowUp(selectScope(lonely, seed), seed)).toBe(FOLLOW_UP_WHOLE);
		const unnamed = seedOf({ people: ['a'], shouldFollowFamily: true });
		expect(seedWithFollowUp(selectScope(lonely, unnamed), unnamed)).toBeNull();
	});

	it('survives a merge', () => {
		expect(mergeSeeds(seedOf({}), seedOf({ shouldFollowFamily: true })).shouldFollowFamily).toBe(
			true
		);
		expect(mergeSeeds(seedOf({}), seedOf({})).shouldFollowFamily).toBeUndefined();
	});
});

// ---- The evidence rule ----

const T0 = 1_000_000;
const stamp = { version: 1, createdAt: T0, updatedAt: T0 };
const source = (id: string) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
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
	}) as TreeRows['sources'][number];
const repository = (id: string) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
		xref: null,
		xrefAliases: null,
		name: id,
		address: null,
		gedcomExtra: null,
		gedcomLayout: null,
		createdBy: null
	}) as TreeRows['repositories'][number];
const link = (id: string, sourceId: string, repositoryId: string | null) => ({
	...stamp,
	id,
	sourceId,
	repositoryId,
	repositoryRef: null,
	callNumber: null,
	gedcomExtra: null,
	sortOrder: 0
});
const citation = (id: string, personId: string, sourceId: string) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
		subjectKind: 'person',
		subjectId: personId,
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
	}) as TreeRows['citations'][number];
const note = (id: string) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
		xref: null,
		xrefAliases: null,
		text: id,
		mime: null,
		language: null,
		gedcomTag: null,
		gedcomExtra: null,
		gedcomLayout: null,
		createdBy: null
	}) as TreeRows['notes'][number];
const attachment = (
	id: string,
	subjectKind: TreeRows['noteAttachments'][number]['subjectKind'],
	subjectId: string,
	noteId: string | null
) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
		subjectKind,
		subjectId,
		sortOrder: 0,
		noteId,
		noteRef: null,
		gedcomTag: null,
		text: noteId ? null : 'inline',
		gedcomExtra: null,
		gedcomLayout: null
	}) as TreeRows['noteAttachments'][number];
const task = (
	id: string,
	subjectKind: TreeRows['researchTasks'][number]['subjectKind'],
	subjectId: string | null
) =>
	({
		...stamp,
		id,
		treeId: 'tree-1',
		title: id,
		details: null,
		status: 'open',
		assigneeId: null,
		dueDate: null,
		subjectKind,
		subjectId,
		findingKey: null,
		linkClearedKind: null,
		createdBy: null
	}) as TreeRows['researchTasks'][number];

/**
 * s1 is cited by a and linked to r1; s2 is cited by d and linked to r1; a note n1 is used on r1
 * and on a; tasks are about s1, about n1 and about a.
 */
const evidence: TreeRows = {
	...whole,
	sources: [source('s1'), source('s2')],
	repositories: [repository('r1')],
	sourceRepositories: [link('l1', 's1', 'r1'), link('l2', 's2', 'r1'), link('l3', 's2', null)],
	citations: [citation('c1', 'a', 's1'), citation('c2', 'd', 's2')],
	notes: [note('n1')],
	noteAttachments: [
		attachment('att-source', 'source', 's1', null),
		attachment('att-repo', 'repository', 'r1', 'n1'),
		attachment('att-person', 'person', 'a', 'n1')
	],
	researchTasks: [
		task('t-source', 'source', 's1'),
		task('t-note', 'note', 'n1'),
		task('t-person', 'person', 'a'),
		task('t-free', null, null)
	]
};

const extraOf = (seed: ReturnType<typeof seedOf>, loads = 1) =>
	followUpSeed(selectScope(evidence, seed), seed, loads);

describe('followUpSeed for evidence', () => {
	it('is null for a seed that does not opt in', () => {
		expect(extraOf(seedOf({ noteAttachments: ['att-source'] }))).toBeNull();
	});

	it('seeds the source a seeded attachment is on, which brings its citations', () => {
		const seed = seedOf({ noteAttachments: ['att-source'], shouldFollowEvidence: true });
		const extra = extraOf(seed)!;
		expect([...extra.sources]).toEqual(['s1']);
		expect(selectScope(evidence, seed).citations).toEqual([]);
		expect(selectScope(evidence, mergeSeeds(seed, extra)).citations.map((c) => c.id)).toEqual([
			'c1'
		]);
	});

	it('seeds the repository an attachment is on, then the sources its links name', () => {
		const seed = seedOf({ noteAttachments: ['att-repo'], shouldFollowEvidence: true });
		const first = extraOf(seed)!;
		expect([...first.repositories]).toEqual(['r1']);
		const second = mergeSeeds(seed, first);
		const next = extraOf(second, 2)!;
		expect([...next.sources].sort()).toEqual(['s1', 's2']);
		expect(extraOf(mergeSeeds(second, next), 3)).toBeNull();
	});

	it('anchors on the attachments of a seeded note, whatever they are on', () => {
		const seed = seedOf({ notes: ['n1'], shouldFollowEvidence: true });
		expect([...extraOf(seed)!.repositories]).toEqual(['r1']);
		expect(extraOf(seed)!.sources.size).toBe(0);
	});

	it('seeds the source or the note a seeded task is about, and nothing for a person or none', () => {
		const about = (id: string) => extraOf(seedOf({ tasks: [id], shouldFollowEvidence: true }));
		expect([...about('t-source')!.sources]).toEqual(['s1']);
		expect([...about('t-note')!.notes]).toEqual(['n1']);
		expect(about('t-person')).toBeNull();
		expect(about('t-free')).toBeNull();
		expect(about('missing')).toBeNull();
	});

	it('seeds the sources a seeded repository or a seeded link names', () => {
		const fromRepository = extraOf(seedOf({ repositories: ['r1'], shouldFollowEvidence: true }))!;
		expect([...fromRepository.sources].sort()).toEqual(['s1', 's2']);
		const fromLink = extraOf(seedOf({ sourceRepositories: ['l3'], shouldFollowEvidence: true }))!;
		expect([...fromLink.sources]).toEqual(['s2']);
	});

	it('adds only what is not already seeded, so a finished chain ends', () => {
		const seed = seedOf({
			tasks: ['t-source'],
			sources: ['s1'],
			noteAttachments: ['att-source'],
			shouldFollowEvidence: true
		});
		expect(extraOf(seed)).toBeNull();
		expect(seedWithFollowUp(selectScope(evidence, seed), seed)).toBeNull();
	});

	it('does not follow records that are merely loaded', () => {
		// a is cited by s1, which has a note and a task of its own, but nothing anchors on them.
		const seed = seedOf({ people: ['a'], shouldFollowEvidence: true });
		const first = selectScope(evidence, seed);
		expect(first.sources.map((s) => s.id)).toEqual(['s1']);
		expect(first.noteAttachments.map((n) => n.id)).toContain('att-source');
		expect(extraOf(seed)).toBeNull();
	});

	it('runs the family rule in the first round only', () => {
		const seed = seedOf({ unions: ['u1'], shouldFollowFamily: true });
		const first = selectScope(evidence, seed);
		expect(followUpSeed(first, seed, 1)).not.toBeNull();
		expect(followUpSeed(first, seed, 2)).toBeNull();
	});

	it('runs both rules in one round when both are on', () => {
		const seed = seedOf({
			unions: ['u1'],
			tasks: ['t-source'],
			shouldFollowFamily: true,
			shouldFollowEvidence: true
		});
		const extra = extraOf(seed)!;
		expect([...extra.people].sort()).toEqual(['a', 'b']);
		expect([...extra.sources]).toEqual(['s1']);
	});
});

describe('seedWithFollowUp for evidence', () => {
	it('gives up and reads the whole tree when the chain is still going after the cap', () => {
		// task -> note -> repository -> links -> sources is four loads; three are allowed.
		let seed = seedOf({ tasks: ['t-note'], shouldFollowEvidence: true });
		let rows = selectScope(evidence, seed);
		for (let loads = 1; loads < MAX_FOLLOW_UP_LOADS; loads++) {
			const next = seedWithFollowUp(rows, seed, loads);
			expect(next, `after load ${loads}`).not.toBeNull();
			expect(next).not.toBe(FOLLOW_UP_WHOLE);
			seed = next as typeof seed;
			rows = selectScope(evidence, seed);
		}
		expect(seedWithFollowUp(rows, seed, MAX_FOLLOW_UP_LOADS)).toBe(FOLLOW_UP_WHOLE);
		expect(
			selectScopeWithFollowUp(evidence, seedOf({ tasks: ['t-note'], shouldFollowEvidence: true }))
		).toBe(evidence);
	});

	it('stays scoped for a chain of three loads', () => {
		const seed = seedOf({ noteAttachments: ['att-repo'], shouldFollowEvidence: true });
		const rows = selectScopeWithFollowUp(evidence, seed);
		expect(rows).not.toBe(evidence);
		expect(rows.citations.map((c) => c.id)).toEqual(['c1', 'c2']);
	});

	it('signals the whole tree for a partnerless union under either flag', () => {
		const lonely = {
			...treeRows({ people: [{ id: 'a' }], unions: [{ id: 'none', partners: [] }] })
		};
		const seed = seedOf({ unions: ['none'], shouldFollowEvidence: true });
		expect(seedWithFollowUp(selectScope(lonely, seed), seed)).toBe(FOLLOW_UP_WHOLE);
		const unnamed = seedOf({ people: ['a'], shouldFollowEvidence: true });
		expect(seedWithFollowUp(selectScope(lonely, unnamed), unnamed)).toBeNull();
	});

	it('survives a merge', () => {
		expect(
			mergeSeeds(seedOf({}), seedOf({ shouldFollowEvidence: true })).shouldFollowEvidence
		).toBe(true);
	});
});
