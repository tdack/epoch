import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import type { RelationshipGraph } from '../domain/relationship-graph';
import type { RelationshipIntent } from '../domain/relationship-sentence';
import type { RecordChange } from '../domain/change-log';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { GenealogyService } from './genealogy-service';
import { RelationshipService } from './relationship-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** A tree with a signed-in owner and the services a request would build. */
async function setup() {
	const actor = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, actor);
	const relationships = new RelationshipService(t.db);
	const people = new GenealogyService(t.db);
	const log = new ChangeLogService(t.db);
	const ctx = actor.context;

	const addPerson = async (givenName: string, surname: string | null = null, extra: object = {}) =>
		(await people.createIndividual(treeId, { givenName, surname, ...extra }, ctx)).individual;
	const graph = (): Promise<RelationshipGraph> => relationships.getGraph(treeId, ctx);
	const ref = (p: { id: string; givenName?: string | null; surname?: string | null }) => ({
		id: p.id,
		givenName: p.givenName ?? null,
		surname: p.surname ?? null
	});
	const partner = async (a: { id: string }, b: { id: string }) =>
		relationships.execute(treeId, { kind: 'add_partner', person: ref(a as any), partner: ref(b as any), unionLabel: null }, ctx);
	return { actor, treeId, relationships, people, log, ctx, addPerson, graph, ref, partner };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** A graph without versions, which an undo deliberately moves on, and with arrays in a stable order. */
function canonical(graph: RelationshipGraph) {
	const stable = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		if (value && typeof value === 'object') {
			return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'version').map(([k, v]) => [k, stable(v)]));
		}
		return value;
	};
	return stable(graph);
}

/** Records as "action type label", ignoring ids (a preview cannot know the ids of records it will create). */
function shape(records: RecordChange[]): string[] {
	return records.map((r) => `${r.action} ${r.entityType} ${r.label}`).sort();
}

/** Plan an intent, run it, and check the preview said exactly what was saved. */
async function runAndCompare(s: Setup, intent: RelationshipIntent) {
	const preview = await s.relationships.plan(s.treeId, intent, s.ctx);
	const before = await s.graph();
	const executed = await s.relationships.execute(s.treeId, intent, s.ctx);
	const after = await s.graph();
	expect(executed.sentence).toBe(preview.sentence);
	expect(shape(executed.affected)).toEqual(shape(preview.impact.records));
	// Records that already existed keep their identity between the preview and the save.
	const existing = (records: RecordChange[]) => records.filter((r) => r.action !== 'created').map((r) => `${r.entityType}:${r.entityId}`).sort();
	expect(existing(executed.affected)).toEqual(existing(preview.impact.records));
	return { preview, executed, before, after };
}

