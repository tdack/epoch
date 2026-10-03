import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importGedcomToDb } from '../testing/gedcom';
import { UnauthorizedError } from '../domain/errors';
import { ChangeStore } from '../repositories/change-store';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ListService } from './list-service';

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
let service: ListService;

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Jessica /Simpson/
1 NAME Jessica /Smith/
2 TYPE married
1 FAMS @F1@
0 @I2@ INDI
1 NAME Tom /Smith/
1 BIRT
2 DATE 1950
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ann /bower/
0 @I4@ INDI
1 NAME Bede /Brown/
1 NAME Bede /Brown/
2 TYPE aka
0 @I5@ INDI
1 NAME Cora
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1975
2 PLAC Launceston
1 DIV
2 DATE 1990
0 TRLR`;

const ctx = () => actor.context;
const ids = (page: { items: Array<{ id: string }> }) => page.items.map((p) => p.id.split(':')[1]);

beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
	treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Lists');
	await importGedcomToDb(t.d1, await createTestTree(t.db, actor), FIXTURE, 'Other');
	service = new ListService(t.db);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('individuals', () => {
	it('pages in surname order, case-insensitively, then given name, with unsurnamed people first', async () => {
		const all = await service.individuals(treeId, { limit: 50 }, ctx());
		// Cora has no surname; "brown" and "Brown" are one surname so Ann sorts before Bede; Jessica's display surname is Simpson.
		expect(ids(all)).toEqual(['@I5@', '@I3@', '@I4@', '@I2@', '@I1@']);
		const first = await service.individuals(treeId, { limit: 2 }, ctx());
		const second = await service.individuals(treeId, { limit: 2, offset: 2 }, ctx());
		const third = await service.individuals(treeId, { limit: 2, offset: 4 }, ctx());
		expect([ids(first), ids(second), ids(third)]).toEqual([
			['@I5@', '@I3@'],
			['@I4@', '@I2@'],
			['@I1@']
		]);
		expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
	});

	it('sorts by given name on request and carries life dates and the née display', async () => {
		const byGiven = await service.individuals(treeId, { sort: 'given' }, ctx());
		expect(ids(byGiven)).toEqual(['@I3@', '@I4@', '@I5@', '@I1@', '@I2@']);
		const tom = byGiven.items.find((p) => p.id.endsWith('@I2@'))!;
		expect(tom).toMatchObject({ displayName: 'Tom Smith', birthDate: '1950', isPrivate: false });
	});

	it('never includes another tree and never loads the whole tree', async () => {
		const loadRows = vi.spyOn(ChangeStore.prototype, 'loadRows');
		const page = await service.individuals(treeId, {}, ctx());
		await service.unions(treeId, {}, ctx());
		await service.surnames(treeId, {}, ctx());
		expect(page.items.every((p) => p.id.startsWith(treeId))).toBe(true);
		expect(loadRows).not.toHaveBeenCalled();
		loadRows.mockRestore();
	});

	it('refuses someone who is not a member', async () => {
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service.individuals(treeId, {}, stranger.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});
});

describe('surnames', () => {
	it('lists each surname once across every stored name, counting a person once', async () => {
		const page = await service.surnames(treeId, {}, ctx());
		// Smith: Tom, and Jessica through her married name. Brown: Ann and Bede (two casings; Bede has it twice).
		expect(page.items.map((s) => [s.surname.toLowerCase(), s.people])).toEqual([
			['brown', 2],
			['smith', 2],
			['simpson', 1]
		]);
	});

	it('each count equals the rows of the individuals list filtered to that surname', async () => {
		const page = await service.surnames(treeId, {}, ctx());
		for (const { surname, people } of page.items) {
			const filtered = await service.individuals(treeId, { surname }, ctx());
			expect(filtered.items, surname).toHaveLength(people);
		}
		// A surname only a stored name carries still finds the person, whatever case it is typed in.
		expect(ids(await service.individuals(treeId, { surname: 'KENNEDY' }, ctx())).sort()).toEqual([
			'@I1@',
			'@I2@'
		]);
	});

	it('pages', async () => {
		const first = await service.surnames(treeId, { limit: 2 }, ctx());
		const second = await service.surnames(treeId, { limit: 2, offset: 2 }, ctx());
		expect([first.items.length, first.hasMore, second.items.length, second.hasMore]).toEqual([
			2,
			true,
			1,
			false
		]);
	});
});

describe('partnerships', () => {
	it('lists partners in order with the marriage and the end', async () => {
		const page = await service.unions(treeId, {}, ctx());
		expect(page.items).toHaveLength(1);
		expect(page.items[0]).toMatchObject({
			partners: [
				expect.objectContaining({ displayName: 'Tom Smith' }),
				expect.objectContaining({ displayName: expect.stringContaining('Jessica') })
			],
			marriageDate: '1975',
			marriagePlace: 'Launceston',
			endDate: '1990',
			isPrivate: false
		});
	});
});
