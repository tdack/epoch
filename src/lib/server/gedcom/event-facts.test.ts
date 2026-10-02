import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { events } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { buildGedcom551String, buildGedcom7String, parseGedcom } from './index';
import { getTreeExportData, importGedcomToDb, previewGedcomImport } from './importer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const FILE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Wren /Ash/
1 SEX F
1 BIRT
2 DATE 4 MAR 1900
2 PLAC Leeds
1 BIRT
2 DATE 5 MAR 1900
2 PLAC Hull
1 OCCU Carpenter
2 DATE FROM 1920 TO 1930
1 OCCU Teacher
1 DEAT
2 DATE 1 JAN 1980
2 CAUS Pneumonia
2 AGE 79y
2 NOTE Died at home
1 RESI
2 PLAC 12 High Street
0 TRLR
`;

async function factsOf(treeId: string) {
	return (
		t.db
			.select()
			.from(events)
			.where(and(eq(events.treeId, treeId), eq(events.entityType, 'INDIVIDUAL')))
			// Insertion order, said outright: the facts are read back in the order they were written.
			.orderBy(sql`${events}.rowid`)
			.all()
	);
}

describe('individual facts through import and export', () => {
	it('keeps the line value, cause, age and note apart, and both of two conflicting births', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FILE, 'Facts');
		const facts = await factsOf(treeId);

		expect(facts.filter((f) => f.type === 'BIRT').map((f) => [f.dateRaw, f.place])).toEqual([
			['4 MAR 1900', 'Leeds'],
			['5 MAR 1900', 'Hull']
		]);
		expect(facts.filter((f) => f.type === 'OCCU').map((f) => f.value)).toEqual([
			'Carpenter',
			'Teacher'
		]);
		const death = facts.find((f) => f.type === 'DEAT')!;
		expect([death.cause, death.age, death.notes, death.value, death.description]).toEqual([
			'Pneumonia',
			'79y',
			'Died at home',
			null,
			null
		]);
		expect(facts.every((f) => f.sortOrder === 0)).toBe(true);
	});

	it.each([
		['5.5.1', buildGedcom551String],
		['7.0', buildGedcom7String]
	])(
		'writes them back in %s and reads the same facts from what it wrote',
		async (_label, build) => {
			const treeId = crypto.randomUUID();
			await importGedcomToDb(t.d1, treeId, FILE, 'Facts');
			const text = build(await getTreeExportData(t.d1, treeId));

			expect(text).toContain('1 OCCU Carpenter');
			expect(text).toContain('2 CAUS Pneumonia');
			expect(text).toContain('2 AGE 79y');
			expect(text).toContain('2 NOTE Died at home');
			expect(text.match(/^1 BIRT/gm)).toHaveLength(2);

			const again = parseGedcom(text).individuals[0]!.events;
			const original = parseGedcom(FILE).individuals[0]!.events;
			const strip = (list: typeof again) =>
				list.map(({ type, dateRaw, place, value, cause, age, notes }) => ({
					type,
					dateRaw,
					place,
					value,
					cause,
					age,
					notes
				}));
			expect(strip(again)).toEqual(strip(original));
		}
	);

	it('writes a legacy description as a note only when the fact has no note of its own', () => {
		const payload = (event: object) => ({
			individuals: [
				{
					id: '@I1@',
					givenName: 'A',
					surname: null,
					sex: null,
					events: [{ type: 'OCCU', dateRaw: null, place: null, description: 'old', ...event }]
				}
			],
			families: []
		});
		expect(buildGedcom551String(payload({}))).toContain('2 NOTE old');
		const text = buildGedcom551String(payload({ notes: 'new' }));
		expect(text).toContain('2 NOTE new');
		expect(text).not.toContain('2 NOTE old');
	});

	it('does not merge away a repeated fact when the same file is imported again in merge mode', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, FILE, 'Facts');
		const before = (await factsOf(treeId)).length;

		const preview = await previewGedcomImport(t.d1, treeId, FILE);
		expect(preview.merge?.newEvents).toBe(0);
		await importGedcomToDb(t.d1, treeId, FILE, 'ignored', 'merge');
		expect(await factsOf(treeId)).toHaveLength(before);

		// A third occupation with a different value is a new fact, not a repeat of the first two.
		const withThird = FILE.replace('1 RESI', '1 OCCU Baker\n1 RESI');
		expect((await previewGedcomImport(t.d1, treeId, withThird)).merge?.newEvents).toBe(1);
		await importGedcomToDb(t.d1, treeId, withThird, 'ignored', 'merge');
		expect((await factsOf(treeId)).filter((f) => f.type === 'OCCU').map((f) => f.value)).toEqual([
			'Carpenter',
			'Teacher',
			'Baker'
		]);
	});
});