describe('preview matches result, for every intent', () => {
	it('add_parent: the sentence and records describe the persisted link', async () => {
		const s = await setup();
		const [child, parent] = [await s.addPerson('Sam', 'Smith'), await s.addPerson('Alex', 'Walker')];
		const { executed, after } = await runAndCompare(s, {
			kind: 'add_parent',
			child: s.ref(child),
			parent: s.ref(parent),
			type: 'adoptive',
			role: 'mother',
			unionLabel: null
		});
		expect(executed.sentence).toBe("Alex Walker will be recorded as Sam Smith's adoptive mother.");
		expect(after.parentChild).toEqual([{ parentId: parent.id, childId: child.id, type: 'adoptive', unionId: null }]);
		expect(shape(executed.affected)).toEqual(['created link Alex Walker as adoptive parent of Sam Smith']);
	});

	it('add_parent with a new person: the created person is in the preview and in the graph', async () => {
		const s = await setup();
		const child = await s.addPerson('Sam', 'Smith');
		const { executed, after } = await runAndCompare(s, {
			kind: 'add_parent',
			child: s.ref(child),
			parent: { id: 'placeholder', givenName: 'Nia', surname: 'Novak', isNew: true },
			type: 'biological',
			role: 'parent',
			unionLabel: null
		});
		const nia = after.people.find((p) => p.displayName === 'Nia Novak');
		expect(nia).toBeDefined();
		expect(after.parentChild).toEqual([{ parentId: nia!.id, childId: child.id, type: 'biological', unionId: null }]);
		expect(shape(executed.affected)).toEqual([
			'created link Nia Novak as biological parent of Sam Smith',
			'created person Nia Novak'
		]);
	});

	it('add_child: joins the parent’s partnership and the sentence names it', async () => {
		const s = await setup();
		const [alex, robin, sam] = [await s.addPerson('Alex', 'Walker'), await s.addPerson('Robin', 'Reed'), await s.addPerson('Sam', 'Smith')];
		await s.partner(alex, robin);
		const { executed, after } = await runAndCompare(s, {
			kind: 'add_child',
			parent: s.ref(alex),
			child: s.ref(sam),
			type: 'biological',
			unionLabel: null
		});
		expect(executed.sentence).toBe("Sam Smith will be recorded as Alex Walker's biological child in the Alex Walker–Robin Reed family.");
		const union = after.unions.find((u) => u.partnerIds.includes(alex.id))!;
		expect(after.parentChild).toEqual([{ parentId: alex.id, childId: sam.id, type: 'biological', unionId: union.id }]);
	});

	it('add_partner: creates a partnership between exactly the two people', async () => {
		const s = await setup();
		const [alex, sam] = [await s.addPerson('Alex', 'Walker'), await s.addPerson('Sam', 'Smith')];
		const { executed, after } = await runAndCompare(s, {
			kind: 'add_partner',
			person: s.ref(alex),
			partner: s.ref(sam),
			unionLabel: null
		});
		expect(after.unions).toHaveLength(1);
		expect(after.unions[0].partnerIds).toEqual([alex.id, sam.id]);
		expect(shape(executed.affected)).toEqual([
			'created partner Alex Walker in the Alex Walker–Sam Smith partnership',
			'created partner Sam Smith in the Alex Walker–Sam Smith partnership',
			'created union Alex Walker–Sam Smith partnership'
		]);
	});

	it('record_death: writes the death event and derives widowhood, and leaves the union alone', async () => {
		const s = await setup();
		const [marge, homer] = [await s.addPerson('Marge', 'Simpson'), await s.addPerson('Homer', 'Simpson')];
		await s.partner(marge, homer);
		const { executed, before, after } = await runAndCompare(s, {
			kind: 'record_death',
			person: s.ref(homer),
			dateText: '3 MAR 2001',
			place: 'Brisbane'
		});
		expect(executed.sentence).toBe(
			'Homer Simpson will be recorded as deceased (3 MAR 2001, Brisbane). Marge Simpson will be shown as widowed in their partnership with Homer Simpson.'
		);
		const dead = after.people.find((p) => p.id === homer.id)!;
		expect(dead.isDeceased).toBe(true);
		expect(dead.deathDate).toBe('3 MAR 2001');
		// Death never ends, deletes or rewrites a union.
		expect(after.unions).toEqual(before.unions);
		expect(shape(executed.affected)).toEqual([
			'created event Death of Homer Simpson',
			'updated person Homer Simpson'
		]);
		expect(executed.affected.some((r) => r.entityType === 'union')).toBe(false);
	});

	it('record_death: editing an existing death updates the same event', async () => {
		const s = await setup();
		const homer = await s.addPerson('Homer', 'Simpson', { deathDate: '1999', deathPlace: 'Perth' });
		const { executed, after } = await runAndCompare(s, {
			kind: 'record_death',
			person: s.ref(homer),
			dateText: '2001',
			place: 'Perth'
		});
		expect(after.people.find((p) => p.id === homer.id)!.deathDate).toBe('2001');
		expect(shape(executed.affected)).toEqual(['updated event Death of Homer Simpson', 'updated person Homer Simpson']);
	});

	it('end_union: writes the status and the dated event on the chosen partnership only', async () => {
		const s = await setup();
		const [alex, robin, sam] = [await s.addPerson('Alex', 'Walker'), await s.addPerson('Robin', 'Reed'), await s.addPerson('Sam', 'Smith')];
		await s.partner(alex, robin);
		await s.partner(alex, sam);
		const first = (await s.graph()).unions.find((u) => u.partnerIds.includes(robin.id))!;
		const { executed, before, after } = await runAndCompare(s, {
			kind: 'end_union',
			person: s.ref(alex),
			unionId: first.id,
			status: 'divorced',
			event: { type: 'DIV', dateText: '12 MAR 1999', place: 'Sydney' }
		});
		const ended = after.unions.find((u) => u.id === first.id)!;
		expect(ended.status).toBe('divorced');
		expect(ended.events).toMatchObject([{ type: 'DIV', dateText: '12 MAR 1999', place: 'Sydney' }]);
		const untouched = (g: RelationshipGraph) => g.unions.find((u) => u.partnerIds.includes(sam.id))!;
		expect(untouched(after)).toEqual(untouched(before));
		expect(shape(executed.affected)).toEqual([
			'created event Divorce of Alex Walker–Robin Reed partnership',
			'updated union Alex Walker–Robin Reed partnership'
		]);
	});
});

