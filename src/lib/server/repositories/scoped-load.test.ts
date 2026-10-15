import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsons from '../../../../test/data/The Simpsons.ged?raw';
import {
	citations,
	mediaItems,
	noteAttachments,
	notes,
	repositories,
	researchTasks,
	sourceRepositories,
	sources
} from '../db/schema';
import type { TreeRows } from '../domain/change-log';
import { emptySeed, seedOf, selectScope, type ScopeSeed } from '../domain/write-scope';
import { insertCorpus } from '../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { importGedcomToDb } from '../testing/gedcom';
import { ChangeStore } from './change-store';
import { ScopedRowLoader } from './scoped-row-loader';

let t: TestDatabase;
let actor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
});
afterAll(async () => {
	await t.dispose();
});

/** A small deterministic generator, so the random seeds are the same on every run. */
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

/**
 * Evidence the fixtures lack, spread over the tree so the evidence rules have something to find:
 * sources and repositories (some shared), citations on every kind of subject, shared and inline
 * notes, a note on a citation, tasks about people, partnerships, events and sources, and files.
 */
async function addEvidence(treeId: string, rows: TreeRows, random: () => number) {
	const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
	const hasEvents = rows.events.length > 0;
	const sourceIds = ['a', 'b', 'c', 'd'].map((s) => `${treeId.slice(0, 8)}-src-${s}`);
	const repositoryIds = ['a', 'b'].map((s) => `${treeId.slice(0, 8)}-repo-${s}`);
	const noteIds = ['a', 'b', 'c'].map((s) => `${treeId.slice(0, 8)}-note-${s}`);
	await t.db.insert(sources).values(sourceIds.map((id) => ({ id, treeId, title: id, version: 1 })));
	await t.db
		.insert(repositories)
		.values(repositoryIds.map((id) => ({ id, treeId, name: id, version: 1 })));
	await t.db.insert(sourceRepositories).values([
		{ id: `${treeId.slice(0, 8)}-sr-1`, sourceId: sourceIds[0]!, repositoryId: repositoryIds[0]! },
		{ id: `${treeId.slice(0, 8)}-sr-2`, sourceId: sourceIds[1]!, repositoryId: repositoryIds[0]! },
		{ id: `${treeId.slice(0, 8)}-sr-3`, sourceId: sourceIds[2]!, repositoryId: repositoryIds[1]! }
	]);
	await t.db.insert(notes).values(noteIds.map((id) => ({ id, treeId, text: id, version: 1 })));

	const subjects: Array<['person' | 'name' | 'event' | 'union' | 'parent_child', string]> = [];
	for (let i = 0; i < 60; i++) {
		subjects.push(['person', pick(rows.individuals).id]);
		subjects.push(['name', pick(rows.personNames).id]);
		if (hasEvents) subjects.push(['event', pick(rows.events).id]);
		if (rows.unions.length > 0) subjects.push(['union', pick(rows.unions).id]);
		if (rows.parentChild.length > 0) subjects.push(['parent_child', pick(rows.parentChild).id]);
	}
	const citationIds: string[] = [];
	for (const [index, [subjectKind, subjectId]] of subjects.entries()) {
		const id = `${treeId.slice(0, 8)}-cite-${index}`;
		citationIds.push(id);
		await t.db.insert(citations).values({
			id,
			treeId,
			subjectKind,
			subjectId,
			sortOrder: index,
			sourceId: random() < 0.85 ? pick(sourceIds) : null,
			page: `p${index}`,
			version: 1
		});
	}
	let attachmentIndex = 0;
	const attach = async (
		subjectKind: 'person' | 'event' | 'union' | 'citation' | 'source' | 'repository',
		subjectId: string,
		noteId: string | null
	) =>
		t.db.insert(noteAttachments).values({
			id: `${treeId.slice(0, 8)}-att-${attachmentIndex++}`,
			treeId,
			subjectKind,
			subjectId,
			sortOrder: attachmentIndex,
			noteId,
			text: noteId ? null : 'inline',
			version: 1
		});
	for (let i = 0; i < 40; i++) {
		await attach('person', pick(rows.individuals).id, random() < 0.5 ? pick(noteIds) : null);
		if (hasEvents)
			await attach('event', pick(rows.events).id, random() < 0.5 ? pick(noteIds) : null);
	}
	for (let i = 0; i < 10; i++) {
		await attach('citation', pick(citationIds), random() < 0.5 ? pick(noteIds) : null);
		await attach('source', pick(sourceIds), random() < 0.5 ? pick(noteIds) : null);
	}
	await attach('repository', pick(repositoryIds), pick(noteIds));
	if (rows.unions.length > 0) await attach('union', pick(rows.unions).id, pick(noteIds));

	const tasksOf: Array<['person' | 'union' | 'event' | 'source' | 'note' | null, string | null]> = [
		[null, null]
	];
	for (let i = 0; i < 30; i++) {
		tasksOf.push(['person', pick(rows.individuals).id]);
		if (hasEvents) tasksOf.push(['event', pick(rows.events).id]);
	}
	for (let i = 0; i < 5; i++) {
		if (rows.unions.length > 0) tasksOf.push(['union', pick(rows.unions).id]);
		tasksOf.push(['source', pick(sourceIds)]);
		tasksOf.push(['note', pick(noteIds)]);
	}
	for (const [index, [subjectKind, subjectId]] of tasksOf.entries()) {
		await t.db.insert(researchTasks).values({
			id: `${treeId.slice(0, 8)}-task-${index}`,
			treeId,
			title: `task ${index}`,
			subjectKind,
			subjectId,
			version: 1
		});
	}
	for (let i = 0; i < 12; i++) {
		const owner =
			i % 4 === 0 && rows.unions.length > 0 ? pick(rows.unions) : pick(rows.individuals);
		await t.db.insert(mediaItems).values({
			id: `${treeId.slice(0, 8)}-media-${i}`,
			treeId,
			entityId: i % 6 === 5 ? null : owner.id,
			r2ObjectKey: `media/${treeId}/${i}.png`,
			mimeType: 'image/png',
			version: 1
		});
	}
}

