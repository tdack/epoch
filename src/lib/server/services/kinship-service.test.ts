/** The relationship calculator over a real database: routes, and what a viewer may learn from them. */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { KinshipService } from './kinship-service';
import { PrivacyService } from './privacy-service';

const person = (n: number, name: string, extra = '') =>
	`0 @I${n}@ INDI\n1 NAME ${name}\n1 BIRT\n2 DATE ${1850 + n * 5}\n1 DEAT\n2 DATE ${1920 + n * 5}\n${extra}`;
const FIXTURE = `0 HEAD
${person(1, 'Gran /Oldman/', '1 FAMS @F1@\n')}${person(2, 'Dad /Oldman/', '1 FAMC @F1@\n1 FAMS @F2@\n')}${person(3, 'Unc /Oldman/', '1 FAMC @F1@\n1 FAMS @F3@\n')}${person(4, 'Me /Oldman/', '1 FAMC @F2@\n')}${person(5, 'Cuz /Oldman/', '1 FAMC @F3@\n')}${person(6, 'Loner /Smith/')}${person(7, 'Secretia /Oldman/', '1 RESN privacy\n1 FAMS @F1@\n1 FAMS @F4@\n')}${person(8, 'Kidone /Hidden/', '1 FAMC @F4@\n')}${person(9, 'Kidtwo /Hidden/', '1 FAMC @F4@\n')}0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I7@
1 CHIL @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I2@
1 CHIL @I4@
0 @F3@ FAM
1 HUSB @I3@
1 CHIL @I5@
0 @F4@ FAM
1 WIFE @I7@
1 CHIL @I8@
1 CHIL @I9@
0 TRLR`;

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (n: number) => string;
const service = () => new KinshipService(t.db, () => NOW);
const find = (who: TreeRole, a: number, b: number) =>
	service().relationship(treeId, idOf(a), idOf(b), actors[who].context);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Kin');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (n) => byXref.get(`@I${n}@`)!;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('for someone who sees everyone', () => {
	it('names cousins and says through whom', async () => {
		const r = await find('owner', 4, 5);
		expect(r.routes.map((x) => x.label)).toEqual(['1st cousin']);
		expect(r.routes[0]!.viaNames.sort()).toEqual(['Gran Oldman', 'Secretia Oldman']);
		expect(r.routes[0]!.steps.map((s) => s.name)).toEqual([
			'Me Oldman',
			'Dad Oldman',
			'Gran Oldman',
			'Unc Oldman',
			'Cuz Oldman'
		]);
		expect(r.from.name).toBe('Me Oldman');
	});
	it('names a direct line, in both directions', async () => {
		expect((await find('owner', 4, 1)).routes[0]!.label).toBe('grandparent');
		expect((await find('owner', 1, 4)).routes[0]!.label).toBe('grandchild');
	});
	it('finds nothing for people who are not related, without saying the search was cut short', async () => {
		expect(await find('owner', 4, 6)).toMatchObject({ routes: [], isIncomplete: false });
	});
	it('answers a missing person as not found', async () => {
		await expect(
			service().relationship(treeId, idOf(4), 'no-such-person', actors.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe('for a viewer or contributor, with private people omitted', () => {
	it.each(['viewer', 'contributor'] as const)(
		'hides a private person as a %s: they cannot be either end, and a missing one answers alike',
		async (role) => {
			const hidden = await find(role, 4, 7).catch((e) => e);
			const missing = await service()
				.relationship(treeId, idOf(4), 'no-such-person', actors[role].context)
				.catch((e) => e);
			expect(hidden).toBeInstanceOf(NotFoundError);
			expect(hidden.constructor).toBe(missing.constructor);
			expect(hidden.message.replace(idOf(7), 'ID')).toBe(
				missing.message.replace('no-such-person', 'ID')
			);
		}
	);
	it('still relates cousins through the ancestor they can see, and never names the private one', async () => {
		const r = await find('viewer', 4, 5);
		expect(r.routes.map((x) => x.label)).toEqual(['1st cousin']);
		expect(JSON.stringify(r)).not.toContain('Secretia');
	});
	it('finds no relationship that only a private parent makes, and leaves no sign of them', async () => {
		const r = await find('viewer', 8, 9);
		expect(r.routes).toEqual([]);
		expect(JSON.stringify(r)).not.toContain('Secretia');
		// The owner is told they are half-siblings through her.
		expect((await find('owner', 8, 9)).routes[0]!.label).toBe('half-sibling');
	});
});

describe('with the tree set to show private people as placeholders', () => {
	beforeAll(async () => {
		await new PrivacyService(t.db, {
			now: () => NOW.getTime(),
			newId: () => crypto.randomUUID()
		}).updateSettings(treeId, { shouldShowPrivateStructure: true }, actors.owner.context);
	});
	it('shows the relationship through "Private", with no name', async () => {
		const r = await find('viewer', 8, 9);
		expect(r.routes.map((x) => x.label)).toEqual(['half-sibling']);
		expect(r.routes[0]!.steps.map((s) => [s.name, s.isPrivate])).toEqual([
			['Kidone Hidden', false],
			['Private', true],
			['Kidtwo Hidden', false]
		]);
		expect(JSON.stringify(r)).not.toContain('Secretia');
	});
});
