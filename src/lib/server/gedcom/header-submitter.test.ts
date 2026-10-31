import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trees } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { buildGedcom551String, buildGedcom7String, type GedcomExportPayload } from './serializer';
import { validateGedcom7 } from './validate7';

const AT = new Date(Date.UTC(2026, 10, 1, 9, 5, 7));

function payload(extra: Partial<GedcomExportPayload> = {}): GedcomExportPayload {
	return {
		treeName: 'Header',
		exportedAt: AT,
		individuals: [{ id: '@I1@', givenName: 'Ann', surname: 'Able', sex: 'F' }],
		families: [],
		...extra
	};
}
const lines = (text: string) => text.split('\r\n');

describe('the 7.0 header', () => {
	it('names Epoch, the export time and no submitter when the tree has none', () => {
		const text = buildGedcom7String(payload());
		expect(text.startsWith('0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n1 SOUR EPOCH_GENEALOGY\r\n')).toBe(
			true
		);
		expect(text).toContain('2 NAME Epoch Family Genealogy Repository');
		expect(text).toContain('1 DATE 1 NOV 2026\r\n2 TIME 09:05:07Z');
		expect(text).not.toContain('SUBM');
		expect(validateGedcom7(text).errors).toEqual([]);
	});

	it('writes HEAD.SUBM and a SUBM record when a name is set, and nothing for an address alone', () => {
		const text = buildGedcom7String(
			payload({
				submitter: { name: 'Ada Smith', email: 'ada@example.com', www: 'https://a.example' }
			})
		);
		expect(text).toContain('1 SUBM @U1@');
		expect(text).toContain(
			'0 @U1@ SUBM\r\n1 NAME Ada Smith\r\n1 EMAIL ada@example.com\r\n1 WWW https://a.example'
		);
		expect(validateGedcom7(text).errors).toEqual([]);
		expect(
			buildGedcom7String(payload({ submitter: { name: null, email: 'a@b.c' } }))
		).not.toContain('SUBM');
	});

	it('numbers the submitter around a kept SUBM record', () => {
		const text = buildGedcom7String(
			payload({
				submitter: { name: 'Ada' },
				preserved: [{ xref: '@U1@', lines: ['0 @U1@ SUBM', '1 NAME Other'] }]
			})
		);
		expect(text).toContain('1 SUBM @U2@');
		expect(text).toContain('0 @U2@ SUBM\r\n1 NAME Ada');
		expect(text).toContain('0 @U1@ SUBM\r\n1 NAME Other');
	});

	it('writes a kept LANG and PLAC once, and merges kept SCHMA tags with Epoch’s', () => {
		const text = buildGedcom7String(
			payload({
				headerBlocks: [
					['1 LANG en-US'],
					['1 LANG de'],
					['1 PLAC', '2 FORM City, Country'],
					['1 SCHMA', '2 TAG _A http://a.example/1', '2 TAG _A http://a.example/2']
				]
			})
		);
		expect(lines(text).filter((l) => l.startsWith('1 LANG'))).toEqual(['1 LANG en-US']);
		expect(text).toContain('1 PLAC\r\n2 FORM City, Country');
		expect(text).toContain('2 TAG _A http://a.example/1\r\n2 TAG _A http://a.example/2');
		expect(validateGedcom7(text).errors).toEqual([]);
	});
});

describe('the 5.5.1 header', () => {
	it('always names a submitter, as Unknown when the tree has none', () => {
		const text = buildGedcom551String(payload());
		expect(text).toContain('1 SUBM @U1@');
		expect(text).toContain('0 @U1@ SUBM\r\n1 NAME Unknown');
		expect(text).toContain('1 DATE 1 NOV 2026\r\n2 TIME 09:05:07\r\n');
	});

	it('writes the tree’s submitter when it has one, and leaves out LANG and SCHMA', () => {
		const text = buildGedcom551String(
			payload({
				submitter: { name: 'Ada', email: 'ada@example.com' },
				headerBlocks: [['1 LANG en'], ['1 SCHMA', '2 TAG _A http://a.example']]
			})
		);
		expect(text).toContain('0 @U1@ SUBM\r\n1 NAME Ada\r\n1 EMAIL ada@example.com');
		expect(text).not.toContain('LANG');
		expect(text).not.toContain('SCHMA');
	});
});