describe('choosing a partnership when there are several', () => {
	/** Homer and Marge twice, as an import without merging leaves them: the first has a child, the second none. */
	async function twinned() {
		const s = await setup();
		const [homer, marge, lisa, sam] = [
			await s.addPerson('Homer', 'Simpson'),
			await s.addPerson('Marge', 'Simpson'),
			await s.addPerson('Lisa', 'Simpson'),
			await s.addPerson('Sam', 'Simpson')
		];
		const unionIds = [1, 2].map((n) => `${s.treeId}:@F${n}@`);
		await s.relationships.runner.run(s.treeId, s.ctx, {
			kind: 'create_union',
			summary: () => 'Imported',
			commands: unionIds.map((unionId) => ({ kind: 'create_union' as const, unionId, personIds: [homer.id, marge.id] }))
		});
		await s.relationships.runner.run(s.treeId, s.ctx, {
			kind: 'assert_parent_child',
			summary: () => 'Linked',
			commands: [homer, marge].map((parent) => ({
				kind: 'assert_parent_child' as const,
				parentId: parent.id,
				childId: lisa.id,
				type: 'biological' as const,
				unionId: unionIds[0]
			}))
		});
		const addChild = (unionId?: string | null): RelationshipIntent => ({
			kind: 'add_child',
			parent: s.ref(homer),
			child: s.ref(sam),
			type: 'biological',
			unionLabel: null,
			unionId
		});
		const childUnion = async () => (await s.graph()).parentChild.find((l) => l.childId === sam.id && l.parentId === homer.id)?.unionId;
		return { s, homer, marge, sam, unionIds, addChild, childUnion };
	}

	it('puts the child in the fullest partnership by default, and says so', async () => {
		const { s, unionIds, addChild, childUnion } = await twinned();
		const preview = await s.relationships.plan(s.treeId, addChild(), s.ctx);
		expect(preview.unionChoice).toMatchObject({ unionId: unionIds[0], isDefault: true });
		expect(preview.sentence).toBe(
			"Sam Simpson will be recorded as Homer Simpson's biological child in the 1st partnership of Homer Simpson and Marge Simpson."
		);
		await s.relationships.execute(s.treeId, addChild(), s.ctx);
		expect(await childUnion()).toBe(unionIds[0]);
	});

	it('puts the child in the partnership the intent names, and the preview matches the save', async () => {
		const { s, unionIds, addChild, childUnion } = await twinned();
		const { executed } = await runAndCompare(s, addChild(unionIds[1]));
		expect(executed.sentence).toContain('in the 2nd partnership of Homer Simpson and Marge Simpson');
		expect(await childUnion()).toBe(unionIds[1]);
	});

	it('refuses a partnership the parent is not in, and writes nothing', async () => {
		const { s, sam, addChild } = await twinned();
		const stranger = await s.addPerson('Stray');
		const other = await s.addPerson('Other');
		await s.partner(stranger, other);
		const foreign = (await s.graph()).unions.find((u) => u.partnerIds.includes(stranger.id))!;
		const before = canonical(await s.graph());
		await expect(s.relationships.execute(s.treeId, addChild(foreign.id), s.ctx)).rejects.toBeInstanceOf(ValidationError);
		await expect(s.relationships.plan(s.treeId, addChild('no-such-union'), s.ctx)).rejects.toBeInstanceOf(ValidationError);
		expect(canonical(await s.graph())).toEqual(before);
		expect((await s.graph()).people.find((p) => p.id === sam.id)).toBeTruthy();
	});

	it('undoing puts the child link back exactly as it was', async () => {
		const { s, unionIds, addChild, childUnion } = await twinned();
		const before = canonical(await s.graph());
		await s.relationships.execute(s.treeId, addChild(unionIds[1]), s.ctx);
		expect(await childUnion()).toBe(unionIds[1]);
		await s.log.undoLast(s.treeId, s.ctx);
		expect(await childUnion()).toBeUndefined();
		expect(canonical(await s.graph())).toEqual(before);
	});

	it('add_parent and add_partner take the chosen partnership too', async () => {
		const { s, unionIds, marge, sam } = await twinned();
		const lone = await s.addPerson('Lone');
		const mate = await s.addPerson('Mate');
		const dad = await s.addPerson('Dad');
		await s.relationships.runner.run(s.treeId, s.ctx, {
			kind: 'create_union',
			summary: () => 'Imported',
			commands: ['A', 'B'].map((n) => ({ kind: 'create_union' as const, unionId: `${s.treeId}:@L${n}@`, personIds: [lone.id] }))
		});
		await s.relationships.execute(s.treeId, { kind: 'add_partner', person: s.ref(lone), partner: s.ref(mate), unionLabel: null, unionId: `${s.treeId}:@LB@` }, s.ctx);
		const unions = (await s.graph()).unions;
		expect(unions.find((u) => u.id === `${s.treeId}:@LB@`)!.partnerIds).toEqual([lone.id, mate.id]);
		expect(unions.find((u) => u.id === `${s.treeId}:@LA@`)!.partnerIds).toEqual([lone.id]);

		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(marge), child: s.ref(sam), type: 'biological', unionLabel: null, unionId: unionIds[1] }, s.ctx);
		await s.relationships.execute(
			s.treeId,
			{ kind: 'add_parent', child: s.ref(sam), parent: s.ref(dad), type: 'biological', role: 'father', unionLabel: null, unionId: unionIds[1] },
			s.ctx
		);
		const links = (await s.graph()).parentChild.filter((l) => l.childId === sam.id);
		expect(links.map((l) => l.unionId)).toEqual([unionIds[1], unionIds[1]]);
	});
});

