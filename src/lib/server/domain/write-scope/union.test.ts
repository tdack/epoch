import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import duplicateFamilies from '../../../../../test/data/The Simpsons duplicate families.ged?raw';
import simpsonsNames from '../../../../../test/data/The Simpsons names.ged?raw';
import simpsons from '../../../../../test/data/The Simpsons.ged?raw';
import { ChangeStore } from '../../repositories/change-store';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from '../../fixtures/genealogy-fixtures';
import { insertCorpus } from '../../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../../testing/d1';
import { addEvidence, seededRandom } from '../../testing/evidence-fixtures';
import { importGedcomToDb } from '../../testing/gedcom';
import { TEST_TREE_ID } from '../../testing/rows';
import { expectScopedEqualsWhole, viewerScopes } from '../../testing/scope-equivalence';
import type { TreeRows } from '../change-log';
import type { RelationshipCommand } from '../relationship-commands';
import { seedOf } from '../write-scope';
import { seedFor } from './index';
import { UNION_SCOPES } from './union';

const scopes = viewerScopes();
const CREATOR = 'creator-1';

interface World {
	label: string;
	rows: TreeRows;
}

let t: TestDatabase;
const worlds: World[] = [];

/**
 * The planner checks rows against the tree it plans for, and the harness plans for `TEST_TREE_ID`,
 * so the imported rows are moved into it. Some people belong to the contributor, so that scope
 * differs from the restricted one.
 */
function prepared(rows: TreeRows): TreeRows {
	const moved = Object.fromEntries(
		Object.entries(rows).map(([table, list]) => [
			table,
			(list as Array<Record<string, unknown>>).map((row) =>
				'treeId' in row ? { ...row, treeId: TEST_TREE_ID } : row
			)
		])
	) as unknown as TreeRows;
	return {
		...moved,
		individuals: moved.individuals.map((p, index) =>
			index % 4 === 0 ? { ...p, createdBy: CREATOR } : p
		)
	};
}

beforeAll(async () => {
	t = await createTestDatabase();
	const actor = await createTestUser(t.db);
	const store = new ChangeStore(t.db);
	const imports: Array<[string, string]> = [
		['Simpsons', simpsons],
		['Simpsons duplicate families', duplicateFamilies],
		['Simpsons names', simpsonsNames],
		['Representative', REPRESENTATIVE_GEDCOM_FIXTURE]
	];
	for (const [index, [label, gedcom]] of imports.entries()) {
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, gedcom, label);
		await addEvidence(t.db, treeId, await store.loadRows(treeId), seededRandom(31 + index));
		worlds.push({ label, rows: prepared(await store.loadRows(treeId)) });
	}
	const treeId = await createTestTree(t.db, actor);
	await insertCorpus(t.db, treeId, {
		prefix: treeId.slice(0, 8),
		lineages: 2,
		generations: 6,
		shouldNameThePeople: true
	});
	await addEvidence(t.db, treeId, await store.loadRows(treeId), seededRandom(47));
	worlds.push({ label: 'Corpus', rows: prepared(await store.loadRows(treeId)) });
}, 120_000);

afterAll(async () => {
	await t.dispose();
});

/** Every `n`th item, so a large corpus is sampled the same way on every run. */
function every<T>(items: T[], limit: number): T[] {
	const step = Math.max(1, Math.ceil(items.length / limit));
	return items.filter((_, index) => index % step === 0);
}

const OTHER_TYPES = ['biological', 'adoptive', 'foster', 'guardian', 'unknown'] as const;

