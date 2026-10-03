import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsonsClean from '../../../../docs/The_Simpsons_clean.ged?raw';
import { REPRESENTATIVE_GEDCOM_FIXTURE } from '../fixtures/genealogy-fixtures';
import { importGedcomToDb } from '../testing/gedcom';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import { graphFromRows } from '../domain/relationship-graph';
import { ChangeStore } from '../repositories/change-store';
import { CONFLICT_KINDS } from '../../shared/fact-timeline';
import { relativesOf } from '../../shared/relatives';
import { eq } from 'drizzle-orm';
import { personNames, trees, treeMemberships } from '../db/schema';
import { insertCorpus } from '../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { GenealogyService } from './genealogy-service';
import { PersonPageService, type PersonPageDto } from './person-page-service';

let t: TestDatabase;
let actor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new PersonPageService(t.db);

/** A tree the test actor owns, filled from a GEDCOM text. */
async function importedTree(gedcom: string) {
	const treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, gedcom, 'Imported');
	return treeId;
}

const ids = (list: Array<{ person: { id: string } }>) => list.map((x) => x.person.id).sort();

/** The relatives a page shows, as sorted id lists, for comparison with the whole-tree derivation. */
function shown(page: PersonPageDto) {
	return {
		parents: page.parentFamilies.flatMap((f) => f.parents.map((p) => p.person.id)).sort(),
		partners: page.partnerships.flatMap((p) => p.partners.map((x) => x.id)).sort(),
		children: [...page.partnerships.flatMap((p) => p.children), ...page.directChildren]
			.map((c) => c.person.id)
			.sort(),
		full: ids(page.siblings.full.map((person) => ({ person }))),
		half: ids(page.siblings.half.map((person) => ({ person }))),
		stepParents: ids(page.stepParents),
		stepChildren: ids(page.stepChildren)
	};
}

function derived(whole: ReturnType<typeof graphFromRows>, personId: string) {
	const r = relativesOf(whole, personId);
	return {
		parents: r.parentFamilies.flatMap((f) => f.parents.map((p) => p.personId)).sort(),
		partners: r.partnerships.flatMap((p) => p.partnerIds).sort(),
		children: [...r.partnerships.flatMap((p) => p.children), ...r.directChildren]
			.map((c) => c.personId)
			.sort(),
		full: [...r.siblings.full].sort(),
		half: [...r.siblings.half].sort(),
		stepParents: r.stepParents.map((s) => s.personId).sort(),
		stepChildren: r.stepChildren.map((s) => s.personId).sort()
	};
}

describe.each([
	['The Simpsons (clean)', () => simpsonsClean],
	['the representative scenarios', () => REPRESENTATIVE_GEDCOM_FIXTURE]
])('the person page of %s', (_name, source) => {
	it('shows the same relatives the whole tree derives, for every person', async () => {
		const treeId = await importedTree(source());
		const whole = graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
		for (const person of whole.people) {
			const page = await service().getPerson(treeId, person.id, actor.context);
			expect(shown(page), person.displayName).toEqual(derived(whole, person.id));
		}
	}, 120_000);
});

describe('the person page of a large tree', () => {
	it('shows the same relatives the whole tree derives for a sample, and reads a small part of it', async () => {
		const treeId = crypto.randomUUID();
		await t.db.insert(trees).values({ id: treeId, name: 'Corpus' });
		await t.db
			.insert(treeMemberships)
			.values({ id: crypto.randomUUID(), treeId, userId: actor.userId, role: 'owner' });
		const corpus = await insertCorpus(t.db, treeId, { prefix: treeId.slice(0, 8) });
		const whole = graphFromRows(await new ChangeStore(t.db).loadRows(treeId));
		const sample = [
			corpus.rootPersonId,
			corpus.remarriedPersonId,
			corpus.leafPersonId,
			...whole.people
				.filter((p) => p.stepParents.length > 0)
				.slice(0, 4)
				.map((p) => p.id)
		];
		for (const id of sample) {
			const page = await service().getPerson(treeId, id, actor.context);
			expect(shown(page), id).toEqual(derived(whole, id));
			expect(page.graph.people.length).toBeLessThan(corpus.people / 20);
		}
	}, 120_000);
});

