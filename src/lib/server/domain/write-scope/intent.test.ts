import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import duplicateFamilies from '../../../../../test/data/The Simpsons duplicate families.ged?raw';
import type { DbClient } from '../../db';
import { ChangeStore } from '../../repositories/change-store';
import { ScopedRowLoader } from '../../repositories/scoped-row-loader';
import { MutationRunner } from '../../services/mutation-runner';
import type { ViewerScope } from '../../services/tree-access';
import { createTestTree, createTestUser, type TestDatabase } from '../../testing/d1';
import { addEvidence, seededRandom } from '../../testing/evidence-fixtures';
import { importGedcomToDb } from '../../testing/gedcom';
import { TEST_TREE_ID, sequentialIds } from '../../testing/rows';
import { viewerScopes } from '../../testing/scope-equivalence';
import { createWorlds, type World } from '../../testing/scope-worlds';
import type { TreeRows } from '../change-log';
import { pastTense } from '../command-summary';
import { describeImpact } from '../impact';
import { planRelationshipCommand, type RelationshipPlan } from '../relationship-commands';
import type { PersonRef, RelationshipIntent } from '../relationship-sentence';
import { seedOf, selectScope, type ScopeSeed } from '../write-scope';
import { intentSeed } from './intent';

const scopes = viewerScopes();
const FIXED_NOW_MS = 1_700_000_000_000;

let t: TestDatabase;
let worlds: World[] = [];

beforeAll(async () => {
	({ t, worlds } = await createWorlds());
}, 120_000);

afterAll(async () => {
	await t.dispose();
});

/**
 * What `RelationshipService.plan` and `execute` show and store, or how they failed: the plan over
 * the rows the viewer may see, then the runner's ops over every row, then the impact.
 */
function outcomeOf(rows: TreeRows, intent: RelationshipIntent, scope: ViewerScope) {
	const runner = new MutationRunner({} as DbClient, {
		now: () => FIXED_NOW_MS,
		newId: sequentialIds('new')
	});
	let stage = 'plan';
	let plan: RelationshipPlan | undefined;
	try {
		const visible = runner.visibleRows(rows, scope);
		plan = planRelationshipCommand(intent, {
			rows: visible,
			hasDuplicateName: false,
			newId: runner.clock.newId
		});
		stage = 'ops';
		const ops = runner.planFor(TEST_TREE_ID, rows, plan.commands, scope);
		return {
			plan,
			ops,
			summary: pastTense(plan.sentence),
			impact: describeImpact(plan.sentence, visible, ops)
		};
	} catch (error) {
		return {
			plan,
			failure: {
				stage,
				name: error instanceof Error ? error.constructor.name : typeof error,
				message: error instanceof Error ? error.message : String(error)
			}
		};
	}
}

type Seeder = (intent: RelationshipIntent) => ScopeSeed | null;

/** Compares the two sides; returns the whole-tree outcome so a test can see the case was not vacuous. */
function compare(
	world: World,
	intent: RelationshipIntent,
	scope: ViewerScope,
	seeder: Seeder = intentSeed
) {
	const whole = outcomeOf(world.rows, intent, scope);
	const seed = seeder(intent);
	if (!seed) return { isWhole: true, whole };
	const scoped = outcomeOf(selectScope(world.rows, seed), intent, scope);
	expect(scoped, `${world.label} ${JSON.stringify(intent)}`).toEqual(whole);
	return { isWhole: false, whole };
}

function every<T>(items: T[], limit: number): T[] {
	const step = Math.max(1, Math.ceil(items.length / limit));
	return items.filter((_, index) => index % step === 0);
}

function refOf(rows: TreeRows, id: string): PersonRef {
	const p = rows.individuals.find((r) => r.id === id);
	return { id, givenName: p?.givenName ?? null, surname: p?.surname ?? null };
}

const NEW: PersonRef = { id: 'placeholder', givenName: 'Nova', surname: 'Newcomer', isNew: true };
const TYPES = ['biological', 'adoptive', 'foster', 'guardian', 'unknown'] as const;

type Kind = RelationshipIntent['kind'];