function unionCommands(rows: TreeRows): RelationshipCommand[] {
	const commands: RelationshipCommand[] = [];
	const people = rows.individuals.map((p) => p.id);
	for (const [index, union] of every(rows.unions, 25).entries()) {
		const members = rows.unionPartners.filter((p) => p.unionId === union.id).map((p) => p.personId);
		const outsider = people.find((id) => !members.includes(id)) ?? 'nobody';
		commands.push(
			{ kind: 'destroy_union', unionId: union.id },
			{ kind: 'destroy_union', unionId: union.id, expectedVersion: union.version + 7 },
			{
				kind: 'end_union',
				unionId: union.id,
				status: 'divorced',
				event: { type: 'DIV', dateText: '1999', place: 'York' }
			},
			{ kind: 'end_union', unionId: union.id, status: 'ended', event: null },
			{ kind: 'update_union', unionId: union.id, expectedVersion: union.version, events: [] },
			{
				kind: 'update_union',
				unionId: union.id,
				expectedVersion: union.version,
				status: 'separated',
				events: [{ type: 'MARR', dateText: '1950', place: null }]
			},
			{ kind: 'update_union', unionId: union.id, expectedVersion: union.version + 3 },
			{ kind: 'add_partner_to_union', unionId: union.id, personId: outsider },
			{ kind: 'add_partner_to_union', unionId: union.id, personId: members[0] ?? 'nobody' },
			{ kind: 'add_partner_to_union', unionId: union.id, personId: 'no-such-person' },
			{ kind: 'remove_partner_from_union', unionId: union.id, personId: outsider },
			{ kind: 'remove_partner_from_union', unionId: union.id, personId: members[0] ?? 'nobody' }
		);
		if (members[1])
			commands.push({
				kind: 'remove_partner_from_union',
				unionId: union.id,
				personId: members[1],
				expectedVersion: union.version
			});
		if (index % 3 === 0) {
			commands.push({
				kind: 'create_union',
				unionId: `new-${union.id}`,
				personIds: members.length > 0 ? members : [outsider]
			});
		}
	}
	commands.push(
		{ kind: 'destroy_union', unionId: 'no-such-union' },
		{ kind: 'end_union', unionId: 'no-such-union', status: 'ended', event: null },
		{ kind: 'update_union', unionId: 'no-such-union', expectedVersion: 1 },
		{ kind: 'add_partner_to_union', unionId: 'no-such-union', personId: people[0] ?? 'x' },
		{ kind: 'remove_partner_from_union', unionId: 'no-such-union', personId: people[0] ?? 'x' },
		{ kind: 'create_union', unionId: 'new-none', personIds: [] },
		{
			kind: 'create_union',
			unionId: 'new-missing',
			personIds: [people[0] ?? 'x', 'no-such-person']
		}
	);
	const sample = every(people, 12);
	for (const [index, id] of sample.entries()) {
		commands.push({ kind: 'create_union', unionId: `new-solo-${index}`, personIds: [id] });
		const other = sample[(index + 1) % sample.length]!;
		commands.push({ kind: 'create_union', unionId: `new-pair-${index}`, personIds: [id, other] });
		commands.push({ kind: 'create_union', unionId: `new-dup-${index}`, personIds: [id, id] });
	}
	return commands;
}

function linkCommands(rows: TreeRows): RelationshipCommand[] {
	const commands: RelationshipCommand[] = [];
	const people = rows.individuals.map((p) => p.id);
	const unionIds = rows.unions.map((u) => u.id);
	for (const link of every(rows.parentChild, 40)) {
		const type = link.type as (typeof OTHER_TYPES)[number];
		const other = OTHER_TYPES.find((o) => o !== type)!;
		commands.push(
			{ kind: 'remove_parent_child', parentId: link.parentId, childId: link.childId, type },
			{
				kind: 'remove_parent_child',
				parentId: link.parentId,
				childId: link.childId,
				type: other
			},
			{
				kind: 'change_parent_child_type',
				parentId: link.parentId,
				childId: link.childId,
				fromType: type,
				toType: other
			},
			{
				kind: 'change_parent_child_type',
				parentId: link.parentId,
				childId: link.childId,
				fromType: type,
				toType: type
			},
			{
				kind: 'change_parent_child_type',
				parentId: link.parentId,
				childId: link.childId,
				fromType: other,
				toType: type
			},
			// The same assertion again, with and without its partnership: a duplicate.
			{
				kind: 'assert_parent_child',
				parentId: link.parentId,
				childId: link.childId,
				type,
				unionId: link.unionId
			},
			{
				kind: 'assert_parent_child',
				parentId: link.parentId,
				childId: link.childId,
				type: other,
				unionId: null
			},
			// A cycle: the child as the parent of the parent.
			{
				kind: 'assert_parent_child',
				parentId: link.childId,
				childId: link.parentId,
				type: 'biological',
				unionId: null
			}
		);
	}
	// A deeper cycle: the oldest ancestor under their own descendant, found by walking up.
	const parentsOf = new Map<string, string[]>();
	for (const l of rows.parentChild)
		parentsOf.set(l.childId, [...(parentsOf.get(l.childId) ?? []), l.parentId]);
	for (const child of every([...parentsOf.keys()], 15)) {
		let ancestor = child;
		for (let step = 0; step < 6 && parentsOf.has(ancestor); step++)
			ancestor = parentsOf.get(ancestor)![0]!;
		if (ancestor !== child)
			commands.push({
				kind: 'assert_parent_child',
				parentId: child,
				childId: ancestor,
				type: 'biological',
				unionId: null
			});
	}
	// Assertions that are valid: no existing link between the two, and no cycle.
	const ancestorsOf = (id: string, seen = new Set<string>()): Set<string> => {
		for (const parent of parentsOf.get(id) ?? [])
			if (!seen.has(parent)) {
				seen.add(parent);
				ancestorsOf(parent, seen);
			}
		return seen;
	};
	const linked = new Set(rows.parentChild.map((l) => `${l.parentId}>${l.childId}`));
	let valid = 0;
	for (const [index, parentId] of every(people, 40).entries()) {
		const childId = people[(people.indexOf(parentId) * 7 + 3) % people.length]!;
		if (parentId === childId || linked.has(`${parentId}>${childId}`)) continue;
		if (ancestorsOf(parentId).has(childId)) continue;
		const unionId =
			unionIds.length > 0 && index % 2 === 0 ? unionIds[index % unionIds.length]! : null;
		commands.push({ kind: 'assert_parent_child', parentId, childId, type: 'biological', unionId });
		if (++valid >= 12) break;
	}
	const sample = every(people, 14);
	for (const [index, parentId] of sample.entries()) {
		const childId = sample[(index * 3 + 1) % sample.length]!;
		const unionId = unionIds.length > 0 ? unionIds[index % unionIds.length]! : null;
		commands.push(
			{ kind: 'assert_parent_child', parentId, childId, type: 'biological', unionId: null },
			{ kind: 'assert_parent_child', parentId, childId, type: 'adoptive', unionId },
			{ kind: 'assert_parent_child', parentId, childId: parentId, type: 'foster', unionId: null },
			{
				kind: 'assert_parent_child',
				parentId,
				childId: 'no-such-person',
				type: 'biological',
				unionId: null
			},
			{
				kind: 'assert_parent_child',
				parentId: 'no-such-person',
				childId,
				type: 'biological',
				unionId: null
			},
			{
				kind: 'assert_parent_child',
				parentId,
				childId,
				type: 'guardian',
				unionId: 'no-such-union'
			},
			{ kind: 'remove_parent_child', parentId, childId, type: 'biological' },
			{
				kind: 'change_parent_child_type',
				parentId,
				childId,
				fromType: 'biological',
				toType: 'adoptive'
			}
		);
	}
	return commands;
}