/** Up to ~50 seeds mixing every kind of id, some naming nothing, some asking for a whole table. */
function randomSeeds(whole: TreeRows, random: () => number, count: number): ScopeSeed[] {
	const sample = <T extends { id: string }>(list: T[], max: number) => {
		const out: string[] = [];
		const n = Math.floor(random() * (max + 1));
		for (let i = 0; i < n && list.length > 0; i++)
			out.push(list[Math.floor(random() * list.length)]!.id);
		return out;
	};
	const seeds: ScopeSeed[] = [emptySeed()];
	for (let i = 1; i < count; i++) {
		const kinds = Math.floor(random() * 4) + 1;
		const merged: Record<string, string[]> = {};
		const draw: Record<string, () => string[]> = {
			people: () => sample(whole.individuals, 3),
			unions: () => sample(whole.unions, 2),
			events: () => sample(whole.events, 3),
			names: () => sample(whole.personNames, 2),
			links: () => sample(whole.parentChild, 2),
			media: () => sample(whole.mediaItems, 2),
			citations: () => sample(whole.citations, 3),
			sources: () => sample(whole.sources, 1),
			repositories: () => sample(whole.repositories, 1),
			notes: () => sample(whole.notes, 1),
			noteAttachments: () => sample(whole.noteAttachments, 3),
			tasks: () => sample(whole.researchTasks, 3)
		};
		const names = Object.keys(draw);
		for (let k = 0; k < kinds; k++) {
			const name = names[Math.floor(random() * names.length)]!;
			merged[name] = [...(merged[name] ?? []), ...draw[name]!()];
		}
		if (random() < 0.2) merged.people = [...(merged.people ?? []), 'no-such-person'];
		const picked = seedOf({
			...merged,
			wholeTables: random() < 0.15 ? ['parentChild'] : undefined
		});
		seeds.push(picked);
	}
	return seeds;
}

async function checkTree(label: string, treeId: string, seedCount: number) {
	const whole = await new ChangeStore(t.db).loadRows(treeId);
	const loader = new ScopedRowLoader(t.db);
	const seeds = randomSeeds(whole, rng(label.length * 7919), seedCount);
	let maxWaves = 0;
	// Which tables the seeds actually selected rows from, so a green run cannot be all empty tables.
	const seen = new Set<string>();
	for (const [index, seed] of seeds.entries()) {
		const loaded = await loader.load(treeId, seed);
		expect(
			loaded,
			`${label} seed ${index} ${JSON.stringify(seed, (_k, v) => (v instanceof Set ? [...v] : v))}`
		).toEqual(selectScope(whole, seed));
		maxWaves = Math.max(maxWaves, loader.lastStats.waves);
		for (const [table, rows] of Object.entries(loaded)) if (rows.length > 0) seen.add(table);
	}
	for (const table of [
		'individuals',
		'unions',
		'parentChild',
		'citations',
		'sources',
		'repositories',
		'sourceRepositories',
		'notes',
		'noteAttachments',
		'researchTasks'
	])
		expect(seen, `${label} never selected ${table}`).toContain(table);
	return maxWaves;
}

describe('the scoped loader agrees with the selector', () => {
	it('on The Simpsons with evidence added', async () => {
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, simpsons, 'Simpsons');
		await addEvidence(treeId, await new ChangeStore(t.db).loadRows(treeId), rng(11));
		const maxWaves = await checkTree('Simpsons', treeId, 50);
		expect(maxWaves).toBeLessThanOrEqual(8);
	}, 120_000);

	it('on the generated corpus with evidence added', async () => {
		const treeId = await createTestTree(t.db, actor);
		await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8), shouldNameThePeople: true });
		await addEvidence(treeId, await new ChangeStore(t.db).loadRows(treeId), rng(23));
		const maxWaves = await checkTree('Corpus', treeId, 50);
		expect(maxWaves).toBeLessThanOrEqual(8);
	}, 600_000);

	it('does not read another tree even when a seed names its ids', async () => {
		const mine = await createTestTree(t.db, actor);
		const theirs = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, mine, simpsons, 'Mine');
		await importGedcomToDb(t.d1, theirs, simpsons, 'Theirs');
		const other = await new ChangeStore(t.db).loadRows(theirs);
		const seed = seedOf({
			people: other.individuals.slice(0, 3).map((p) => p.id),
			events: other.events.slice(0, 3).map((e) => e.id)
		});
		const loaded = await new ScopedRowLoader(t.db).load(mine, seed);
		for (const rows of Object.values(loaded)) expect(rows).toEqual([]);
	}, 60_000);

	it('loads a whole table in the same order as the whole-tree load', async () => {
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, simpsons, 'Simpsons');
		const store = new ChangeStore(t.db);
		const whole = await store.loadRows(treeId);
		const loaded = await new ScopedRowLoader(t.db).load(
			treeId,
			seedOf({ wholeTables: ['parentChild', 'events', 'personNames'] })
		);
		expect(loaded.parentChild).toEqual(whole.parentChild);
		expect(loaded.events).toEqual(whole.events);
		expect(loaded.personNames).toEqual(whole.personNames);
		expect(loaded.individuals).toEqual([]);
	}, 60_000);
});