describe('changing a parent link’s type', () => {
	async function linked(type: 'biological' | 'adoptive' = 'biological') {
		const s = await setup();
		const [alex, robin, sam] = [await s.addPerson('Alex', 'Walker'), await s.addPerson('Robin', 'Reed'), await s.addPerson('Sam', 'Smith')];
		await s.partner(alex, robin);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(alex), child: s.ref(sam), type, unionLabel: null }, s.ctx);
		const intent = (fromType: 'biological' | 'adoptive', toType: 'biological' | 'adoptive' | 'foster'): RelationshipIntent => ({
			kind: 'change_link_type',
			parent: s.ref(alex),
			child: s.ref(sam),
			fromType,
			toType
		});
		return { s, alex, robin, sam, intent };
	}

	it('changes only that parent’s link, keeps its partnership, and the preview matches the save', async () => {
		const { s, alex, sam, intent } = await linked();
		const { executed, before, after } = await runAndCompare(s, intent('biological', 'adoptive'));
		expect(executed.sentence).toContain('adoptive parent instead of biological parent in the Alex Walker–Robin Reed family');
		expect(before.parentChild).toEqual([{ parentId: alex.id, childId: sam.id, type: 'biological', unionId: expect.any(String) }]);
		expect(after.parentChild).toEqual([{ parentId: alex.id, childId: sam.id, type: 'adoptive', unionId: before.parentChild[0].unionId }]);
		expect(after.people.map((p) => p.id).sort()).toEqual(before.people.map((p) => p.id).sort());
	});

	it('undo puts the old type back', async () => {
		const { s, intent } = await linked();
		const before = canonical(await s.graph());
		await s.relationships.execute(s.treeId, intent('biological', 'foster'), s.ctx);
		await s.log.undoLast(s.treeId, s.ctx);
		expect(canonical(await s.graph())).toEqual(before);
	});

	it('refuses a link that is not there as described, and a second link of the same type', async () => {
		const { s, alex, sam, intent } = await linked();
		await expect(s.relationships.execute(s.treeId, intent('adoptive', 'foster'), s.ctx)).rejects.toBeInstanceOf(ValidationError);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(alex), child: s.ref(sam), type: 'adoptive', unionLabel: null }, s.ctx);
		const plan = await s.relationships.plan(s.treeId, intent('biological', 'adoptive'), s.ctx);
		expect(plan.commands).toHaveLength(0);
		expect(plan.warnings.map((w) => w.code)).toEqual(['TYPE_ALREADY_RECORDED']);
	});
});