describe('importing a header', () => {
	let t: TestDatabase;
	beforeAll(async () => {
		t = await createTestDatabase();
	});
	afterAll(async () => {
		await t.dispose();
	});

	const file = (subm: string, head = '') =>
		`0 HEAD\n1 GEDC\n2 VERS 7.0\n${head}1 SUBM @U9@\n0 @I1@ INDI\n1 NAME A /B/\n${subm}0 TRLR\n`;
	const PLAIN = '0 @U9@ SUBM\n1 NAME Ada Smith\n1 EMAIL ada@example.com\n1 WWW https://a.example\n';

	async function importAndExport(text: string) {
		const treeId = crypto.randomUUID();
		await importGedcomToDb(t.d1, treeId, text, 'Header');
		const tree = await t.db.select().from(trees).where(eq(trees.id, treeId)).get();
		const data = await getTreeExportData(t.d1, treeId);
		return { treeId, tree: tree!, data, out: buildGedcom7String({ ...data, exportedAt: AT }) };
	}

	it('fills an empty submitter from the record HEAD.SUBM names, and exports it once', async () => {
		const { tree, out } = await importAndExport(file(PLAIN));
		expect([tree.submitterName, tree.submitterEmail, tree.submitterWww]).toEqual([
			'Ada Smith',
			'ada@example.com',
			'https://a.example'
		]);
		expect(out.match(/ SUBM\r?$/gm)).toHaveLength(1);
		expect(out).toContain('1 NAME Ada Smith');
	});

	it('keeps a record with more in it, or one something points at, beside the setting', async () => {
		const rich = await importAndExport(file(PLAIN + '1 ADDR 1 Main St\n'));
		expect(rich.tree.submitterName).toBe('Ada Smith');
		expect(rich.out).toContain('1 ADDR 1 Main St');
		const pointed = await importAndExport(
			file(PLAIN).replace('1 NAME A /B/\n', '1 NAME A /B/\n1 SUBM @U9@\n')
		);
		// The kept record is the one HEAD.SUBM points at, so there is one record and not two.
		expect(pointed.out.match(/^0 @\S+@ SUBM/gm)).toHaveLength(1);
		expect(pointed.out).toMatch(/^1 SUBM @U9@\r$/m);
	});

	it('points HEAD.SUBM at the kept record while the setting still says what it says', async () => {
		const { out } = await importAndExport(file(PLAIN + '1 ADDR 1 Main St\n'));
		expect(out.match(/^0 @\S+@ SUBM/gm)).toHaveLength(1);
		expect(out).toMatch(/^1 SUBM @U9@\r$/m);
		expect(out).toContain('0 @U9@ SUBM\r\n1 NAME Ada Smith');
		expect(out).toContain('1 ADDR 1 Main St');
	});

	it('writes the tree’s own record once the setting is edited, and the kept one stays a record', async () => {
		const { data } = await importAndExport(file(PLAIN + '1 ADDR 1 Main St\n'));
		const edited = buildGedcom7String({
			...data,
			exportedAt: AT,
			submitter: { ...data.submitter, name: 'Ada Jones' }
		});
		expect(edited.match(/^0 @\S+@ SUBM/gm)).toHaveLength(2);
		expect(edited).toContain('1 NAME Ada Jones');
		expect(edited).toContain('1 NAME Ada Smith');
		const head = edited.slice(0, edited.indexOf('0 @I'));
		expect(head).toContain('1 SUBM @U1@');
	});

	it('keeps the header’s LANG, PLAC and SCHMA tags through an import and export', async () => {
		const { out } = await importAndExport(
			file(
				PLAIN,
				'1 SCHMA\n2 TAG _X http://x.example\n1 LANG en-AU\n1 PLAC\n2 FORM City, Country\n'
			)
		);
		expect(out).toContain('1 LANG en-AU');
		expect(out).toContain('1 PLAC\r\n2 FORM City, Country');
		expect(out).toContain('2 TAG _X http://x.example');
	});

	it('does not overwrite a submitter that is set; a different record stays a root record', async () => {
		const first = await importAndExport(file(PLAIN));
		const other = '0 @U9@ SUBM\n1 NAME Someone Else\n';
		await importGedcomToDb(t.d1, first.treeId, file(other), 'Header', 'merge');
		const tree = await t.db.select().from(trees).where(eq(trees.id, first.treeId)).get();
		expect(tree!.submitterName).toBe('Ada Smith');
		const out = buildGedcom7String(await getTreeExportData(t.d1, first.treeId));
		expect(out).toContain('1 NAME Someone Else');
		// The same record again adds nothing.
		await importGedcomToDb(t.d1, first.treeId, file(PLAIN), 'Header', 'merge');
		expect(
			buildGedcom7String(await getTreeExportData(t.d1, first.treeId)).match(/ SUBM\r?$/gm)
		).toHaveLength(2);
	});
});
