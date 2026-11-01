/**
 * Media records in an import (ADR-082): `OBJE` records, embedded 5.5.1 copies and pointers become
 * objects, unresolved files and links; nothing is fetched; what the model cannot hold is kept.
 */

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaItems, mediaLinks, mediaObjects } from '../db/schema';
import { getDb } from '../db';
import { objectIdOf, unresolvedMediaKey } from '../../shared/media';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { GedcomService } from '../services/gedcom-service';
import { semanticDiff } from './semantic-diff';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const HEAD7 = ['0 HEAD', '1 GEDC', '2 VERS 7.0'];
const HEAD551 = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
const gedcom = (head: string[], ...records: string[]) =>
	[...head, ...records, '0 TRLR'].join('\n') + '\n';
const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

async function importIt(text: string, treeId: string = crypto.randomUUID()) {
	await importGedcomToDb(t.d1, treeId, text, 'Media');
	return treeId;
}

async function objectsOf(treeId: string) {
	return t.db
		.select()
		.from(mediaObjects)
		.where(eq(mediaObjects.treeId, treeId))
		.orderBy(asc(mediaObjects.xref))
		.all();
}
const filesOf = (treeId: string) =>
	t.db
		.select()
		.from(mediaItems)
		.where(eq(mediaItems.treeId, treeId))
		.orderBy(asc(mediaItems.sortOrder))
		.all();
const linksOf = (treeId: string) =>
	t.db.select().from(mediaLinks).where(eq(mediaLinks.treeId, treeId)).all();

/** The import, exported as 7.0, compared with the original by meaning. */
async function sevenTrip(original: string, treeId?: string) {
	const id = await importIt(original, treeId);
	const data = await getTreeExportData(t.d1, id);
	const exported = buildGedcom7String(data);
	const diff = semanticDiff(original, exported);
	return {
		treeId: id,
		exported,
		exported551: buildGedcom551String(data),
		errors: validateGedcom7(exported).errors.map((e) => `${e.code} ${e.path}`),
		diffs: [
			...diff.recordsMissing.map((r) => `record-missing ${r}`),
			...diff.recordsAdded.map((r) => `record-added ${r}`),
			...diff.changes.map((c) => `${c.kind} ${c.path}: ${c.before ?? ''} => ${c.after ?? ''}`)
		]
	};
}