/** Runs every command, for every viewer, against every world; returns how each came out. */
function checkAll(
	kinds: RelationshipCommand['kind'][],
	make: (rows: TreeRows) => RelationshipCommand[]
) {
	let ok = 0;
	let failed = 0;
	const failures = new Set<string>();
	for (const world of worlds) {
		for (const command of make(world.rows).filter((c) => kinds.includes(c.kind))) {
			for (const [viewer, scope] of Object.entries(scopes)) {
				const outcome = expectScopedEqualsWhole({
					whole: world.rows,
					commands: [command],
					scope,
					seed: (cs) => seedFor(cs)!,
					label: `${world.label} ${viewer} ${JSON.stringify(command)}`
				});
				if (outcome.failure) {
					failed++;
					failures.add(outcome.failure.name);
				} else if ((outcome.ops?.length ?? 0) > 0) ok++;
			}
		}
	}
	return { ok, failed, failures };
}

const GROUPS = [
	{
		name: 'partnership creation',
		make: unionCommands,
		kinds: ['create_union'] as const
	},
	{
		name: 'partners',
		make: unionCommands,
		kinds: ['add_partner_to_union', 'remove_partner_from_union'] as const
	},
	{
		name: 'parent-child links',
		make: linkCommands,
		kinds: ['assert_parent_child', 'remove_parent_child', 'change_parent_child_type'] as const
	}
];

for (const group of GROUPS) {
	describe(`${group.name} plan over a scoped snapshot`, () => {
		it.each(group.kinds)(
			'%s equals planning over the whole tree for every viewer',
			(kind) => {
				expect(UNION_SCOPES[kind], kind).toBeDefined();
				const { ok, failed } = checkAll([kind], group.make);
				// Not vacuous: some commands plan, and some are refused.
				expect(ok).toBeGreaterThan(20);
				expect(failed).toBeGreaterThan(0);
			},
			300_000
		);
	});
}

it('asks for every link only when asserting one', () => {
	const assertion = seedFor([
		{ kind: 'assert_parent_child', parentId: 'a', childId: 'b', type: 'biological', unionId: null }
	]);
	expect(assertion?.wholeTables).toEqual(['parentChild']);
	const removal = seedFor([
		{ kind: 'remove_parent_child', parentId: 'a', childId: 'b', type: 'biological' }
	]);
	expect(removal?.wholeTables).toBeUndefined();
});

describe('partnership edits that name only the partnership stay whole-tree', () => {
	it.each(['update_union', 'end_union', 'destroy_union'] as const)('%s has no seed', (kind) => {
		expect(UNION_SCOPES[kind]).toBeUndefined();
	});

	it('because a seed of the partnership alone misses its twins, which the labels count', () => {
		const rows = worlds.find((w) => w.label === 'Simpsons duplicate families')!.rows;
		let isMismatched = false;
		for (const union of rows.unions) {
			try {
				expectScopedEqualsWhole({
					whole: rows,
					commands: [{ kind: 'destroy_union', unionId: union.id }],
					scope: scopes.unrestricted,
					seed: seedOf({ unions: [union.id] })
				});
			} catch {
				isMismatched = true;
				break;
			}
		}
		expect(isMismatched).toBe(true);
	});
});
