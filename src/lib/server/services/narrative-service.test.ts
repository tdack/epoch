import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { wholeGraph } from '../testing/graph';
import { NarrativeService } from './narrative-service';
import { DESCENDANT_NUMBERINGS } from '../../shared/descendant-numbers';
import { NARRATIVE_KINDS } from '../../shared/reports';

const GEDCOM = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ann /Ash/
1 SEX F
1 BIRT
2 DATE 3 MAR 1800
2 PLAC Leeds
2 SOUR @S1@
3 PAGE p. 4
1 DEAT
2 DATE 1860
2 SOUR @S1@
3 PAGE p. 4
1 FAMS @F1@
1 FAMC @F0@
0 @I2@ INDI
1 NAME Ben /Birch/
1 BIRT
2 DATE 1798
1 DEAT
2 DATE 1850
1 FAMS @F1@
0 @I3@ INDI
1 NAME Cal /Birch/
1 BIRT
2 DATE 1825
1 FAMC @F1@
0 @I4@ INDI
1 NAME Dot /Ash/
1 BIRT
2 DATE 1770
1 FAMS @F0@
0 @I5@ INDI
1 NAME Zed /Birch/
1 BIRT
2 DATE 1995
1 FAMC @F1@
0 @F0@ FAM
1 WIFE @I4@
1 CHIL @I1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1822
2 PLAC York
1 CHIL @I3@
1 CHIL @I5@
0 @S1@ SOUR
1 TITL Parish register
0 TRLR
`;

let t: TestDatabase;
let owner: TestActor;
let viewer: TestActor;
let treeId: string;
let idOf: (name: string) => string;
beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await importGedcomToDb(t.d1, treeId, GEDCOM, 'Narrative');
	const graph = await wholeGraph(t.db, treeId, owner.context);
	idOf = (name) => graph.people.find((p) => p.displayName.startsWith(name))!.id;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const narrative = (
	personId: string,
	kind: (typeof NARRATIVE_KINDS)[keyof typeof NARRATIVE_KINDS],
	who = owner
) =>
	new NarrativeService(t.db).narrative(
		treeId,
		personId,
		kind,
		3,
		DESCENDANT_NUMBERINGS.DABOVILLE,
		who.context
	);

describe('the descendant narrative', () => {
	it('numbers each descendant and tells each one with endnotes', async () => {
		const report = await narrative(idOf('Ann'), NARRATIVE_KINDS.DESCENDANTS);
		expect(report.entries.map((e) => [e.number, e.name])).toEqual([
			['1', 'Ann Ash'],
			['1.1', 'Cal Birch'],
			['1.2', 'Zed Birch']
		]);
		expect(report.entries[0]!.sentences).toEqual([
			{ text: 'Ann Ash, child of Dot Ash, was born on 3 March 1800 in Leeds.', notes: [1] },
			{ text: 'Ann died in 1860, aged 59–60.', notes: [1] },
			{ text: 'Ann married Ben Birch in 1822 in York.', notes: [] },
			{ text: 'Their children were Cal Birch (1.1) and Zed Birch (1.2).', notes: [] }
		]);
		expect(report.endnotes).toEqual([{ number: 1, text: 'Parish register, p. 4.' }]);
	});

	it('says nothing a viewer may not see about a living descendant', async () => {
		const report = await narrative(idOf('Ann'), NARRATIVE_KINDS.DESCENDANTS, viewer);
		expect(JSON.stringify(report)).not.toContain('Zed');
		expect(report.entries[0]!.sentences.at(-1)!.text).toBe('Their child was Cal Birch (1.1).');
	});
});

describe('the ancestor narrative', () => {
	// The slots follow the pedigree chart's parent order: the neutral model has no father's slot.
	it('numbers ancestors by Ahnentafel, as the pedigree chart places them', async () => {
		const report = await narrative(idOf('Cal'), NARRATIVE_KINDS.ANCESTORS);
		expect(report.numbering).toBeNull();
		expect(report.entries.map((e) => [e.number, e.name, e.generation])).toEqual([
			['1', 'Cal Birch', 1],
			['2', 'Ann Ash', 2],
			['3', 'Ben Birch', 2],
			['4', 'Dot Ash', 3]
		]);
		expect(report.entries[2]!.sentences[0]!.text).toBe('Ben Birch was born in 1798.');
	});
});