describe('a 7.0 OBJE record', () => {
	const RECORD = gedcom(
		HEAD7,
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 OBJE @O1@',
		'2 CROP',
		'3 TOP 1',
		'3 LEFT 2',
		'3 HEIGHT 30',
		'3 WIDTH 40',
		'2 TITL Ann smiling',
		'1 BIRT',
		'2 DATE 1900',
		'2 OBJE @O1@',
		'3 TITL Birth portrait',
		'0 @O1@ OBJE',
		'1 RESN CONFIDENTIAL, LOCKED',
		'1 FILE media/one%20a.jpg',
		'2 FORM image/jpeg',
		'3 MEDI OTHER',
		'4 PHRASE Portrait',
		'2 TITL First file',
		'2 TRAN media/derived.oga',
		'3 FORM audio/ogg',
		'1 FILE file:///path/two.mp3',
		'2 FORM audio/mpeg',
		'3 MEDI AUDIO',
		'1 UID 69ebdd0e-c78c-4b81-873f-dc8ac30a48b9',
		'1 NOTE a note in the record'
	);

	it('round trips by meaning and exports valid 7.0', async () => {
		const trip = await sevenTrip(RECORD);
		expect(trip.errors).toEqual([]);
		expect(trip.diffs).toEqual([]);
	});

	it('is one object with an unresolved row per FILE, in order, with the path as written', async () => {
		const treeId = await importIt(RECORD);
		const [object] = await objectsOf(treeId);
		expect(object).toMatchObject({ xref: '@O1@', privacy: 'private' });
		expect(object.gedcomExtra).toEqual([
			'1 RESN CONFIDENTIAL, LOCKED',
			'1 UID 69ebdd0e-c78c-4b81-873f-dc8ac30a48b9',
			'1 NOTE a note in the record'
		]);
		const files = await filesOf(treeId);
		expect(files.map((f) => f.gedcomPath)).toEqual(['media/one%20a.jpg', 'file:///path/two.mp3']);
		expect(files.map((f) => f.sortOrder)).toEqual([0, 1]);
		for (const file of files) {
			expect(file.status).toBe('unresolved');
			expect(file.r2ObjectKey).toBe(unresolvedMediaKey(file.id));
			expect(file.sizeBytes).toBeNull();
			expect(objectIdOf(file)).toBe(object.id);
		}
		expect(files[0]).toMatchObject({
			mimeType: 'image/jpeg',
			medium: 'OTHER',
			title: 'First file',
			gedcomExtra: ['4 PHRASE Portrait', '2 TRAN media/derived.oga', '3 FORM audio/ogg']
		});
		expect(files[1]).toMatchObject({ mimeType: 'audio/mpeg', medium: 'AUDIO', title: null });
		// The first file takes the object's id, as an upload does until the contract migrations.
		expect(files[0].id).toBe(object.id);
	});

	it('links the person and the fact, with the crop and titles', async () => {
		const treeId = await importIt(RECORD);
		const [object] = await objectsOf(treeId);
		const links = await linksOf(treeId);
		const onPerson = links.find((l) => l.factId === null)!;
		expect(onPerson).toMatchObject({
			mediaId: object.id,
			entityId: `${treeId}:@I1@`,
			cropTop: 1,
			cropLeft: 2,
			cropHeight: 30,
			cropWidth: 40,
			title: 'Ann smiling',
			sortOrder: 0
		});
		const onFact = links.find((l) => l.factId !== null)!;
		expect(onFact).toMatchObject({
			entityId: `${treeId}:@I1@`,
			title: 'Birth portrait',
			cropTop: null
		});
		expect(onFact.id).toBe(`${object.id}:${onFact.entityId}:${onFact.factId}`);
	});

	it('keeps a pointer to @VOID@ or to a missing record on its host', async () => {
		const original = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'1 OBJE @VOID@',
			'2 TITL Nowhere',
			'1 OBJE @GONE@',
			'1 BIRT',
			'2 OBJE @VOID@',
			'0 @F1@ FAM',
			'1 HUSB @I1@',
			'1 OBJE @VOID@'
		);
		const treeId = await importIt(original);
		expect(await linksOf(treeId)).toEqual([]);
		const out = lines(buildGedcom7String(await getTreeExportData(t.d1, treeId)));
		expect(out).toContain('1 OBJE @VOID@');
		expect(out).toContain('2 TITL Nowhere');
		expect(out).toContain('2 OBJE @VOID@');
	});

	it('keeps a second pointer to the same object from the same host and fact as a line', async () => {
		const original = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'1 OBJE @O1@',
			'2 CROP',
			'3 TOP 0',
			'1 OBJE @O1@',
			'2 CROP',
			'3 TOP 50',
			'1 BIRT',
			'2 OBJE @O1@',
			'0 @O1@ OBJE',
			'1 FILE a.png',
			'2 FORM image/png'
		);
		const treeId = await importIt(original);
		expect(await linksOf(treeId)).toHaveLength(2);
		const trip = await sevenTrip(original);
		expect(trip.diffs).toEqual([]);
		expect(trip.errors).toEqual([]);
	});

	it('keeps a bare CROP, an odd CROP and extension lines under a pointer', async () => {
		const original = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'1 OBJE @O1@',
			'2 CROP',
			'1 OBJE @O2@',
			'2 CROP',
			'3 TOP 5',
			'4 _NOTE odd',
			'0 @O1@ OBJE',
			'1 FILE a.png',
			'2 FORM image/png',
			'0 @O2@ OBJE',
			'1 FILE b.png',
			'2 FORM image/png'
		);
		const trip = await sevenTrip(original);
		expect(trip.diffs).toEqual([]);
		expect(trip.errors).toEqual([]);
		const links = await linksOf(trip.treeId);
		expect(links.every((l) => l.cropTop === null)).toBe(true);
	});
});