function intentsFor(kind: Kind, rows: TreeRows): RelationshipIntent[] {
	const out: RelationshipIntent[] = [];
	const people = rows.individuals.map((p) => p.id);
	const sample = every(people, 14);
	const unionIds = rows.unions.map((u) => u.id);
	const membersOf = (unionId: string) =>
		rows.unionPartners.filter((p) => p.unionId === unionId).map((p) => p.personId);
	const unionsOf = (id: string) =>
		rows.unionPartners.filter((p) => p.personId === id).map((p) => p.unionId);
	const parentsOf = (id: string) => rows.parentChild.filter((l) => l.childId === id);
	const ref = (id: string) => refOf(rows, id);
	const missing = refOf(rows, 'no-such-person');
	/** The first parent, `steps` generations up: a cycle that only a walk of every link finds. */
	const ancestorOf = (start: string, steps: number) => {
		let at = start;
		for (let step = 0; step < steps; step++) {
			const up = parentsOf(at)[0];
			if (!up) break;
			at = up.parentId;
		}
		return at;
	};
	const pick = (index: number) => (unionIds.length > 0 ? unionIds[index % unionIds.length]! : null);

	for (const [index, id] of sample.entries()) {
		const other = sample[(index + 1) % sample.length]!;
		const type = TYPES[index % TYPES.length]!;
		const stray = pick(index * 5 + 1);
		const own = unionsOf(id);
		const parental = [...new Set(parentsOf(id).flatMap((l) => (l.unionId ? [l.unionId] : [])))];
		const unionChoices: Array<string | null | undefined> = [
			undefined,
			null,
			stray,
			'no-such-union',
			...own.slice(0, 2),
			...parental.slice(0, 2)
		];
		switch (kind) {
			case 'add_parent':
				for (const unionId of unionChoices)
					out.push({
						kind,
						child: ref(id),
						parent: index % 2 === 0 ? ref(other) : NEW,
						type,
						role: 'parent',
						unionLabel: null,
						unionId
					});
				out.push(
					{ kind, child: ref(id), parent: ref(id), type, role: 'mother', unionLabel: null },
					{ kind, child: ref(id), parent: missing, type, role: 'father', unionLabel: null },
					{ kind, child: missing, parent: ref(id), type, role: 'father', unionLabel: null }
				);
				// A cycle: an ancestor becomes the child of their own descendant.
				for (const l of parentsOf(id).slice(0, 2))
					out.push({
						kind,
						child: ref(l.parentId),
						parent: ref(id),
						type: 'biological',
						role: 'parent',
						unionLabel: null
					});
				break;
			case 'add_child':
				for (const unionId of unionChoices)
					out.push({
						kind,
						parent: ref(id),
						child: index % 2 === 0 ? ref(other) : NEW,
						type,
						unionLabel: null,
						unionId
					});
				out.push(
					{ kind, parent: ref(id), child: ref(id), type, unionLabel: null },
					{ kind, parent: missing, child: ref(id), type, unionLabel: null }
				);
				for (const l of parentsOf(id).slice(0, 2))
					out.push({
						kind,
						parent: ref(id),
						child: ref(l.parentId),
						type: 'biological',
						unionLabel: null
					});
				for (const steps of [2, 4, 6])
					out.push({
						kind,
						parent: ref(id),
						child: ref(ancestorOf(id, steps)),
						type: 'biological',
						unionLabel: null
					});
				break;
			case 'add_sibling': {
				const parents = parentsOf(id).map((l) => l.parentId);
				const sibling = index % 2 === 0 ? ref(other) : NEW;
				out.push(
					{ kind, person: ref(id), sibling, parentIds: parents, type },
					{ kind, person: ref(id), sibling, parentIds: parents.slice(0, 1), type },
					{ kind, person: ref(id), sibling, parentIds: [], type },
					{ kind, person: ref(id), sibling: ref(id), parentIds: parents, type },
					// Not the person's parents: a stranger, a stranger alongside real parents, a missing id.
					{ kind, person: ref(id), sibling, parentIds: [other], type },
					{ kind, person: ref(id), sibling, parentIds: [...parents, other], type },
					{ kind, person: ref(id), sibling, parentIds: ['no-such-person'], type },
					{ kind, person: ref(id), sibling, parentIds: [...parents, ...parents], type },
					{ kind, person: missing, sibling, parentIds: parents, type }
				);
				// A sibling who is the parents' own ancestor: a cycle found only by walking every link.
				for (const steps of [2, 4, 6])
					out.push({
						kind,
						person: ref(id),
						sibling: ref(ancestorOf(id, steps)),
						parentIds: parents,
						type: 'biological'
					});
				break;
			}
			case 'add_partner': {
				const open = rows.unions.filter((u) => membersOf(u.id).length === 1).map((u) => u.id);
				for (const unionId of [...unionChoices, ...open.slice(0, 2)])
					out.push({
						kind,
						person: ref(id),
						partner: index % 2 === 0 ? ref(other) : NEW,
						unionLabel: null,
						unionId
					});
				// Already partners, and partners again after an ended partnership.
				for (const unionId of own.slice(0, 2))
					for (const partnerId of membersOf(unionId).filter((m) => m !== id))
						out.push({ kind, person: ref(id), partner: ref(partnerId), unionLabel: null });
				out.push(
					{ kind, person: ref(id), partner: ref(id), unionLabel: null },
					{ kind, person: ref(id), partner: missing, unionLabel: null },
					{ kind, person: missing, partner: ref(other), unionLabel: null }
				);
				break;
			}
			case 'change_link_type':
				for (const l of parentsOf(id).slice(0, 3)) {
					const from = l.type as (typeof TYPES)[number];
					const to = TYPES.find((o) => o !== from)!;
					out.push(
						{ kind, parent: ref(l.parentId), child: ref(id), fromType: from, toType: to },
						{ kind, parent: ref(l.parentId), child: ref(id), fromType: from, toType: from },
						{ kind, parent: ref(l.parentId), child: ref(id), fromType: to, toType: from },
						{ kind, parent: ref(id), child: ref(l.parentId), fromType: from, toType: to }
					);
				}
				out.push(
					{ kind, parent: ref(id), child: ref(other), fromType: 'biological', toType: 'adoptive' },
					{ kind, parent: missing, child: ref(id), fromType: 'biological', toType: 'adoptive' }
				);
				break;
			case 'record_death':
				for (const dateText of ['1900', 'ABT 1850', null, '  ', '2020-05-04', 'BEF 1000'])
					out.push({ kind, person: ref(id), dateText, place: dateText ? 'York' : null });
				out.push(
					{ kind, person: ref(id), dateText: '1900', place: null, personVersion: 99 },
					{ kind, person: missing, dateText: '1900', place: null }
				);
				break;
			case 'end_union': {
				const endings = [
					{ status: 'divorced', event: { type: 'DIV', dateText: '1999', place: 'York' } },
					{ status: 'ended', event: null },
					{ status: 'separated', event: { type: 'DIV', dateText: '1000', place: null } }
				] as const;
				for (const unionId of [null, ...own, stray, 'no-such-union'])
					for (const ending of endings)
						out.push({ kind, person: ref(id), unionId, ...ending } as RelationshipIntent);
				out.push({ kind, person: missing, unionId: null, status: 'ended', event: null });
				break;
			}
		}
	}
	return out;
}

