import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import simpsonsClean from '../../../../docs/gedcom-data/The_Simpsons_clean.ged?raw';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from '../fixtures/genealogy-fixtures';
import { importGedcomToDb } from '../testing/gedcom';
import { graphFromRows } from '../domain/relationship-graph';
import { ChangeStore } from '../repositories/change-store';
import { GraphWindowRepository, type Read } from '../repositories/graph-window-repository';
import { compactStubId, resolveStubTokens } from '../../shared/stub-tokens';
import {
	filterParentChildTypes,
	layoutFocusView,
	type FocusViewOptions,
	type ParentChildType
} from '../../tree-layout/index';
import { NotFoundError } from '../domain/errors';
import { insertCorpus, type CorpusSummary } from '../testing/corpus';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { loadFocusWindow, type FocusWindowOptions } from './focus-window';

/** The exhaustive comparisons run a window per person and option set against a real D1. */
const EXHAUSTIVE_MS = 240_000;

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** Reads counted as rows returned and round trips made, so "did not read the tree" is a number. */
class CountingRepository extends GraphWindowRepository {
	rowsRead = 0;
	roundTrips = 0;
	override async run<const Reads extends readonly Read<unknown>[]>(...reads: Reads) {
		const results = await super.run(...reads);
		this.roundTrips++;
		for (const result of results as unknown[]) this.rowsRead += (result as unknown[]).length;
		return results;
	}
}

function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
	if (Object.is(a, b)) return null;
	if (typeof a !== 'object' || typeof b !== 'object' || !a || !b)
		return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		const diff = firstDifference(
			(a as Record<string, unknown>)[key],
			(b as Record<string, unknown>)[key],
			`${path}.${key}`
		);
		if (diff) return diff;
	}
	return null;
}

/** Depths from none to deeper than any fixture, and each toggle, so every branch of the selection runs. */
const OPTION_SETS: Array<[string, FocusWindowOptions]> = [
	['no generations', { ancestorDepth: 0, descendantDepth: 0 }],
	['one each way', { ancestorDepth: 1, descendantDepth: 1 }],
	['deep, no siblings', { ancestorDepth: 6, descendantDepth: 6, shouldIncludeSiblings: false }],
	[
		'mixed, step families',
		{ ancestorDepth: 2, descendantDepth: 1, shouldIncludeStepFamilies: true }
	],
	// The wider groups of the 3D views: the loader must fetch whatever they select, no more.
	['side branches one deep', { ancestorDepth: 3, descendantDepth: 2, collateralDepth: 1 }],
	['side branches two deep', { ancestorDepth: 4, descendantDepth: 3, collateralDepth: 2 }],
	[
		'partner origins and side branches',
		{ ancestorDepth: 2, descendantDepth: 2, collateralDepth: 2, shouldIncludePartnerOrigins: true }
	]
];

const TYPE_FILTERS: Array<ParentChildType[] | null> = [
	null,
	['biological'],
	['biological', 'adoptive']
];

async function wholeGraph(treeId: string) {
	return graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
}

/** The window's layout must be the whole tree's layout, exactly, for one focus and option set. */
async function expectSameLayout(
	treeId: string,
	focusId: string,
	options: FocusWindowOptions,
	types: ParentChildType[] | null,
	whole: Awaited<ReturnType<typeof wholeGraph>>
) {
	const window = await loadFocusWindow(new GraphWindowRepository(t.db), treeId, focusId, options);
	const expandedStubIds = resolveStubTokens(
		options.expandedStubTokens ?? [],
		whole.people.map((p) => p.id),
		whole.unions.map((u) => u.id)
	);
	const layoutOptions: FocusViewOptions = { ...options, expandedStubIds };
	const prepare = (graph: typeof whole) => (types ? filterParentChildTypes(graph, types) : graph);
	const fromWindow = layoutFocusView(prepare(window.graph), focusId, layoutOptions);
	const fromWhole = layoutFocusView(prepare(whole), focusId, layoutOptions);
	const difference = firstDifference(fromWindow, fromWhole);
	expect(difference, `focus ${focusId}, ${JSON.stringify(options)}, types ${types}`).toBeNull();
	// Everything the view draws is fully loaded, never a partial neighbour.
	for (const person of fromWindow.people) expect(person.person.isPartial).toBeUndefined();
	return window;
}