describe('a citation-level or submitter-level OBJE', () => {
	it('stays a retained line, remapped to the object, and the object is detached', async () => {
		const original = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'1 SOUR @S1@',
			'2 PAGE 3',
			'2 OBJE @O1@',
			'0 @S1@ SOUR',
			'1 TITL Register',
			'0 @O1@ OBJE',
			'1 FILE scan.png',
			'2 FORM image/png',
			'0 @U1@ SUBM',
			'1 NAME Sam',
			'1 OBJE @O1@'
		);
		const trip = await sevenTrip(original);
		expect(trip.diffs).toEqual([]);
		expect(trip.errors).toEqual([]);
		expect(await linksOf(trip.treeId)).toEqual([]);
		expect(await objectsOf(trip.treeId)).toHaveLength(1);
		expect(lines(trip.exported)).toContain('2 OBJE @O1@');
	});
});

describe('embedded 5.5.1 OBJE', () => {
	const THREE = gedcom(
		HEAD551,
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 OBJE',
		'2 FILE C:\\Photos\\Family Day.jpg',
		'3 FORM jpg',
		'4 TYPE photo',
		'3 TITL Family day',
		'0 @I2@ INDI',
		'1 NAME Bo /Ash/',
		'1 OBJE',
		'2 FILE C:\\Photos\\Family Day.jpg',
		'3 FORM jpg',
		'4 TYPE photo',
		'3 TITL Family day',
		'1 BIRT',
		'2 OBJE',
		'3 FILE C:/Photos/Family Day.jpg',
		'4 FORM jpg',
		'5 TYPE photo',
		'4 TITL At the christening',
		'0 @I3@ INDI',
		'1 NAME Cy /Ash/',
		'1 OBJE',
		'2 FILE c:\\photos\\family day.jpg',
		'3 FORM jpg'
	);

	it('merges copies with the same first path into one object with a link each', async () => {
		const treeId = await importIt(THREE);
		const objects = await objectsOf(treeId);
		// Three people share one photo; the lower-case path differs in case, so it is its own object.
		expect(objects).toHaveLength(2);
		expect(objects.every((o) => o.xref === null)).toBe(true);
		const files = await filesOf(treeId);
		expect(files.map((f) => f.gedcomPath).sort()).toEqual([
			'C:\\Photos\\Family Day.jpg',
			'c:\\photos\\family day.jpg'
		]);
		const shared = objects.find((o) => o.id === files.find((f) => f.title === 'Family day')!.id)!;
		const links = (await linksOf(treeId)).filter((l) => l.mediaId === shared.id);
		// The person and the fact are two links, so Bo has both.
		expect(links.map((l) => l.entityId).sort()).toEqual([
			`${treeId}:@I1@`,
			`${treeId}:@I2@`,
			`${treeId}:@I2@`
		]);
		// A differing title is the link's, on the fact's copy.
		expect(links.filter((l) => l.title !== null).map((l) => l.title)).toEqual([
			'At the christening'
		]);
		const fileOfShared = files.find((f) => f.id === shared.id)!;
		expect(fileOfShared).toMatchObject({ mimeType: 'image/jpeg', medium: 'photo' });
	});

	it('merges across three people when only the case-equal copies are the same', async () => {
		const text = gedcom(
			HEAD551,
			...['@I1@', '@I2@', '@I3@'].flatMap((id) => [
				`0 ${id} INDI`,
				'1 OBJE',
				'2 FILE photos/group.png',
				'3 FORM png'
			])
		);
		const treeId = await importIt(text);
		expect(await objectsOf(treeId)).toHaveLength(1);
		expect(await filesOf(treeId)).toHaveLength(1);
		expect(await linksOf(treeId)).toHaveLength(3);
		const exported = lines(buildGedcom7String(await getTreeExportData(t.d1, treeId)));
		expect(validateGedcom7(exported.join('\n')).errors).toEqual([]);
		expect(exported.filter((l) => l === '1 OBJE @O1@')).toHaveLength(3);
		expect(exported.filter((l) => l === '0 @O1@ OBJE')).toHaveLength(1);
		expect(exported.filter((l) => l.startsWith('1 FILE'))).toEqual(['1 FILE photos/group.png']);
	});

	it('does not merge copies that say more than the first', async () => {
		const text = gedcom(
			HEAD551,
			'0 @I1@ INDI',
			'1 OBJE',
			'2 FILE g.png',
			'3 FORM png',
			'0 @I2@ INDI',
			'1 OBJE',
			'2 FILE g.png',
			'3 FORM png',
			'2 NOTE only on this copy'
		);
		const treeId = await importIt(text);
		expect(await objectsOf(treeId)).toHaveLength(2);
		const exported = lines(buildGedcom7String(await getTreeExportData(t.d1, treeId)));
		expect(exported).toContain('1 NOTE only on this copy');
	});

	it('keeps a Windows path byte-exact in 5.5.1 and converts it in 7.0', async () => {
		const text = gedcom(
			HEAD551,
			'0 @I1@ INDI',
			'1 NAME Ann /Ash/',
			'1 OBJE',
			'2 FILE C:\\Photos\\Family Day.jpg',
			'3 FORM jpg',
			'3 TITL Family day'
		);
		const treeId = await importIt(text);
		const [file] = await filesOf(treeId);
		expect(file.gedcomPath).toBe('C:\\Photos\\Family Day.jpg');
		const data = await getTreeExportData(t.d1, treeId);
		expect(lines(buildGedcom551String(data))).toContain('1 FILE C:\\Photos\\Family Day.jpg');
		const seven = buildGedcom7String(data);
		expect(lines(seven)).toContain('1 FILE file:///C:/Photos/Family%20Day.jpg');
		expect(validateGedcom7(seven).errors).toEqual([]);
	});

	it('gives a missing or non-media FORM the type the path implies', async () => {
		const text = gedcom(
			HEAD551,
			'0 @I1@ INDI',
			'1 OBJE',
			'2 FILE a.pdf',
			'1 OBJE',
			'2 FILE b.xyz',
			'3 FORM stuff'
		);
		const treeId = await importIt(text);
		expect((await filesOf(treeId)).map((f) => f.mimeType).sort()).toEqual([
			'application/octet-stream',
			'application/pdf'
		]);
	});

	it('takes a 5.5 OBJE-level TITL and FORM for the first file', async () => {
		const text = gedcom(
			HEAD551,
			'0 @M1@ OBJE',
			'1 FORM gif',
			'1 TITL Old style',
			'1 FILE old.gif',
			'0 @I1@ INDI',
			'1 OBJE @M1@'
		);
		const treeId = await importIt(text);
		const [file] = await filesOf(treeId);
		expect(file).toMatchObject({ title: 'Old style', mimeType: 'image/gif' });
	});

	it('reads a 5.5.1 record with its pointers and exports it in both dialects', async () => {
		const text = gedcom(
			HEAD551,
			'0 @I1@ INDI',
			'1 NAME Ann /Ash/',
			'1 OBJE @M1@',
			'0 @M1@ OBJE',
			'1 FILE photos/ann.jpg',
			'2 FORM jpg',
			'3 TYPE photo',
			'2 TITL Ann',
			'1 NOTE a note'
		);
		const treeId = await importIt(text);
		const data = await getTreeExportData(t.d1, treeId);
		const five = lines(buildGedcom551String(data));
		expect(five).toEqual(
			expect.arrayContaining([
				'1 OBJE @M1@',
				'0 @M1@ OBJE',
				'1 FILE photos/ann.jpg',
				'2 FORM jpg',
				'3 TYPE photo',
				'2 TITL Ann',
				'1 NOTE a note'
			])
		);
		expect(lines(buildGedcom7String(data))).toEqual(
			expect.arrayContaining(['3 MEDI PHOTO', '2 FORM image/jpeg'])
		);
	});
});

