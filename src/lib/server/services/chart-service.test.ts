/** The pedigree and descendant charts over a real database, and what a viewer may learn from them. */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import type { DescendantNode } from '../../shared/charts';
import { ChartService } from './chart-service';
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
const charts = () => new ChartService(t.db, () => NOW);
const flatten = (node: DescendantNode): string[] => [
	node.person.name,
	...node.children.flatMap(flatten)
];

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	actors.viewer = await createTestUser(t.db, 'viewer');
	await addTestMember(t.db, treeId, actors.viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Charts');
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

describe('the pedigree', () => {
	it('shows an owner both parents of the person, with their dates, in heap order', async () => {
		const dto = await charts().pedigree(treeId, idOf(4), 3, actors.owner.context);
		expect(dto.slots.map((s) => s?.name ?? null)).toEqual([
			'Me Oldman',
			'Dad Oldman',
			null,
			'Gran Oldman',
			'Secretia Oldman',
			null,
			null
		]);
		expect(dto.slots[1]).toMatchObject({ birth: '1860', death: '1930' });
		expect(dto.hasMoreAbove).toBe(false);
	});
	it('says when the generation limit hides more', async () => {
		expect((await charts().pedigree(treeId, idOf(4), 2, actors.owner.context)).hasMoreAbove).toBe(
			true
		);
	});
	it('does not say more lies above because the person has children, or below because they have parents', async () => {
		// Gran has descendants and no ancestors; Cuz has ancestors and no descendants.
		expect((await charts().pedigree(treeId, idOf(1), 4, actors.owner.context)).hasMoreAbove).toBe(
			false
		);
		expect(
			(await charts().descendants(treeId, idOf(5), 4, actors.owner.context)).hasMoreBelow
		).toBe(false);
		// One generation is only the person, and both directions have more.
		expect((await charts().pedigree(treeId, idOf(4), 1, actors.owner.context)).hasMoreAbove).toBe(
			true
		);
		expect(
			(await charts().descendants(treeId, idOf(1), 1, actors.owner.context)).hasMoreBelow
		).toBe(true);
	});
	it('leaves a private ancestor out for a viewer, without a trace', async () => {
		const dto = await charts().pedigree(treeId, idOf(4), 3, actors.viewer.context);
		expect(dto.slots.map((s) => s?.name ?? null)).toEqual([
			'Me Oldman',
			'Dad Oldman',
			null,
			'Gran Oldman',
			null,
			null,
			null
		]);
		expect(JSON.stringify(dto)).not.toContain('Secretia');
	});
	it('answers a private subject as a missing one, and refuses a silly depth', async () => {
		const hidden = await charts()
			.pedigree(treeId, idOf(7), 3, actors.viewer.context)
			.catch((e) => e);
		const missing = await charts()
			.pedigree(treeId, 'no-such-person', 3, actors.viewer.context)
			.catch((e) => e);
		expect(hidden).toBeInstanceOf(NotFoundError);
		expect(hidden.message.replace(idOf(7), 'ID')).toBe(
			missing.message.replace('no-such-person', 'ID')
		);
		await expect(
			charts().pedigree(treeId, idOf(4), 0, actors.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			charts().pedigree(treeId, idOf(4), 9, actors.owner.context)
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('the descendants', () => {
	it('draws every descendant of Gran, with their partners on the card', async () => {
		const dto = await charts().descendants(treeId, idOf(1), 4, actors.owner.context);
		expect(flatten(dto.root).sort()).toEqual([
			'Cuz Oldman',
			'Dad Oldman',
			'Gran Oldman',
			'Me Oldman',
			'Unc Oldman'
		]);
		expect(dto.root.partners.map((p) => p.name)).toEqual(['Secretia Oldman']);
		expect(dto.hasMoreBelow).toBe(false);
		expect(
			(await charts().descendants(treeId, idOf(1), 2, actors.owner.context)).hasMoreBelow
		).toBe(true);
	});
	it("leaves the private partner and the private person's children out for a viewer", async () => {
		const dto = await charts().descendants(treeId, idOf(1), 4, actors.viewer.context);
		expect(dto.root.partners).toEqual([]);
		expect(JSON.stringify(dto)).not.toContain('Secretia');
		await expect(
			charts().descendants(treeId, idOf(7), 3, actors.viewer.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe('with the tree set to show private people as placeholders', () => {
	beforeAll(async () => {
		await new PrivacyService(t.db, {
			now: () => NOW.getTime(),
			newId: () => crypto.randomUUID()
		}).updateSettings(treeId, { shouldShowPrivateStructure: true }, actors.owner.context);
	});
	it('draws "Private" with no name or dates', async () => {
		const dto = await charts().pedigree(treeId, idOf(4), 3, actors.viewer.context);
		expect(dto.slots[4]).toMatchObject({
			name: 'Private',
			isPrivate: true,
			birth: null,
			death: null
		});
		expect(JSON.stringify(dto)).not.toContain('Secretia');
	});
});
