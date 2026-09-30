import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcomToDb } from '../gedcom/importer';
import { UnauthorizedError } from '../domain/errors';
import { addTestMember, createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { SearchService } from './search-service';

let t: TestDatabase;
let actor: TestActor;
let treeId: string;
let service: SearchService;

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Jessica /Simpson/
1 NAME Jessica /Smith/
2 TYPE married
1 SEX F
1 BIRT
2 DATE 1950
2 PLAC Hobart, Tasmania
1 FAMS @F1@
0 @I2@ INDI
1 NAME Ann /Brown/
2 NICK Annie
1 BIRT
2 DATE 12 JUN 1852
2 PLAC Cork, Ireland
1 DEAT
2 DATE BEF 1900
2 PLAC Dublin, Ireland
0 @I3@ INDI
1 NAME Ann /Brownlow/
1 BIRT
2 DATE ABT 1851
2 PLAC Cork, Ireland
0 @I4@ INDI
1 NAME Tom /Smith/
1 BIRT
2 PLAC Hobart, Tasmania
1 FAMS @F1@
0 @I5@ INDI
1 NAME Bede /van der Berg/
2 SPFX van der
2 GIVN Bede
2 SURN Berg
0 @I6@ INDI
1 NAME A /Smith/
0 @I7@ INDI
1 NAME Alice /Anderson/
0 @I8@ INDI
1 NAME Cora /Cork/
1 BIRT
2 DATE 1900
2 PLAC Cork, Ireland
1 DEAT
2 DATE 1960
2 PLAC Leeds, England
0 @F1@ FAM
1 HUSB @I4@
1 WIFE @I1@
1 MARR
2 DATE 1975
2 PLAC Launceston, Tasmania
0 TRLR`;

const ctx = () => actor.context;
const ids = (r: { people: Array<{ id: string }> }) => r.people.map((p) => p.id.split(':')[1]);

beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
	treeId = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Search');
	// A second tree with a namesake, so a leak across trees would show as an extra result.
	const other = await createTestTree(t.db, actor);
	await importGedcomToDb(t.d1, other, FIXTURE, 'Other');
	service = new SearchService(t.db);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('searching by name', () => {
	it('finds a person by the name they are shown by and by another they have, saying which', async () => {
		const byBirth = await service.search(treeId, { text: 'Jessica Lovejoy' }, ctx());
		const byMarried = await service.search(treeId, { text: 'Jessica Wren' }, ctx());
		expect(ids(byBirth)).toEqual(['@I1@']);
		expect(ids(byMarried)).toEqual(['@I1@']);
		// Whichever of the two is the display name, the other is explained as "also known as".
		const all = [byBirth.people[0]!, byMarried.people[0]!];
		expect(all.filter((p) => p.matchedName)).toHaveLength(1);
		expect(all.flatMap((p) => p.matches).filter((m) => m.kind === 'name' && !m.isDisplayName)).toHaveLength(1);
	});

	it('matches a nickname, a surname alone and any word order', async () => {
		expect(ids(await service.search(treeId, { text: 'Annie' }, ctx()))).toEqual(['@I2@']);
		expect(ids(await service.search(treeId, { text: 'smith tom' }, ctx()))).toEqual(['@I4@']);
		expect(ids(await service.search(treeId, { text: 'Berg' }, ctx()))).toEqual(['@I5@']);
	});

	it('ranks exact over whole word over prefix, and a short query keeps its exact match under a limit', async () => {
		expect(ids(await service.search(treeId, { text: 'Ann Brown' }, ctx()))).toEqual(['@I2@', '@I3@']);
		expect(ids(await service.search(treeId, { text: 'Brown' }, ctx()))).toEqual(['@I2@', '@I3@']);
		const one = await service.search(treeId, { text: 'a', limit: 1 }, ctx());
		expect(ids(one)).toEqual(['@I6@']);
		expect(one.hasMore).toBe(true);
	});

	it('never returns a person from another tree', async () => {
		const result = await service.search(treeId, { text: 'Smith' }, ctx());
		expect(result.people.every((p) => p.id.startsWith(treeId))).toBe(true);
		expect(result.people).toHaveLength(2);
	});

	it('treats percent and underscore as text, not wildcards', async () => {
		expect((await service.search(treeId, { text: '%' }, ctx())).people).toEqual([]);
		expect((await service.search(treeId, { text: 'A_ce' }, ctx())).people).toEqual([]);
	});
});

describe('searching by XREF', () => {
	it('finds a person by their XREF with or without the @', async () => {
		for (const text of ['@I4@', 'I4', 'i4']) {
			const r = await service.search(treeId, { text }, ctx());
			expect(ids(r), text).toEqual(['@I4@']);
			expect(r.people[0]!.matches[0]).toMatchObject({ kind: 'xref' });
		}
	});
});

describe('searching by place and date', () => {
	it('finds people by a substring of a place, from their own facts', async () => {
		const r = await service.search(treeId, { place: 'cork' }, ctx());
		expect(ids(r).sort()).toEqual(['@I2@', '@I3@', '@I8@']);
		expect(r.people.find((p) => p.id.endsWith('@I2@'))!.matches).toEqual([
			expect.objectContaining({ kind: 'fact', factType: 'BIRT', placeText: 'Cork, Ireland', isPartnershipFact: false })
		]);
	});

	it('reaches both partners through a partnership fact and says so', async () => {
		const r = await service.search(treeId, { place: 'Launceston' }, ctx());
		expect(ids(r).sort()).toEqual(['@I1@', '@I4@']);
		expect(r.people[0]!.matches).toEqual([expect.objectContaining({ factType: 'MARR', isPartnershipFact: true })]);
	});

	it('reads a year range from the stored bounds, treating BEF as open below and undated as no match', async () => {
		const between = await service.search(treeId, { from: '1850', to: '1855' }, ctx());
		// I2 born 12 JUN 1852, I3 ABT 1851, and I2 also died BEF 1900 (open below, so it overlaps).
		expect(ids(between).sort()).toEqual(['@I2@', '@I3@']);
		// Tom's birth has no date: he never matches a date filter, even with his place.
		expect(ids(await service.search(treeId, { from: '1800', to: '2100', place: 'Hobart' }, ctx()))).toEqual(['@I1@']);
		// Only a lower bound: everything from 1960 on, which includes AFT-free exact years.
		expect(ids(await service.search(treeId, { from: '1960' }, ctx())).sort()).toEqual(['@I1@', '@I4@', '@I8@']);
	});

	it('requires place and date to hold on the same fact', async () => {
		// Cora was born in Cork in 1900 and died in Leeds in 1960. "Cork in 1960" is not her.
		expect(ids(await service.search(treeId, { place: 'Cork', from: '1960', to: '1960' }, ctx()))).toEqual([]);
		expect(ids(await service.search(treeId, { place: 'Leeds', from: '1960', to: '1960' }, ctx()))).toEqual(['@I8@']);
		expect(ids(await service.search(treeId, { place: 'Cork', from: '1900', to: '1900' }, ctx()))).toEqual(['@I8@']);
	});

	it('combines with a name', async () => {
		expect(ids(await service.search(treeId, { text: 'Ann', place: 'Cork', from: '1851', to: '1852' }, ctx()))).toEqual(['@I2@', '@I3@']);
		expect(ids(await service.search(treeId, { text: 'Brownlow', place: 'Dublin' }, ctx()))).toEqual([]);
	});

	it('returns nothing for an empty query', async () => {
		expect(await service.search(treeId, {}, ctx())).toEqual({ people: [], hasMore: false });
	});
});

describe('who may search', () => {
	it('allows a viewer and refuses a stranger', async () => {
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		expect((await service.search(treeId, { text: 'Tom' }, viewer.context)).people).toHaveLength(1);
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service.search(treeId, { text: 'Tom' }, stranger.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
