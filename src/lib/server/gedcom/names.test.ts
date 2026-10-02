import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsonsClean from '../../../../docs/The_Simpsons_clean.ged?raw';
import namesFixture from '../../../../docs/The_Names_fixture.ged?raw';
import { personNames } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { buildGedcom551String, buildGedcom7String, parseGedcom } from './index';
import { getTreeExportData, importGedcomToDb } from './importer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const namesOf = (ged: string) =>
	Object.fromEntries(parseGedcom(ged).individuals.map((i) => [i.id, i.names]));

async function importAndExport(ged: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, ged, 'Names');
	const data = await getTreeExportData(t.d1, treeId);
	return { treeId, data, text551: buildGedcom551String(data), text7: buildGedcom7String(data) };
}

describe('parsing every NAME', () => {
	const people = Object.fromEntries(parseGedcom(namesFixture).individuals.map((i) => [i.id, i]));

	it('keeps every name in file order, and the first is the primary one', () => {
		const jessica = people['@I1@'];
		expect(jessica.names!.map((n) => [n.type, n.givenName, n.surname])).toEqual([
			['birth', 'Jessica Louise', 'Simpson'],
			['married', 'Jessica Louise', 'Smith']
		]);
		expect(jessica.surname).toBe('Simpson');
	});

	it('reads the name parts, and keeps NOTE and SOUR under the NAME', () => {
		const [, married] = people['@I1@'].names!;
		expect(married.extra).toEqual(["2 NOTE Took Nick's surname", '2 SOUR @S1@', '3 PAGE 12']);
		const [nick] = people['@I2@'].names!;
		expect(nick).toMatchObject({
			prefix: 'Dr',
			givenName: 'Julius',
			nickname: 'Nick',
			surnamePrefix: 'de',
			surname: 'Hibbert',
			suffix: 'Jr'
		});
	});

	it('keeps free-text types and reads untyped later names as aka', () => {
		const names = people['@I2@'].names!;
		expect(names[1]).toMatchObject({ type: 'other', gedcomType: 'nickname' });
		expect(names[2].type).toBe('professional');
		expect(people['@I3@'].names![1].type).toBe('aka');
	});

	it('turns _MARNM into a married name, in either value form', () => {
		expect(people['@I3@'].names![2]).toMatchObject({
			type: 'married',
			gedcomType: '_MARNM',
			givenName: 'Ann',
			surname: 'Carter'
		});
		expect(people['@I4@'].names![1]).toMatchObject({
			type: 'married',
			givenName: 'Zoe',
			surname: 'Ames'
		});
	});
});

describe('names survive export', () => {
	for (const [label, source] of [
		['the Simpsons', simpsonsClean],
		['the names fixture', namesFixture]
	] as const) {
		it(`round-trips ${label} through the database in both dialects`, async () => {
			const { text551, text7 } = await importAndExport(source);
			expect(namesOf(text551)).toEqual(namesOf(source));
			expect(namesOf(text7)).toEqual(namesOf(source));
		});
		it(`round-trips ${label} through the file alone`, () => {
			const parsed = parseGedcom(source);
			const data = { individuals: parsed.individuals, families: [], preserved: [] } as never;
			expect(namesOf(buildGedcom551String(data))).toEqual(namesOf(source));
		});
	}

	it('writes a _MARNM name back as one _MARNM, not as a second NAME', async () => {
		const { text551 } = await importAndExport(namesFixture);
		expect(text551.match(/^1 _MARNM/gm)).toHaveLength(2);
		expect(text551.match(/^1 NAME .*Carter/gm)).toBeNull();
	});

	it('writes a free-text type as a PHRASE in 7.0', async () => {
		const { text7 } = await importAndExport(namesFixture);
		expect(text7).toContain('2 TYPE OTHER\r\n3 PHRASE nickname');
	});

	it('leaves a single-name file byte-for-byte as before (no TYPE on the primary birth name)', async () => {
		const { text551 } = await importAndExport(simpsonsClean);
		expect(text551).not.toContain('2 TYPE birth');
	});

	it('writes the preferred name first, so other programs read it as the primary', async () => {
		const { treeId } = await importAndExport(namesFixture);
		const db = t.db;
		const rows = await db
			.select()
			.from(personNames)
			.where(eq(personNames.personId, `${treeId}:@I1@`))
			.all();
		const married = rows.find((r) => r.type === 'married')!;
		await db.update(personNames).set({ isPreferred: true }).where(eq(personNames.id, married.id));
		await db
			.update(personNames)
			.set({ isPreferred: false })
			.where(eq(personNames.id, rows.find((r) => r.type === 'birth')!.id));
		// What set_preferred_name does in the same change: the display name follows the preferred row.
		await t.d1
			.prepare('UPDATE individuals SET surname = ? WHERE id = ?')
			.bind('Smith', `${treeId}:@I1@`)
			.run();
		const data = await getTreeExportData(t.d1, treeId);
		const text = buildGedcom551String(data);
		const jessica = parseGedcom(text).individuals.find((i) => i.id === '@I1@')!;
		expect(jessica.names!.map((n) => n.type)).toEqual(['married', 'birth']);
		expect(jessica.surname).toBe('Smith');
	});
});