async function importTree(gedcom: string, name: string): Promise<string> {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, gedcom, name);
	return treeId;
}

describe.each([
	['The Simpsons (clean)', () => simpsonsClean],
	['the representative scenarios', () => REPRESENTATIVE_GEDCOM_FIXTURE]
])('a window around %s', (name, source) => {
	let treeId: string;
	let whole: Awaited<ReturnType<typeof wholeGraph>>;
	beforeAll(async () => {
		treeId = await importTree(source(), name);
		whole = await wholeGraph(treeId);
	});

	it(
		'draws exactly what the whole tree draws, for every person as focus and every option set',
		async () => {
			for (const person of whole.people) {
				for (const [, options] of OPTION_SETS) {
					await expectSameLayout(treeId, person.id, options, null, whole);
				}
			}
		},
		EXHAUSTIVE_MS
	);

	it(
		'does the same with opened stubs and with parent-child type filters',
		async () => {
			for (const person of whole.people) {
				const base = await loadFocusWindow(new GraphWindowRepository(t.db), treeId, person.id, {
					ancestorDepth: 1,
					descendantDepth: 1
				});
				const tokens = base.selection.stubs
					.map((s) => compactStubId(s.id))
					.filter((x): x is string => x !== null);
				// Every stub opened at once, and the first alone.
				for (const opened of [tokens, tokens.slice(0, 1)]) {
					if (opened.length === 0) continue;
					await expectSameLayout(
						treeId,
						person.id,
						{ ancestorDepth: 1, descendantDepth: 1, expandedStubTokens: opened },
						null,
						whole
					);
				}
				for (const types of TYPE_FILTERS.slice(1))
					await expectSameLayout(
						treeId,
						person.id,
						{ ancestorDepth: 2, descendantDepth: 2 },
						types,
						whole
					);
			}
		},
		EXHAUSTIVE_MS
	);

	it(
		'returns the same stub counts the whole-tree selection computes',
		async () => {
			for (const person of whole.people) {
				const window = await loadFocusWindow(new GraphWindowRepository(t.db), treeId, person.id, {
					ancestorDepth: 1,
					descendantDepth: 1
				});
				const layout = layoutFocusView(whole, person.id, { ancestorDepth: 1, descendantDepth: 1 });
				const byId = (a: [string, number], b: [string, number]) => a[0].localeCompare(b[0]);
				const counts = (stubs: Array<{ id: string; count: number }>) =>
					stubs.map((s): [string, number] => [s.id, s.count]).sort(byId);
				expect(counts(window.selection.stubs)).toEqual(counts(layout.stubs));
			}
		},
		EXHAUSTIVE_MS
	);

	it('answers 404 for a person who is not in this tree', async () => {
		const otherTree = await importTree(REPRESENTATIVE_GEDCOM_FIXTURE, 'other');
		const otherPerson = (await wholeGraph(otherTree)).people[0]!.id;
		await expect(
			loadFocusWindow(new GraphWindowRepository(t.db), treeId, otherPerson)
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			loadFocusWindow(new GraphWindowRepository(t.db), treeId, 'nobody')
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe('a window into a large tree', () => {
	let treeId: string;
	let corpus: CorpusSummary;
	let whole: Awaited<ReturnType<typeof wholeGraph>>;
	beforeAll(async () => {
		treeId = crypto.randomUUID();
		await t.db.insert((await import('../db/schema')).trees).values({ id: treeId, name: 'Corpus' });
		corpus = await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8) });
		whole = await wholeGraph(treeId);
	}, 120_000);

	it('is larger than any fixture, with the shapes the layout special-cases', () => {
		expect(corpus.people).toBeGreaterThan(4000);
		expect(whole.people).toHaveLength(corpus.people);
		expect(whole.people.filter((p) => p.unionIds.length > 1).length).toBeGreaterThan(50);
		expect(whole.parentChild.some((l) => l.type === 'adoptive')).toBe(true);
		expect(whole.parentChild.some((l) => l.unionId === null)).toBe(true);
	});

	it('draws exactly what the whole tree draws, from the root, the leaves and the middle', async () => {
		const sample = [corpus.rootPersonId, corpus.leafPersonId, corpus.remarriedPersonId];
		for (const person of sample) {
			for (const [, options] of OPTION_SETS)
				await expectSameLayout(treeId, person, options, null, whole);
		}
		for (const person of whole.people.filter((_, i) => i % 401 === 0)) {
			await expectSameLayout(
				treeId,
				person.id,
				{ ancestorDepth: 3, descendantDepth: 2 },
				null,
				whole
			);
		}
	}, 120_000);

	it(
		'names step-parents behind a hidden parent, the case a small fixture never reaches',
		async () => {
			const withStepParent = whole.people.filter((p) => p.stepParents.length > 0);
			expect(withStepParent.length).toBeGreaterThan(20);
			for (const person of withStepParent.slice(0, 6)) {
				for (const [, options] of OPTION_SETS)
					await expectSameLayout(treeId, person.id, options, null, whole);
				const window = await loadFocusWindow(new GraphWindowRepository(t.db), treeId, person.id, {
					ancestorDepth: 0
				});
				const drawn = window.graph.people.find((p) => p.id === person.id)!;
				expect(drawn.stepParents).toEqual(person.stepParents);
			}
		},
		EXHAUSTIVE_MS
	);

	it('never reads the whole tree: a default view reads a small fraction of its rows', async () => {
		const loadRows = vi.spyOn(ChangeStore.prototype, 'loadRows');
		const totalRows = corpus.people + corpus.unions + corpus.links + corpus.events;
		try {
			for (const person of [corpus.rootPersonId, corpus.remarriedPersonId, corpus.leafPersonId]) {
				const repo = new CountingRepository(t.db);
				const window = await loadFocusWindow(repo, treeId, person);
				expect(loadRows).not.toHaveBeenCalled();
				expect(window.graph.people.length).toBeLessThan(corpus.people / 5);
				expect(repo.rowsRead).toBeLessThan(totalRows / 5);
				expect(window.roundCount).toBeLessThan(12);
			}
		} finally {
			loadRows.mockRestore();
		}
	}, 60_000);

	it('reads a small fraction of the tree for the wider 3D groups too', async () => {
		const totalRows = corpus.people + corpus.unions + corpus.links + corpus.events;
		const wide = { collateralDepth: 2, shouldIncludePartnerOrigins: true };
		for (const person of [corpus.rootPersonId, corpus.remarriedPersonId, corpus.leafPersonId]) {
			const repo = new CountingRepository(t.db);
			const window = await loadFocusWindow(repo, treeId, person, wide);
			expect(window.graph.people.length).toBeLessThan(corpus.people / 5);
			expect(repo.rowsRead).toBeLessThan(totalRows / 5);
			expect(window.roundCount).toBeLessThan(12);
		}
	}, 60_000);

	it('grows with the depth asked for, not with the size of the tree', async () => {
		const read = async (depth: number) => {
			const repo = new CountingRepository(t.db);
			await loadFocusWindow(repo, treeId, corpus.remarriedPersonId, {
				ancestorDepth: depth,
				descendantDepth: depth
			});
			return repo.rowsRead;
		};
		const [shallow, deep] = [await read(1), await read(4)];
		expect(shallow).toBeLessThan(deep);
	}, 60_000);
});
