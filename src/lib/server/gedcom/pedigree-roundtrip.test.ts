import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parentChild } from '../db/schema';
import {
	addTestMember,
	createTestDatabase,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { RelationshipService } from '../services/relationship-service';
import { buildGedcom551String, buildGedcom7String, parseGedcom } from './index';
import { getTreeExportData, importGedcomToDb } from './importer';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const people = (ids: string[]) => ids.map((id) => `0 @${id}@ INDI\n1 NAME ${id} /Test/`).join('\n');

/** Import, export in both dialects, and parse the export again. */
async function roundTrip(ged: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, ged, 'Round trip');
	const data = await getTreeExportData(t.d1, treeId);
	const text551 = buildGedcom551String(data);
	const text7 = buildGedcom7String(data);
	return {
		treeId,
		data,
		text551,
		text7,
		again551: parseGedcom(text551),
		again7: parseGedcom(text7)
	};
}

const pedigreesOf = (parsed: ReturnType<typeof parseGedcom>, familyId = '@F1@') =>
	Object.fromEntries(
		parsed.families.find((f) => f.id === familyId)!.children.map((c) => [c.childId, c.pedigree])
	);

describe('PEDI on FAMC', () => {
	const ged = `0 HEAD
1 GEDC
2 VERS 5.5.1
${people(['I1', 'I2'])}
0 @I3@ INDI
1 NAME I3 /Test/
1 FAMC @F1@
2 PEDI adopted
0 @I4@ INDI
1 NAME I4 /Test/
1 FAMC @F1@
2 PEDI foster
0 @I5@ INDI
1 NAME I5 /Test/
1 FAMC @F1@
2 PEDI sealing
0 @I6@ INDI
1 NAME I6 /Test/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@
1 CHIL @I5@
1 CHIL @I6@
0 TRLR`;

	it('is read from the child’s FAMC, not only from CHIL', () => {
		expect(pedigreesOf(parseGedcom(ged))).toEqual({
			'@I3@': 'adopted',
			'@I4@': 'foster',
			'@I5@': 'sealing',
			'@I6@': 'birth'
		});
	});

	it('becomes per-parent link types, keeping sealing as unknown with its PEDI word', async () => {
		const { treeId } = await roundTrip(ged);
		const links = await t.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all();
		const summary = links
			.map(
				(l) =>
					`${l.parentId.split(':')[1]}>${l.childId.split(':')[1]}:${l.type}:${l.gedcomPedi ?? '-'}`
			)
			.sort();
		expect(summary).toEqual([
			'@I1@>@I3@:adoptive:-',
			'@I1@>@I4@:foster:-',
			'@I1@>@I5@:unknown:sealing',
			'@I1@>@I6@:biological:-',
			'@I2@>@I3@:adoptive:-',
			'@I2@>@I4@:foster:-',
			'@I2@>@I5@:unknown:sealing',
			'@I2@>@I6@:biological:-'
		]);
	});

	it('exports PEDI under FAMC, never under CHIL, and reads back the same pedigrees (5.5.1)', async () => {
		const { text551, again551 } = await roundTrip(ged);
		expect(text551).toContain('1 FAMC @F1@\r\n2 PEDI adopted');
		expect(text551).toContain('2 PEDI sealing');
		expect(text551).not.toMatch(/1 CHIL @I\d@\r\n2 PEDI/);
		expect(pedigreesOf(again551)).toEqual({
			'@I3@': 'adopted',
			'@I4@': 'foster',
			'@I5@': 'sealing',
			'@I6@': 'birth'
		});
	});

	it('writes uppercase values in GEDCOM 7 and reads them back', async () => {
		const { text7, again7 } = await roundTrip(ged);
		expect(text7).toContain('2 PEDI ADOPTED');
		expect(text7).toContain('2 PEDI FOSTER');
		expect(pedigreesOf(again7)).toEqual({
			'@I3@': 'adopted',
			'@I4@': 'foster',
			'@I5@': 'sealing',
			'@I6@': 'birth'
		});
	});

	it('keeps OTHER in GEDCOM 7, and drops it from 5.5.1, which has no such value', async () => {
		const other = ged.replace('2 PEDI sealing', '2 PEDI OTHER');
		expect(pedigreesOf(parseGedcom(other))['@I5@']).toBe('other');
		const { text551, text7, again7 } = await roundTrip(other);
		expect(text7).toContain('2 PEDI OTHER');
		expect(pedigreesOf(again7)['@I5@']).toBe('other');
		expect(text551).not.toContain('OTHER');
	});

	it('still reads the non-standard PEDI under CHIL from files Epoch exported earlier, and FAMC wins', () => {
		const legacy = `0 HEAD
${people(['I1', 'I3', 'I4'])}
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I3@
2 PEDI adopted
1 CHIL @I4@
2 PEDI foster
0 TRLR`.replace(
			'0 @I4@ INDI\n1 NAME I4 /Test/',
			'0 @I4@ INDI\n1 NAME I4 /Test/\n1 FAMC @F1@\n2 PEDI adopted'
		);
		expect(pedigreesOf(parseGedcom(legacy))).toEqual({ '@I3@': 'adopted', '@I4@': 'adopted' });
	});
});