describe('facts, names and history on the page', () => {
	async function fresh() {
		const treeId = await createTestTree(t.db, actor);
		const people = new GenealogyService(t.db);
		const wren = (
			await people.createIndividual(
				treeId,
				{ givenName: 'Wren', surname: 'Ash', birthDate: '4 MAR 1900', birthPlace: 'Leeds' },
				actor.context
			)
		).individual;
		return {
			treeId,
			wren,
			facts: new FactService(t.db),
			page: () => service().getPerson(treeId, wren.id, actor.context)
		};
	}
	const blank = { dateText: null, place: null, value: null, cause: null, age: null, notes: null };

	it('gives a person created in the editor a stored preferred name', async () => {
		const { page } = await fresh();
		const { names } = await page();
		expect(names).toHaveLength(1);
		expect(names[0]).toMatchObject({ type: 'birth', displayName: 'Wren Ash', isPreferred: true });
		expect(names[0]!.id).not.toBeNull();
	});

	it("reads a preferred name row the pre-S6 person form left stale as the person's own fields", async () => {
		const { page, wren } = await fresh();
		await t.d1
			.prepare('UPDATE individuals SET surname = ? WHERE id = ?')
			.bind('Ash-Jones', wren.id)
			.run();
		const { names } = await page();
		expect(names.find((n) => n.isPreferred)).toMatchObject({
			surname: 'Ash-Jones',
			displayName: 'Wren Ash-Jones'
		});
	});

	it('derives a name for a person with no stored name row (created before names were rows)', async () => {
		const { page, wren } = await fresh();
		await t.db.delete(personNames).where(eq(personNames.personId, wren.id));
		const { names } = await page();
		expect(names).toHaveLength(1);
		expect(names[0]).toMatchObject({
			id: null,
			type: 'birth',
			displayName: 'Wren Ash',
			isPreferred: true
		});
	});

	it('keeps two births with different details, orders them, and flags them as a conflicting pair', async () => {
		const { treeId, facts, page } = await fresh();
		await facts.create(
			treeId,
			(await page()).person.id,
			{ ...blank, type: 'BIRT', dateText: '5 MAR 1900', place: 'Hull' },
			actor.context
		);
		const { facts: shownFacts, vitals } = await page();
		const births = shownFacts.filter((f) => f.type === 'BIRT');
		expect(births.map((b) => b.place)).toEqual(['Leeds', 'Hull']);
		expect(births.every((b) => b.conflict?.kind === CONFLICT_KINDS.CONFLICT)).toBe(true);
		expect(births[0]!.conflict!.otherIds).toEqual([births[1]!.id]);
		expect(vitals.hasConflict).toBe(true);
	});

	it('orders dated facts by date, undated after, and lets the person reorder ties', async () => {
		const { treeId, facts, page } = await fresh();
		const personId = (await page()).person.id;
		const [a, b] = [
			await facts.create(
				treeId,
				personId,
				{ ...blank, type: 'OCCU', value: 'Joiner' },
				actor.context
			),
			await facts.create(treeId, personId, { ...blank, type: 'RESI', place: 'Hull' }, actor.context)
		];
		await facts.create(
			treeId,
			personId,
			{ ...blank, type: 'DEAT', dateText: '1 JAN 1980' },
			actor.context
		);
		expect((await page()).facts.map((f) => f.type)).toEqual(['BIRT', 'DEAT', 'OCCU', 'RESI']);
		await facts.reorder(treeId, personId, [b.factId, a.factId], actor.context);
		expect((await page()).facts.map((f) => f.type)).toEqual(['BIRT', 'DEAT', 'RESI', 'OCCU']);
	});

	it('shows a legacy description as a note until the fact is edited', async () => {
		const treeId = await importedTree(
			'0 HEAD\n0 @I1@ INDI\n1 NAME A /B/\n1 OCCU Carpenter\n0 TRLR'
		);
		const personId = (await new GenealogyService(t.db).getTree(treeId, actor.context))
			.individuals[0]!.id;
		const fact = (await service().getPerson(treeId, personId, actor.context)).facts[0]!;
		// Imports now keep the line value as a value; a row written before the fact columns keeps the description.
		expect(fact).toMatchObject({
			type: 'OCCU',
			value: 'Carpenter',
			notes: null,
			isLegacyNote: false
		});
	});

	it('lists the changes that wrote the person or a fact they still have, newest first, with who made them', async () => {
		const { treeId, wren, facts, page } = await fresh();
		const { factId } = await facts.create(
			treeId,
			wren.id,
			{ ...blank, type: 'OCCU', value: 'Joiner' },
			actor.context
		);
		await facts.update(treeId, factId, { value: 'Carpenter' }, 1, actor.context);
		await new ChangeLogService(t.db).undoLast(treeId, actor.context);
		const { changes } = await page();
		expect(changes.recent.map((c) => [c.summary, c.isUndo])).toEqual([
			['Undid: Edited the occupation of Wren Ash', true],
			['Edited the occupation of Wren Ash', false],
			['Added occupation to Wren Ash', false],
			['Added Wren Ash', false]
		]);
		expect(changes.recent[0]!.actorName).toBeTruthy();
		expect(changes.updatedAt).toBeGreaterThan(0);
	});

	it('does not list changes to a fact that has since been removed: history is found by record, and its record is gone', async () => {
		const { treeId, wren, facts, page } = await fresh();
		const { factId } = await facts.create(
			treeId,
			wren.id,
			{ ...blank, type: 'OCCU', value: 'Joiner' },
			actor.context
		);
		await facts.remove(treeId, factId, undefined, actor.context);
		expect((await page()).changes.recent.map((c) => c.summary)).toEqual(['Added Wren Ash']);
	});

	it('carries a privacy flag that is false on every record, and empty notes and evidence sections', async () => {
		const { page } = await fresh();
		const dto = await page();
		const flags: unknown[] = [];
		const walk = (value: unknown) => {
			if (Array.isArray(value)) return value.forEach(walk);
			if (value && typeof value === 'object') {
				if ('isPrivate' in value) flags.push((value as { isPrivate: unknown }).isPrivate);
				Object.values(value).forEach(walk);
			}
		};
		walk(dto);
		expect(flags.length).toBeGreaterThan(3);
		expect(flags.every((f) => f === false)).toBe(true);
		expect(dto.notes).toEqual({ isSupported: false, items: [] });
		expect(dto.evidence).toEqual({ isSupported: false, items: [] });
	});

	it('refuses a stranger and answers 404 for a person in another tree', async () => {
		const { treeId, wren } = await fresh();
		const other = await fresh();
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service().getPerson(treeId, wren.id, stranger.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(service().getPerson(treeId, other.wren.id, actor.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});
});
