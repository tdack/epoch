/**
 * What a contributor can do to, or learn about, a private person through the write paths
 * (ADR-015). A contributor may create records but may not name, link to or change anyone they
 * cannot see, and the answer for such a person must be the one a missing id gets.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../gedcom/importer';
import { addTestMember, createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { FactService } from './fact-service';
import { RelationshipService } from './relationship-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
1 FAMS @F1@
1 FAMS @F2@
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 BIRT
2 DATE 1985
2 PLAC Perthville, Australia
1 FAMS @F1@
0 @I4@ INDI
1 NAME Samuel /Passed/
1 DEAT
1 FAMS @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1990 SEPTEMBER
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I4@
1 MARR
2 DATE 1875
0 TRLR`;

const SECRETS = ['Livia', 'Aliveson', 'Perthville', 'SEPTEMBER'];
const NOW = new Date('2026-10-01T12:00:00Z');

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
let unionOf: (a: string, b: string) => Promise<string>;
const leaks = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value).includes(s));

const clock = () => ({ now: () => NOW.getTime(), newId: () => crypto.randomUUID() });
const relationships = () => new RelationshipService(t.db, clock());
const facts = () => new FactService(t.db, clock());

const addChild = (parentXref: string, unionId?: string | null) =>
	({
		kind: 'add_child' as const,
		parent: { id: idOf(parentXref), givenName: 'P', surname: null },
		child: { id: 'new-child', isNew: true, givenName: 'Newkid', surname: 'Oldman' },
		type: 'biological' as const,
		unionLabel: null,
		...(unionId === undefined ? {} : { unionId })
	});

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Writes');
	const rows = await t.db.select({ id: individuals.id, xref: individuals.xrefId }).from(individuals).where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
	unionOf = async (a, b) =>
		(await t.d1
			.prepare('select u.id id from unions u join union_partners x on x.union_id = u.id join union_partners y on y.union_id = u.id where x.person_id = ?1 and y.person_id = ?2')
			.bind(idOf(a), idOf(b))
			.first<{ id: string }>())!.id;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('a contributor', () => {
	const ctx = () => actors.contributor.context;

	it('cannot name a private person, and is answered as if they did not exist', async () => {
		const hidden = await relationships().plan(treeId, addChild('@I2@'), ctx()).catch((e) => e);
		const missing = await relationships()
			.plan(treeId, { ...addChild('@I2@'), parent: { id: 'no-such-person', givenName: 'P', surname: null } }, ctx())
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(Error);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(idOf('@I2@'), 'ID')).toBe(missing.message.replace('no-such-person', 'ID'));
	});

	it('cannot add to a partnership that has a private partner, and is answered as if it did not exist', async () => {
		const unionId = await unionOf('@I1@', '@I2@');
		const hidden = await relationships().execute(treeId, addChild('@I1@', unionId), ctx()).catch((e) => e);
		const missing = await relationships().execute(treeId, addChild('@I1@', 'no-such-union'), ctx()).catch((e) => e);
		expect(hidden).toBeInstanceOf(Error);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(unionId, 'ID')).toBe(missing.message.replace('no-such-union', 'ID'));
		expect(leaks(hidden.message)).toEqual([]);
	});

	it('plans and writes a change among people it can see, with nothing private in the answer', async () => {
		const unionId = await unionOf('@I1@', '@I4@');
		const plan = await relationships().plan(treeId, addChild('@I1@', unionId), ctx());
		expect(leaks(plan)).toEqual([]);
		const done = await relationships().execute(treeId, addChild('@I1@', unionId), ctx());
		expect(leaks(done)).toEqual([]);
		expect(done.change).not.toBeNull();
	});

	it('cannot add a fact to a private person, and is answered as for a missing one', async () => {
		const blank = { type: 'OCCU', dateText: null, place: null, value: 'x', cause: null, age: null, notes: null } as never;
		const hidden = await facts().create(treeId, idOf('@I2@'), blank, ctx()).catch((e) => e);
		const missing = await facts().create(treeId, 'no-such-person', blank, ctx()).catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.constructor).toBe(missing.constructor);
		expect(hidden.message.replace(idOf('@I2@'), 'ID')).toBe(missing.message.replace('no-such-person', 'ID'));
	});

	it('does not get a duplicate warning from a private person\'s name', async () => {
		const intent = { ...addChild('@I4@'), child: { id: 'n', isNew: true, givenName: 'Livia', surname: null } };
		const asOwner = await relationships().plan(treeId, intent, actors.owner.context);
		const asContributor = await relationships().plan(treeId, intent, ctx());
		expect(asOwner.warnings.map((w) => w.code)).toContain('DUPLICATE_PERSON');
		expect(asContributor.warnings.map((w) => w.code)).not.toContain('DUPLICATE_PERSON');
	});

	it('cannot read the tree-wide change log', async () => {
		const log = new ChangeLogService(t.db, clock());
		await expect(log.listRecent(treeId, ctx())).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(log.listRecent(treeId, actors.editor.context)).resolves.toBeTruthy();
	});
});

describe('a viewer', () => {
	it('is refused every write and preview with the same error, whether or not the record exists', async () => {
		const ctx = actors.viewer.context;
		for (const parent of ['@I1@', '@I2@']) {
			await expect(relationships().plan(treeId, addChild(parent), ctx)).rejects.toBeInstanceOf(UnauthorizedError);
		}
		await expect(relationships().plan(treeId, { ...addChild('@I1@'), parent: { id: 'nobody', givenName: 'P', surname: null } }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