describe('a different pedigree for each parent', () => {
	const ged = `0 HEAD
${people(['I1', 'I2'])}
0 @I3@ INDI
1 NAME I3 /Test/
1 FAMC @F1@
2 PEDI birth
2 _PEDI_PARENT @I2@
3 PEDI adopted
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`;

	it('imports as two links of different types and exports them back', async () => {
		const { treeId, text551, again551, again7 } = await roundTrip(ged);
		const links = await t.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all();
		expect(links.map((l) => `${l.parentId.split(':')[1]}:${l.type}`).sort()).toEqual([
			'@I1@:biological',
			'@I2@:adoptive'
		]);

		expect(text551).toContain('1 FAMC @F1@\r\n2 _PEDI_PARENT @I2@\r\n3 PEDI adopted');
		for (const again of [again551, again7]) {
			const child = again.families[0].children[0];
			expect(child.pedigree).toBe('birth');
			expect(child.parentPedigrees).toEqual({ '@I2@': 'adopted' });
		}
	});
});

describe('merged family XREFs', () => {
	const ged = `0 HEAD
${people(['I1', 'I2'])}
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 NOTE copy two note
0 TRLR`;

	it('writes each alias as a typed REFN and reads it back', async () => {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, ged, 'Aliases');
		const actor = await createTestUser(t.db);
		await addTestMember(t.db, treeId, actor, 'owner');
		const service = new RelationshipService(t.db);

		await service.mergeUnions(
			treeId,
			{ kind: 'merge_unions', survivorId: `${treeId}:@F1@`, mergedIds: [`${treeId}:@F2@`] },
			actor.context
		);
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));

		expect(text.match(/0 @F\d@ FAM/g)).toEqual(['0 @F1@ FAM']);
		expect(text).toContain('1 REFN F2\r\n2 TYPE epoch-merged-family');
		// The NOTE that was filed under the merged-away family follows the family that absorbed it.
		expect(text).toMatch(/0 @F1@ FAM[\s\S]*1 NOTE copy two note[\s\S]*0 TRLR/);
		expect(parseGedcom(text).families[0].aliases).toEqual(['@F2@']);
	});

	it('re-imports the aliases onto the union', async () => {
		const withAlias = ged
			.replace('0 @F2@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 NOTE copy two note\n', '')
			.replace(
				'0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n',
				'0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 REFN F2\n2 TYPE epoch-merged-family\n'
			);
		const { treeId, data } = await roundTrip(withAlias);
		expect(data.families).toHaveLength(1);
		expect(data.families[0]).toMatchObject({ id: '@F1@', aliases: ['@F2@'] });
		expect(treeId).toBeTruthy();
	});
});

describe('other structures under FAMC (ADR-009)', () => {
	const ged = `0 HEAD
1 GEDC
2 VERS 5.5.1
${people(['I1', 'I2'])}
0 @I3@ INDI
1 NAME I3 /Test/
1 FAMC @F1@
2 PEDI adopted
2 STAT challenged
2 NOTE Disputed by a cousin
3 CONC , see the letter
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`;

	const famcBlock = (text: string) =>
		text
			.split(/\r?\n/)
			.join('\n')
			.match(/1 FAMC @F1@\n(?:[2-9] .*\n?)*/)![0]
			.trim()
			.split('\n');

	it('keeps STAT and NOTE under the same FAMC, next to the PEDI, in both dialects', async () => {
		const { text551, text7 } = await roundTrip(ged);
		expect(famcBlock(text551)).toEqual([
			'1 FAMC @F1@',
			'2 PEDI adopted',
			'2 STAT challenged',
			'2 NOTE Disputed by a cousin',
			'3 CONC , see the letter'
		]);
		expect(famcBlock(text7)).toEqual([
			'1 FAMC @F1@',
			'2 PEDI ADOPTED',
			'2 STAT challenged',
			'2 NOTE Disputed by a cousin',
			'3 CONC , see the letter'
		]);
	});

	it('does not write the extras a second time after the record, and is stable over a second round trip', async () => {
		const first = await roundTrip(ged);
		expect(first.text551.match(/STAT challenged/g)).toHaveLength(1);
		const second = await roundTrip(first.text551);
		expect(second.text551.match(/STAT challenged/g)).toHaveLength(1);
		expect(famcBlock(second.text551)).toEqual(famcBlock(first.text551));
	});

	it('follows a family that was merged into another', async () => {
		const merged = `0 HEAD
1 GEDC
2 VERS 5.5.1
${people(['I1', 'I2'])}
0 @I3@ INDI
1 NAME I3 /Test/
1 FAMC @F1@
2 STAT proven
1 FAMC @F2@
2 STAT proven
2 NOTE second copy
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 TRLR`;
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, merged, 'Merged', 'replace', {
			shouldMergeDuplicateFamilies: true
		});
		const text = buildGedcom551String(await getTreeExportData(t.d1, treeId));
		expect(famcBlock(text)).toEqual(['1 FAMC @F1@', '2 STAT proven', '2 NOTE second copy']);
	});
});