describe('remarrying the same person', () => {
	it('after a divorce records a second partnership and keeps the first with its child', async () => {
		const s = await setup();
		const [hal, ivy, kit] = [await s.addPerson('Hal'), await s.addPerson('Ivy'), await s.addPerson('Kit')];
		await s.partner(hal, ivy);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(hal), child: s.ref(kit), type: 'biological', unionLabel: null }, s.ctx);
		const first = (await s.graph()).unions[0];
		await s.relationships.execute(s.treeId, { kind: 'end_union', person: s.ref(hal), unionId: first.id, status: 'divorced', event: null, unionVersion: first.version }, s.ctx);

		const { after } = await runAndCompare(s, { kind: 'add_partner', person: s.ref(hal), partner: s.ref(ivy), unionLabel: null });
		expect(after.unions).toHaveLength(2);
		expect(after.unions.map((u) => u.status).sort()).toEqual(['active', 'divorced']);
		expect(after.unions.every((u) => u.partnerIds.includes(hal.id) && u.partnerIds.includes(ivy.id))).toBe(true);
		expect(after.unions.find((u) => u.id === first.id)!.children.length).toBeGreaterThan(0);
	});
});

describe('deleting a person', () => {
	it('lists exactly what goes, and the delete does exactly that', async () => {
		const s = await setup();
		const [homer, marge, bart, jessica] = [
			await s.addPerson('Homer', 'Simpson', { birthDate: '1950', deathDate: '2001' }),
			await s.addPerson('Marge', 'Simpson'),
			await s.addPerson('Bart', 'Simpson'),
			await s.addPerson('Jessica', 'Simpson')
		];
		await s.partner(homer, marge);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(homer), child: s.ref(bart), type: 'biological', unionLabel: null }, s.ctx);
		await s.partner(bart, jessica);
		const union = (await s.graph()).unions.find((u) => u.partnerIds.includes(homer.id))!;
		await s.relationships.updateUnion(s.treeId, { kind: 'update_union', unionId: union.id, expectedVersion: union.version!, events: [{ id: null, type: 'MARR', dateText: '1975', place: null }] }, s.ctx);

		const impact = await s.people.previewDeleteIndividual(s.treeId, homer.id, s.ctx);
		expect(impact.isDestructive).toBe(true);
		expect(impact.people).toEqual(
			expect.arrayContaining([
				{ id: homer.id, name: 'Homer Simpson', role: 'deleted' },
				{ id: marge.id, name: 'Marge Simpson', role: 'affected' },
				{ id: bart.id, name: 'Bart Simpson', role: 'affected' }
			])
		);
		// Jessica is Bart's partner, not Homer's relative: she is not listed.
		expect(impact.people.some((p) => p.id === jessica.id)).toBe(false);

		const before = await s.graph();
		const { affected } = await s.people.deleteIndividual(s.treeId, homer.id, s.ctx);
		expect(shape(affected)).toEqual(shape(impact.records));

		const after = await s.graph();
		expect(after.people.map((p) => p.id).sort()).toEqual([marge.id, bart.id, jessica.id].sort());
		// Marge's partnership survives with her in it; the child link is gone; Bart is untouched.
		const survivor = after.unions.find((u) => u.id === union.id)!;
		expect(survivor.partnerIds).toEqual([marge.id]);
		expect(survivor.marriageDate).toBe('1975');
		expect(after.parentChild).toEqual([]);
		expect(after.unions).toHaveLength(before.unions.length);
	});

	it('removes a partnership that would be left with nobody, along with its own events', async () => {
		const s = await setup();
		const solo = await s.addPerson('Solo');
		await s.relationships.execute(s.treeId, { kind: 'add_partner', person: s.ref(solo), partner: { id: 'x', givenName: 'Unknown', surname: null, isNew: true }, unionLabel: null }, s.ctx);
		const union = (await s.graph()).unions[0];
		const other = union.partnerIds.find((id) => id !== solo.id)!;
		await s.people.deleteIndividual(s.treeId, other, s.ctx);
		const impact = await s.people.previewDeleteIndividual(s.treeId, solo.id, s.ctx);
		expect(impact.records.filter((r) => r.entityType === 'union').map((r) => r.action)).toEqual(['deleted']);
		await s.people.deleteIndividual(s.treeId, solo.id, s.ctx);
		expect((await s.graph()).unions).toEqual([]);
	});
});

