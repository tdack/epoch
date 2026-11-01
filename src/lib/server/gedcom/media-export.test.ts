/**
 * Media records in an export (ADR-082): one `OBJE` per object with its files, a pointer under each
 * host, the `FILE` text per dialect, and what 5.5.1 has no place for.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, mediaItems, mediaLinks, mediaObjects } from '../db/schema';
import { mediaLinkId, unresolvedMediaKey } from '../../shared/media';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { exportedFileText } from './media-export';
import { buildGedcom551String, buildGedcom7String } from './serializer';
import { validateGedcom7 } from './validate7';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const FILE = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME Ann /Ash/
1 BIRT
2 DATE 1900
0 TRLR
`;

const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

async function seededTree() {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, FILE, 'Media export');
	const personId = `${treeId}:@I1@`;
	const birth = await t.db.select().from(events).where(eq(events.entityId, personId)).get();
	return { treeId, personId, factId: birth!.id };
}

describe('uploaded files in an export', () => {
	it('writes an OBJE record with a made-up relative path, and a pointer under the person and the fact', async () => {
		const { treeId, personId, factId } = await seededTree();
		const id = 'abcdef12-0000-4000-8000-000000000001';
		await t.db.insert(mediaObjects).values({ id, treeId });
		await t.db.insert(mediaItems).values({
			id,
			treeId,
			objectId: id,
			r2ObjectKey: `media/${treeId}/${id}.png`,
			title: 'Ann at the Fair',
			mimeType: 'image/png',
			sizeBytes: 5
		});
		await t.db.insert(mediaLinks).values([
			{ id: mediaLinkId(id, personId), treeId, mediaId: id, entityId: personId },
			{
				id: mediaLinkId(id, personId, factId),
				treeId,
				mediaId: id,
				entityId: personId,
				factId,
				cropTop: 1,
				cropLeft: 2,
				cropHeight: 30,
				cropWidth: 40,
				title: 'Detail'
			}
		]);

		const out = buildGedcom7String(await getTreeExportData(t.d1, treeId));
		expect(validateGedcom7(out).errors).toEqual([]);
		const rows = lines(out);
		const record = rows.slice(rows.findIndex((l) => / OBJE$/.test(l) && l.startsWith('0 ')));
		expect(record.slice(1, 4)).toEqual([
			'1 FILE media/ann-at-the-fair-abcdef12.png',
			'2 FORM image/png',
			'2 TITL Ann at the Fair'
		]);
		expect(rows).toContain('1 OBJE @O1@');
		// Under the fact, with its crop and title.
		const underBirth = rows.slice(rows.indexOf('1 BIRT'));
		expect(underBirth.slice(0, 10)).toEqual([
			'1 BIRT',
			'2 DATE 1900',
			'2 OBJE @O1@',
			'3 CROP',
			'4 TOP 1',
			'4 LEFT 2',
			'4 HEIGHT 30',
			'4 WIDTH 40',
			'3 TITL Detail',
			'1 OBJE @O1@'
		]);
		// The path is made for the export and never saved.
		const stored = await t.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get();
		expect(stored?.gedcomPath).toBeNull();
	});

	it('drops the crop and the pointer title in 5.5.1 and keeps the pointer', async () => {
		const { treeId, personId, factId } = await seededTree();
		const id = 'abcdef12-0000-4000-8000-000000000002';
		await t.db.insert(mediaObjects).values({ id, treeId });
		await t.db.insert(mediaItems).values({
			id,
			treeId,
			objectId: id,
			r2ObjectKey: `media/${treeId}/${id}.jpg`,
			title: 'Portrait',
			mimeType: 'image/jpeg',
			sizeBytes: 5
		});
		await t.db.insert(mediaLinks).values({
			id: mediaLinkId(id, personId, factId),
			treeId,
			mediaId: id,
			entityId: personId,
			factId,
			cropTop: 1,
			cropLeft: 2,
			title: 'Detail'
		});
		const out = lines(buildGedcom551String(await getTreeExportData(t.d1, treeId)));
		expect(out).toContain('2 OBJE @O1@');
		expect(out.some((l) => /CROP|TOP|LEFT|Detail/.test(l))).toBe(false);
		expect(out).toContain('1 FILE media/portrait-abcdef12.jpg');
		// 5.5.1 says a format word where 7.0 says a media type.
		expect(out).toContain('2 FORM jpg');
		expect(out).toContain('2 TITL Portrait');
	});
});

describe('unresolved files in an export', () => {
	async function withFile(path: string, extra: Partial<typeof mediaItems.$inferInsert> = {}) {
		const { treeId } = await seededTree();
		const id = crypto.randomUUID();
		await t.db.insert(mediaObjects).values({ id, treeId, xref: '@M1@' });
		await t.db.insert(mediaItems).values({
			id,
			treeId,
			objectId: id,
			status: 'unresolved',
			gedcomPath: path,
			r2ObjectKey: unresolvedMediaKey(id),
			mimeType: 'image/jpeg',
			...extra
		});
		return getTreeExportData(t.d1, treeId);
	}

	it('converts a Windows path to a file URI in 7.0 and keeps it byte-exact in 5.5.1', async () => {
		const data = await withFile('C:\\Photos\\a b.jpg');
		const seven = lines(buildGedcom7String(data));
		expect(seven).toContain('1 FILE file:///C:/Photos/a%20b.jpg');
		expect(validateGedcom7(seven.join('\n')).errors).toEqual([]);
		expect(lines(buildGedcom551String(data))).toContain('1 FILE C:\\Photos\\a b.jpg');
	});

	it('writes a bare path as a percent-encoded reference in 7.0, as written in 5.5.1', async () => {
		const data = await withFile('my photo.jpg');
		expect(lines(buildGedcom7String(data))).toContain('1 FILE my%20photo.jpg');
		expect(lines(buildGedcom551String(data))).toContain('1 FILE my photo.jpg');
	});

	it('percent-decodes a relative reference for 5.5.1 only, and leaves URIs alone in both', async () => {
		const relative = await withFile('media/a%20b.jpg');
		expect(lines(buildGedcom7String(relative))).toContain('1 FILE media/a%20b.jpg');
		expect(lines(buildGedcom551String(relative))).toContain('1 FILE media/a b.jpg');
		const url = await withFile('https://x.org/a%20b.jpg?s=1');
		expect(lines(buildGedcom7String(url))).toContain('1 FILE https://x.org/a%20b.jpg?s=1');
		expect(lines(buildGedcom551String(url))).toContain('1 FILE https://x.org/a%20b.jpg?s=1');
	});

	it('writes the kept TRAN, MEDI phrase and a second FILE of the record', async () => {
		const { treeId } = await seededTree();
		const id = crypto.randomUUID();
		const second = crypto.randomUUID();
		await t.db
			.insert(mediaObjects)
			.values({ id, treeId, xref: '@M1@', gedcomExtra: ['1 UID 69ebdd0e', '1 RESN LOCKED'] });
		await t.db.insert(mediaItems).values([
			{
				id,
				treeId,
				objectId: id,
				sortOrder: 0,
				status: 'unresolved',
				gedcomPath: 'media/one.jpg',
				r2ObjectKey: unresolvedMediaKey(id),
				mimeType: 'image/jpeg',
				medium: 'OTHER',
				title: 'First',
				gedcomExtra: ['4 PHRASE Portrait', '2 TRAN media/derived.oga', '3 FORM audio/ogg']
			},
			{
				id: second,
				treeId,
				objectId: id,
				sortOrder: 1,
				status: 'unresolved',
				gedcomPath: 'media/two.mp3',
				r2ObjectKey: unresolvedMediaKey(second),
				mimeType: 'audio/mpeg'
			}
		]);
		const out = lines(buildGedcom7String(await getTreeExportData(t.d1, treeId)));
		expect(validateGedcom7(out.join('\n')).errors).toEqual([]);
		const record = out.slice(out.indexOf('0 @M1@ OBJE'));
		expect(record.slice(0, 12)).toEqual([
			'0 @M1@ OBJE',
			'1 FILE media/one.jpg',
			'2 FORM image/jpeg',
			'3 MEDI OTHER',
			'4 PHRASE Portrait',
			'2 TITL First',
			'2 TRAN media/derived.oga',
			'3 FORM audio/ogg',
			'1 FILE media/two.mp3',
			'2 FORM audio/mpeg',
			'1 RESN LOCKED',
			'1 UID 69ebdd0e'
		]);
		// 5.5.1 has no PHRASE: its words become the TYPE.
		const five = lines(buildGedcom551String(await getTreeExportData(t.d1, treeId)));
		expect(five).toContain('3 TYPE Portrait');
		expect(five.some((l) => l.includes('PHRASE'))).toBe(false);
	});
});

describe('exportedFileText', () => {
	it('prefers the stored path and slugs the title otherwise', () => {
		const file = {
			id: '12345678-aaaa',
			gedcomPath: null,
			title: 'Héloïse & Co.',
			mimeType: 'application/pdf'
		};
		expect(exportedFileText(file)).toBe('media/heloise-co-12345678.pdf');
		expect(exportedFileText({ ...file, gedcomPath: 'x/y.pdf' })).toBe('x/y.pdf');
		expect(exportedFileText({ ...file, title: null, mimeType: 'text/x-odd' })).toBe(
			'media/file-12345678.bin'
		);
	});
});