describe('a name row the pre-S6 person form left stale', () => {
	it("exports the person's own name, which was the edited one", async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, namesFixture, 'Names');
		// The old person form wrote individuals only, so the imported preferred row still says "Simpson".
		await t.d1
			.prepare('UPDATE individuals SET surname = ? WHERE id = ?')
			.bind('Simpson-Smith', `${treeId}:@I1@`)
			.run();
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		const jessica = parseGedcom(text).individuals.find((i) => i.id === '@I1@')!;
		expect(jessica.names!.map((n) => [n.type, n.surname])).toEqual([
			['birth', 'Simpson-Smith'],
			['married', 'Smith']
		]);
	});
});

describe('merge-mode re-import', () => {
	it('adds no second copy of a name and no second preferred name', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, namesFixture, 'Names');
		await importGedcomToDb(t.d1, treeId, namesFixture, 'Names', 'merge');
		const data = await getTreeExportData(t.d1, treeId);
		const jessica = data.individuals.find((i) => i.id === '@I1@')!;
		expect(jessica.names).toHaveLength(2);
		const preferred = (await t.db.select().from(personNames).all()).filter(
			(n) => n.personId === `${treeId}:@I1@` && n.isPreferred
		);
		expect(preferred).toHaveLength(1);
	});
});

describe('when a name came into use, and from which partnership', () => {
	it('writes a readable note under the NAME and reads it back into the date and the link', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, namesFixture, 'Names');
		const married = (await t.db.select().from(personNames).all()).find(
			(n) => n.personId === `${treeId}:@I1@` && n.type === 'married'
		)!;
		await t.db
			.update(personNames)
			.set({
				dateRaw: 'ABT 1998',
				dateSort: '1998-01-01',
				dateQualifier: 'ABOUT',
				unionId: `${treeId}:@F1@`
			})
			.where(eq(personNames.id, married.id));

		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		expect(text).toContain('2 NOTE Name in use from ABT 1998, through family @F1@.');

		// Another program that ignores the note still sees a plain NAME; Epoch reads it back.
		const other = crypto.randomUUID();
		await importGedcomToDb(t.d1, other, text, 'Round trip');
		const back = (await t.db.select().from(personNames).all()).find(
			(n) => n.personId === `${other}:@I1@` && n.type === 'married'
		)!;
		expect(back).toMatchObject({
			dateRaw: 'ABT 1998',
			dateQualifier: 'ABOUT',
			unionId: `${other}:@F1@`
		});
		expect(back.gedcomExtra).not.toContain(
			'2 NOTE Name in use from ABT 1998, through family @F1@.'
		);
		expect(namesOf(buildGedcom551String(await getTreeExportData(t.d1, other)))).toEqual(
			namesOf(text)
		);
	});

	it('handles a date alone, a family alone, and a note naming a family the file lacks (kept as written)', async () => {
		const ged = (note: string) =>
			`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME A /B/\n1 NAME A /C/\n2 TYPE married\n2 NOTE ${note}\n0 @F1@ FAM\n1 WIFE @I1@\n0 TRLR`;
		expect(namesOf(ged('Name in use from 1998.'))['@I1@']![1]).toMatchObject({ dateText: '1998' });
		expect(namesOf(ged('Name in use through family @F1@.'))['@I1@']![1]).toMatchObject({
			unionXref: '@F1@'
		});

		const treeId = crypto.randomUUID();
		await importGedcomToDb(
			t.d1,
			treeId,
			ged('Name in use from 1998, through family @F99@.'),
			'Names'
		);
		const row = (await t.db.select().from(personNames).all()).find(
			(n) => n.personId === `${treeId}:@I1@` && n.type === 'married'
		)!;
		expect(row).toMatchObject({ unionId: null, dateRaw: null });
		expect(row.gedcomExtra).toEqual(['2 NOTE Name in use from 1998, through family @F99@.']);
		const out = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		expect(out.match(/Name in use/g)).toHaveLength(1);
	});
});