const KINDS: Kind[] = [
	'add_child',
	'add_sibling',
	'add_partner',
	'change_link_type',
	'record_death',
	'end_union'
];

describe('relationship intents plan over a scoped snapshot', () => {
	it.each(KINDS)(
		'%s equals planning over the whole tree for every viewer',
		(kind) => {
			let planned = 0;
			let refused = 0;
			for (const world of worlds)
				for (const intent of intentsFor(kind, world.rows))
					for (const scope of Object.values(scopes)) {
						const { isWhole, whole } = compare(world, intent, scope);
						expect(isWhole).toBe(false);
						if (whole.failure || whole.plan?.commands.length === 0) refused++;
						else if ((whole.ops?.length ?? 0) > 0) planned++;
					}
			expect(planned).toBeGreaterThan(20);
			expect(refused).toBeGreaterThan(0);
		},
		300_000
	);
});

/** Whether a seeder disagrees with the whole tree on any intent of the kind, for any viewer. */
function isCaught(kind: Kind, seeder: Seeder): boolean {
	for (const world of worlds)
		for (const intent of intentsFor(kind, world.rows))
			for (const scope of Object.values(scopes)) {
				try {
					compare(world, intent, scope, seeder);
				} catch {
					return true;
				}
			}
	return false;
}

function withoutWholeTables(seed: ScopeSeed | null): ScopeSeed | null {
	if (!seed) return null;
	const { wholeTables, ...rest } = seed;
	void wholeTables;
	return rest;
}

describe('add_parent stays whole-tree', () => {
	it('has no seed', () => {
		for (const intent of intentsFor('add_parent', worlds[0]!.rows))
			expect(intentSeed(intent)).toBeNull();
	});

	it('because the people it names miss the family it joins and that pair’s other partnerships', () => {
		const named: Seeder = (intent) =>
			intent.kind === 'add_parent'
				? seedOf({
						people: [intent.child, intent.parent].filter((p) => !p.isNew).map((p) => p.id),
						unions: [intent.unionId],
						wholeTables: ['parentChild']
					})
				: null;
		expect(isCaught('add_parent', named)).toBe(true);
	});
});

describe('the proof is not vacuous', () => {
	it('catches add_child and add_sibling without the whole link table', () => {
		expect(isCaught('add_child', (i) => withoutWholeTables(intentSeed(i)))).toBe(true);
		expect(isCaught('add_sibling', (i) => withoutWholeTables(intentSeed(i)))).toBe(true);
	});

	it('catches end_union seeded by the partnership alone, which misses its twins', () => {
		expect(
			isCaught('end_union', (i) =>
				i.kind === 'end_union' ? seedOf({ unions: [i.unionId] }) : null
			)
		).toBe(true);
	});

	it('catches record_death seeded by nobody', () => {
		expect(isCaught('record_death', () => seedOf({}))).toBe(true);
	});

	it('catches add_partner without the partner', () => {
		expect(
			isCaught('add_partner', (i) =>
				i.kind === 'add_partner' ? seedOf({ people: [i.person.id], unions: [i.unionId] }) : null
			)
		).toBe(true);
	});
});

describe('the D1 loader returns what the selector does for these seeds', () => {
	it('for intents of each kind', async () => {
		const actor = await createTestUser(t.db);
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, duplicateFamilies, 'Intent loader');
		const store = new ChangeStore(t.db);
		await addEvidence(t.db, treeId, await store.loadRows(treeId), seededRandom(59));
		const whole = await store.loadRows(treeId);
		const loader = new ScopedRowLoader(t.db);
		for (const kind of KINDS) {
			const intents = intentsFor(kind, whole);
			expect(intents.length).toBeGreaterThan(0);
			for (const intent of every(intents, 6)) {
				const seed = intentSeed(intent)!;
				expect(await loader.load(treeId, seed), `${kind} ${JSON.stringify(intent)}`).toEqual(
					selectScope(whole, seed)
				);
			}
		}
	}, 120_000);
});