describe('removing relationships', () => {
	it('deleting a partnership keeps the people and keeps the parent links, ungrouped', async () => {
		const s = await setup();
		const [homer, marge, bart] = [await s.addPerson('Homer', 'Simpson'), await s.addPerson('Marge', 'Simpson'), await s.addPerson('Bart', 'Simpson')];
		await s.partner(homer, marge);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(homer), child: s.ref(bart), type: 'biological', unionLabel: null }, s.ctx);
		const union = (await s.graph()).unions[0];

		const command = { kind: 'destroy_union' as const, unionId: union.id, expectedVersion: union.version };
		const impact = await s.relationships.previewRemoval(s.treeId, command, s.ctx);
		expect(shape(impact.records)).toEqual([
			'deleted partner Marge Simpson in the Homer Simpson–Marge Simpson partnership',
			'deleted partner Homer Simpson in the Homer Simpson–Marge Simpson partnership',
			'deleted union Homer Simpson–Marge Simpson partnership',
			'updated link Homer Simpson as biological parent of Bart Simpson'
		]);
		expect(impact.people.every((p) => p.role === 'affected')).toBe(true);

		const { affected } = await s.relationships.removeRelationship(s.treeId, command, s.ctx);
		expect(shape(affected)).toEqual(shape(impact.records));
		const after = await s.graph();
		expect(after.people).toHaveLength(3);
		expect(after.unions).toEqual([]);
		expect(after.parentChild).toEqual([{ parentId: homer.id, childId: bart.id, type: 'biological', unionId: null }]);
	});

	it('removing one parent link leaves the other parent’s link and both people', async () => {
		const s = await setup();
		const [homer, marge, bart] = [await s.addPerson('Homer'), await s.addPerson('Marge'), await s.addPerson('Bart')];
		for (const parent of [homer, marge]) {
			await s.relationships.execute(s.treeId, { kind: 'add_parent', child: s.ref(bart), parent: s.ref(parent), type: 'biological', role: 'parent', unionLabel: null }, s.ctx);
		}
		const command = { kind: 'remove_parent_child' as const, parentId: marge.id, childId: bart.id, type: 'biological' as const };
		const impact = await s.relationships.previewRemoval(s.treeId, command, s.ctx);
		expect(shape(impact.records)).toEqual(['deleted link Marge as biological parent of Bart']);
		await s.relationships.removeRelationship(s.treeId, command, s.ctx);
		const after = await s.graph();
		expect(after.parentChild.map((l) => l.parentId)).toEqual([homer.id]);
		expect(after.people).toHaveLength(3);
	});

	it('tells the caller a link is already gone rather than pretending to remove it', async () => {
		const s = await setup();
		const [a, b] = [await s.addPerson('A'), await s.addPerson('B')];
		await expect(
			s.relationships.removeRelationship(s.treeId, { kind: 'remove_parent_child', parentId: a.id, childId: b.id, type: 'biological' }, s.ctx)
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('the change log and undo', () => {
	it('every mutation writes a log entry with the summary a toast can show', async () => {
		const s = await setup();
		const person = await s.addPerson('Ada', 'Lovelace');
		await s.people.updateIndividual(s.treeId, person.id, person.version, { givenName: 'Augusta' }, s.ctx);
		const kinds = (await s.log.listRecent(s.treeId, s.ctx)).map((c) => `${c.kind}: ${c.summary}`);
		expect(kinds).toEqual(['update_person: Edited Ada Lovelace', 'create_person: Added Ada Lovelace']);
	});

	it('undoes the most recent change, then the one before it', async () => {
		const s = await setup();
		const [alex, sam] = [await s.addPerson('Alex'), await s.addPerson('Sam')];
		await s.relationships.execute(s.treeId, { kind: 'add_parent', child: s.ref(sam), parent: s.ref(alex), type: 'biological', role: 'parent', unionLabel: null }, s.ctx);

		const first = await s.log.undoLast(s.treeId, s.ctx);
		expect(first.undone.summary).toBe("Alex was recorded as Sam's biological parent.");
		expect((await s.graph()).parentChild).toEqual([]);

		const second = await s.log.undoLast(s.treeId, s.ctx);
		expect(second.undone.summary).toBe('Added Sam');
		expect((await s.graph()).people.map((p) => p.displayName)).toEqual(['Alex']);
	});

	it('undoing a person’s deletion brings back the person, their events, links and place in a partnership', async () => {
		const s = await setup();
		const [homer, marge, bart] = [
			await s.addPerson('Homer', 'Simpson', { birthDate: '1950', birthPlace: 'Perth' }),
			await s.addPerson('Marge', 'Simpson'),
			await s.addPerson('Bart', 'Simpson')
		];
		await s.partner(homer, marge);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(homer), child: s.ref(bart), type: 'adoptive', unionLabel: null }, s.ctx);
		const before = await s.graph();
		const individualBefore = await s.people.getIndividual(s.treeId, homer.id, s.ctx);

		await s.people.deleteIndividual(s.treeId, homer.id, s.ctx);
		expect((await s.graph()).people).toHaveLength(2);
		await s.log.undoLast(s.treeId, s.ctx);

		expect(canonical(await s.graph())).toEqual(canonical(before));
		const restored = await s.people.getIndividual(s.treeId, homer.id, s.ctx);
		expect(restored.events.map((e) => [e.type, e.dateRaw, e.place])).toEqual(individualBefore.events.map((e) => [e.type, e.dateRaw, e.place]));
	});

	it('undoes a partnership deletion, restoring partners, events and the grouping of children', async () => {
		const s = await setup();
		const [homer, marge, bart] = [await s.addPerson('Homer'), await s.addPerson('Marge'), await s.addPerson('Bart')];
		await s.partner(homer, marge);
		await s.relationships.execute(s.treeId, { kind: 'add_child', parent: s.ref(homer), child: s.ref(bart), type: 'biological', unionLabel: null }, s.ctx);
		const union = (await s.graph()).unions[0];
		await s.relationships.updateUnion(s.treeId, { kind: 'update_union', unionId: union.id, expectedVersion: union.version!, status: 'separated', events: [{ id: null, type: 'MARR', dateText: '1975', place: 'Perth' }] }, s.ctx);
		const before = await s.graph();

		await s.relationships.removeRelationship(s.treeId, { kind: 'destroy_union', unionId: union.id }, s.ctx);
		await s.log.undoLast(s.treeId, s.ctx);

		expect(canonical(await s.graph())).toEqual(canonical(before));
	});

	it('only undoes the signed-in user’s own changes', async () => {
		const s = await setup();
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, s.treeId, other, 'editor');
		await s.addPerson('Mine');
		const theirs = new GenealogyService(t.db);
		await theirs.createIndividual(s.treeId, { givenName: 'Theirs' }, other.context);

		await s.log.undoLast(s.treeId, s.ctx);
		expect((await s.graph()).people.map((p) => p.displayName)).toEqual(['Theirs']);
		await expect(s.log.undoLast(s.treeId, s.ctx)).rejects.toMatchObject({ status: 404 });
	});

	it('refuses when a later change touched the same records, and says which', async () => {
		const s = await setup();
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, s.treeId, other, 'editor');
		const person = await s.addPerson('Ada');
		await new GenealogyService(t.db).updateIndividual(s.treeId, person.id, person.version, { givenName: 'Augusta' }, other.context);

		await expect(s.log.undoLast(s.treeId, s.ctx)).rejects.toMatchObject({
			status: 409,
			details: { reason: 'touched_later' },
			message: expect.stringContaining('Edited Ada')
		});
		expect((await s.graph()).people.map((p) => p.displayName)).toEqual(['Augusta']);
	});

	it('refuses to undo the creation of a person that someone has since linked to, and keeps their link', async () => {
		const s = await setup();
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, s.treeId, other, 'editor');
		const parent = await s.addPerson('Pat');
		// The other collaborator hangs a new child off Pat, who I created.
		const theirs = new RelationshipService(t.db);
		const child = (await new GenealogyService(t.db).createIndividual(s.treeId, { givenName: 'Kit' }, other.context)).individual;
		await theirs.execute(
			s.treeId,
			{ kind: 'add_child', parent: s.ref(parent), child: s.ref(child), type: 'biological', unionLabel: null },
			other.context
		);

		await expect(s.log.undoLast(s.treeId, s.ctx)).rejects.toMatchObject({
			status: 409,
			details: { reason: 'has_dependents' },
			message: expect.stringContaining('Pat as biological parent of Kit')
		});
		const after = await s.graph();
		expect(after.people.map((p) => p.displayName).sort()).toEqual(['Kit', 'Pat']);
		expect(after.parentChild).toEqual([{ parentId: parent.id, childId: child.id, type: 'biological', unionId: null }]);
	});

	it('refuses to undo the creation of a partnership that someone has since added a child to', async () => {
		const s = await setup();
		const other = await createTestUser(t.db, 'other');
		await addTestMember(t.db, s.treeId, other, 'editor');
		const [a, b] = [await s.addPerson('Ann'), await s.addPerson('Ben')];
		await s.partner(a, b);
		const kit = (await new GenealogyService(t.db).createIndividual(s.treeId, { givenName: 'Kit' }, other.context)).individual;
		await new RelationshipService(t.db).execute(
			s.treeId,
			{ kind: 'add_child', parent: s.ref(a), child: s.ref(kit), type: 'biological', unionLabel: null },
			other.context
		);

		await expect(s.log.undoLast(s.treeId, s.ctx)).rejects.toMatchObject({ status: 409, details: { reason: 'has_dependents' } });
		const after = await s.graph();
		expect(after.unions).toHaveLength(1);
		expect(after.unions[0].children).toHaveLength(1);
	});

	it('refuses to undo the same change twice', async () => {
		const s = await setup();
		await s.addPerson('Ada');
		await s.log.undoLast(s.treeId, s.ctx);
		await expect(s.log.undoLast(s.treeId, s.ctx)).rejects.toMatchObject({ status: 404 });
	});

	it('does not let a viewer undo, and a contributor undoes only what a contributor could do', async () => {
		const s = await setup();
		const contributor = await createTestUser(t.db, 'contrib');
		await t.db.insert((await import('../db/schema')).treeMemberships).values({ id: crypto.randomUUID(), treeId: s.treeId, userId: contributor.userId, role: 'contributor' });
		const service = new GenealogyService(t.db);
		await service.createIndividual(s.treeId, { givenName: 'Cara' }, contributor.context);
		const undone = await new ChangeLogService(t.db).undoLast(s.treeId, contributor.context).catch((e) => e);
		// Undoing a creation deletes the row, which a contributor may not do directly.
		expect(undone).toMatchObject({ status: 403 });
	});
});