describe('5.5.1 export of a 7.0 pointer', () => {
	it('drops the CROP and the link title and keeps the pointer', async () => {
		const original = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'1 OBJE @O1@',
			'2 CROP',
			'3 TOP 1',
			'3 WIDTH 5',
			'2 TITL Cropped',
			'1 BIRT',
			'2 OBJE @O1@',
			'3 CROP',
			'0 @O1@ OBJE',
			'1 FILE a.png',
			'2 FORM image/png',
			'3 MEDI PHOTO',
			'2 TITL File title'
		);
		const treeId = await importIt(original);
		const five = lines(buildGedcom551String(await getTreeExportData(t.d1, treeId)));
		expect(five).toContain('1 OBJE @O1@');
		expect(five).toContain('2 OBJE @O1@');
		expect(five.some((l) => /CROP|TOP|WIDTH|Cropped/.test(l))).toBe(false);
		expect(five).toContain('2 TITL File title');
		expect(five).toContain('3 TYPE PHOTO');
	});
});

describe('importing again', () => {
	const FILE = gedcom(
		HEAD7,
		'0 @I1@ INDI',
		'1 OBJE @O1@',
		'0 @O1@ OBJE',
		'1 FILE a.png',
		'2 FORM image/png'
	);

	it('merge mode matches an object by xref and adds nothing twice', async () => {
		const treeId = await importIt(FILE);
		await importGedcomToDb(t.d1, treeId, FILE, 'Media', 'merge');
		expect(await objectsOf(treeId)).toHaveLength(1);
		expect(await filesOf(treeId)).toHaveLength(1);
		expect(await linksOf(treeId)).toHaveLength(1);
	});

	it('merge mode matches by the first file path, and adds the file and link it lacks', async () => {
		const treeId = await importIt(FILE);
		const again = gedcom(
			HEAD7,
			'0 @I1@ INDI',
			'0 @I2@ INDI',
			'1 OBJE @X9@',
			'0 @X9@ OBJE',
			'1 FILE a.png',
			'2 FORM image/png',
			'1 FILE b.png',
			'2 FORM image/png'
		);
		await importGedcomToDb(t.d1, treeId, again, 'Media', 'merge');
		const objects = await objectsOf(treeId);
		expect(objects).toHaveLength(1);
		expect(objects[0].xref).toBe('@O1@');
		expect((await filesOf(treeId)).map((f) => f.gedcomPath)).toEqual(['a.png', 'b.png']);
		expect((await linksOf(treeId)).map((l) => l.entityId).sort()).toEqual([
			`${treeId}:@I1@`,
			`${treeId}:@I2@`
		]);
	});

	it('replace mode deletes the objects, files and links, and the bytes of resolved files', async () => {
		const treeId = await importIt(FILE);
		const key = `media/${treeId}/stale.png`;
		const objectId = crypto.randomUUID();
		await t.db.insert(mediaObjects).values({ id: objectId, treeId });
		await t.db.insert(mediaItems).values({
			id: objectId,
			treeId,
			objectId,
			r2ObjectKey: key,
			mimeType: 'image/png',
			sizeBytes: 3
		});
		const bucket = new FakeMediaBucket();
		await bucket.put(key, new Uint8Array([1, 2, 3]));
		const service = new GedcomService(getDb(t.d1), { bucket: bucket as never });
		await service.runImport(treeId, FILE, 'Media', 'replace');
		expect(await objectsOf(treeId)).toHaveLength(1);
		const files = await filesOf(treeId);
		expect(files.map((f) => f.gedcomPath)).toEqual(['a.png']);
		expect(files[0].id).not.toBe(objectId);
		expect(bucket.objects.has(key)).toBe(false);
	});
});

describe('the official media files', () => {
	it('keeps every FILE of obje-1 in order with its pointers', async () => {
		const original = gedcom(
			HEAD7,
			'0 @1@ OBJE',
			'1 FILE example.jpg',
			'2 FORM image/jpeg',
			'3 MEDI PHOTO',
			'2 TITL Example Image File',
			'1 FILE example.mp3',
			'2 FORM application/x-mp3',
			'2 TITL Sound Clip',
			'1 NOTE note in OBJE record',
			'0 @X1@ OBJE',
			'1 FILE gifts.webm',
			'2 FORM application/x-other',
			'3 MEDI VIDEO',
			'1 NOTE note in OBJE link',
			'0 @2@ INDI',
			'1 OBJE @1@',
			'1 OBJE @X1@',
			'2 TITL fifth birthday party'
		);
		const trip = await sevenTrip(original);
		expect(trip.errors).toEqual([]);
		expect(trip.diffs).toEqual([]);
		const links = await linksOf(trip.treeId);
		expect(links.map((l) => l.sortOrder).sort()).toEqual([0, 1]);
	});
});