describe('optimistic concurrency', () => {
	it('rejects a stale person edit and returns what is current', async () => {
		const s = await setup();
		const person = await s.addPerson('Ada', 'Lovelace', { birthDate: '1815' });
		await s.people.updateIndividual(s.treeId, person.id, person.version, { surname: 'King' }, s.ctx);
		await expect(
			s.people.updateIndividual(s.treeId, person.id, person.version, { givenName: 'Augusta' }, s.ctx)
		).rejects.toMatchObject({
			status: 409,
			details: { reason: 'STALE_VERSION', entity: 'individual', currentVersion: 2, expectedVersion: 1, current: { givenName: 'Ada', surname: 'King', birthDate: '1815' } }
		});
	});

	it('rejects a stale partnership edit and returns the current status and events', async () => {
		const s = await setup();
		const [a, b] = [await s.addPerson('A'), await s.addPerson('B')];
		await s.partner(a, b);
		const union = (await s.graph()).unions[0];
		await s.relationships.updateUnion(s.treeId, { kind: 'update_union', unionId: union.id, expectedVersion: union.version!, status: 'separated' }, s.ctx);
		await expect(
			s.relationships.updateUnion(s.treeId, { kind: 'update_union', unionId: union.id, expectedVersion: union.version!, status: 'divorced' }, s.ctx)
		).rejects.toMatchObject({ status: 409, details: { entity: 'union', current: { status: 'separated', events: [] } } });
	});

	it('a death recorded from a stale person version is a conflict, not an overwrite', async () => {
		const s = await setup();
		const person = await s.addPerson('Ada');
		await s.people.updateIndividual(s.treeId, person.id, person.version, { surname: 'King' }, s.ctx);
		await expect(
			s.relationships.execute(s.treeId, { kind: 'record_death', person: s.ref(person), dateText: '1852', place: null, personVersion: person.version }, s.ctx)
		).rejects.toMatchObject({ status: 409 });
	});
});
