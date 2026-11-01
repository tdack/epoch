import type { R2Bucket } from '@cloudflare/workers-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaItems, mediaObjects } from '../db/schema';
import { crc32 } from '../gedcom/crc32';
import { importGedcomToDb, getTreeExportData } from '../testing/gedcom';
import { semanticDiff } from '../gedcom/semantic-diff';
import { readCentralDirectory, openEntry, type ZipSource } from '../gedcom/zip-reader';
import { unpackGedzip } from '../gedcom/gedzip';
import { buildGedcom7String } from '../gedcom/serializer';
import { deleteExport, openSegmentedExport } from '../http/export-storage';
import { FakeMediaBucket } from '../testing/fake-bucket';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import {
	buildExportInstanceId,
	exportPartsPrefix,
	parseExportInstanceId
} from '../workflows/export-instance';
import { GdzExportService } from './gdz-export-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const GED = `0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME Ann /Ash/
1 BIRT
2 DATE 1900
0 TRLR
`;

const bytesOf = (text: string) => new TextEncoder().encode(text);

async function setup(fileCount: number) {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	await importGedcomToDb(t.d1, treeId, GED, 'Gdz tree');
	const bucket = new FakeMediaBucket();
	const files: Array<{ id: string; bytes: Uint8Array; key: string }> = [];
	for (let i = 0; i < fileCount; i++) {
		const id = `${i.toString(16).padStart(8, '0')}-${crypto.randomUUID().slice(9)}`;
		const bytes = bytesOf(`file number ${i} `.repeat(i + 1));
		const key = `media/${treeId}/${id}.png`;
		await bucket.put(key, bytes);
		await t.db.insert(mediaObjects).values({ id, treeId, xref: `@O${i}@` });
		await t.db.insert(mediaItems).values({
			id,
			treeId,
			objectId: id,
			r2ObjectKey: key,
			// The first has a stored path and a known CRC; the rest take made-up names and compute theirs.
			gedcomPath: i === 0 ? 'photos/a%20b.png' : null,
			title: `Photo ${i}`,
			mimeType: 'image/png',
			sizeBytes: bytes.byteLength,
			crc32: i === 0 ? crc32(bytes) : null
		});
		files.push({ id, bytes, key });
	}
	const clientUuid = crypto.randomUUID();
	const instanceId = buildExportInstanceId(treeId, 'gedcom7', true, clientUuid, true);
	const service = new GdzExportService(t.db, bucket as unknown as R2Bucket);
	return { owner, treeId, bucket, files, clientUuid, instanceId, service };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function runAll(s: Setup) {
	const lengths: number[] = [];
	const dataset = await s.service.writeDataset(s.treeId, s.owner.userId, s.clientUuid);
	lengths.push(dataset.length);
	for (let i = 0; i < dataset.batchCount; i++) {
		const offset = lengths.reduce((a, b) => a + b, 0);
		const { length } = await s.service.writeMediaBatch(
			s.treeId,
			s.owner.userId,
			s.clientUuid,
			i,
			offset
		);
		lengths.push(length);
	}
	await s.service.writeTail(s.treeId, s.owner.userId, s.clientUuid, lengths);
	return dataset;
}

async function download(s: Setup) {
	const parsed = parseExportInstanceId(s.instanceId)!;
	const { body, length, filename } = await openSegmentedExport(
		s.bucket as unknown as R2Bucket,
		parsed
	);
	const bytes = new Uint8Array(await new Response(body).arrayBuffer());
	return { bytes, length, filename };
}

const sourceOf = (bytes: Uint8Array): ZipSource => ({
	size: bytes.byteLength,
	readRange: async (offset, length) => bytes.slice(offset, offset + length),
	readStream: async (offset, length) =>
		new Blob([bytes.slice(offset, offset + length)]).stream() as ReadableStream<Uint8Array>
});

describe('GdzExportService', () => {
	it('writes a gdz that reads back with verified CRCs, named by the FILE lines', async () => {
		const s = await setup(3);
		await runAll(s);
		const { bytes, length, filename } = await download(s);
		expect(length).toBe(bytes.byteLength);
		expect(filename).toMatch(/^Test_tree_\w+\.gdz$/);

		const source = sourceOf(bytes);
		const directory = await readCentralDirectory(source);
		const names = directory.entries.map((e) => e.name);
		expect(names).toEqual([
			'gedcom.ged',
			'photos/a b.png',
			`media/photo-1-${s.files[1].id.slice(0, 8)}.png`,
			`media/photo-2-${s.files[2].id.slice(0, 8)}.png`
		]);
		for (const [i, name] of names.slice(1).entries()) {
			const entry = directory.entries.find((e) => e.name === name)!;
			const stream = await openEntry(source, entry);
			const read = new Uint8Array(await new Response(stream).arrayBuffer());
			expect(read).toEqual(s.files[i].bytes);
		}

		const ged = new TextDecoder().decode(unpackGedzip(bytes));
		const fileLines = ged.split(/\r?\n/).filter((l) => l.startsWith('1 FILE'));
		expect(fileLines).toEqual([
			'1 FILE photos/a%20b.png',
			`1 FILE media/photo-1-${s.files[1].id.slice(0, 8)}.png`,
			`1 FILE media/photo-2-${s.files[2].id.slice(0, 8)}.png`
		]);
	});

	it('round-trips the dataset', async () => {
		const s = await setup(2);
		await runAll(s);
		const { bytes } = await download(s);
		const ged = new TextDecoder().decode(unpackGedzip(bytes));
		const again = buildGedcom7String(await getTreeExportData(t.d1, s.treeId));
		// The archive's FILE lines are entry names, so only they may differ from a plain export.
		const diff = semanticDiff(again, ged);
		expect(diff.recordsMissing).toEqual([]);
		expect(diff.recordsAdded).toEqual([]);
		expect(diff.changes.every((c) => c.path.endsWith('FILE'))).toBe(true);
	});

	it('leaves a file deleted between steps out of the archive, which stays valid', async () => {
		const s = await setup(101);
		const dataset = await s.service.writeDataset(s.treeId, s.owner.userId, s.clientUuid);
		expect(dataset.batchCount).toBe(2);
		const last = s.files[100];
		s.bucket.objects.delete(last.key);
		const lengths = [dataset.length];
		for (let i = 0; i < 2; i++) {
			const offset = lengths.reduce((a, b) => a + b, 0);
			lengths.push(
				(await s.service.writeMediaBatch(s.treeId, s.owner.userId, s.clientUuid, i, offset)).length
			);
		}
		expect(lengths[2]).toBe(0);
		await s.service.writeTail(s.treeId, s.owner.userId, s.clientUuid, lengths);

		const { bytes } = await download(s);
		const directory = await readCentralDirectory(sourceOf(bytes));
		expect(directory.entries).toHaveLength(101);
		for (const entry of directory.entries.slice(1)) {
			await new Response(await openEntry(sourceOf(bytes), entry)).arrayBuffer();
		}
	});

	it('writes identical bytes when a media step is retried', async () => {
		const s = await setup(3);
		const dataset = await s.service.writeDataset(s.treeId, s.owner.userId, s.clientUuid);
		const key = `${exportPartsPrefix(s.treeId, s.clientUuid)}part-1`;
		await s.service.writeMediaBatch(s.treeId, s.owner.userId, s.clientUuid, 0, dataset.length);
		const first = s.bucket.objects.get(key)!.body.slice();
		await s.service.writeMediaBatch(s.treeId, s.owner.userId, s.clientUuid, 0, dataset.length);
		expect(s.bucket.objects.get(key)!.body).toEqual(first);
	});

	it('refuses a requester who may not export, before writing anything', async () => {
		const s = await setup(1);
		const other = await createTestUser(t.db);
		await expect(s.service.writeDataset(s.treeId, other.userId, s.clientUuid)).rejects.toThrow(
			/Forbidden|not a member|Unauthorized|insufficient/i
		);
		await expect(s.service.writeDataset(s.treeId, undefined, s.clientUuid)).rejects.toThrow();
		expect([...s.bucket.objects.keys()].filter((k) => k.startsWith('exports/'))).toEqual([]);
	});

	it('deletes every part once expired, and answers expired', async () => {
		const s = await setup(2);
		await runAll(s);
		const manifestKey = [...s.bucket.objects.keys()].find(
			(k) => k.endsWith('.json') && !k.includes('part') && !k.includes('plan')
		)!;
		s.bucket.objects.get(manifestKey)!.customMetadata = {
			uploadedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString()
		};
		const parsed = parseExportInstanceId(s.instanceId)!;
		await expect(openSegmentedExport(s.bucket as unknown as R2Bucket, parsed)).rejects.toThrow();
		expect([...s.bucket.objects.keys()].filter((k) => k.startsWith('exports/'))).toEqual([]);
	});

	it('deleteExport removes the parts of an unfinished export', async () => {
		const s = await setup(2);
		await s.service.writeDataset(s.treeId, s.owner.userId, s.clientUuid);
		expect(s.bucket.objects.size).toBeGreaterThan(2);
		const exportKeys = () => [...s.bucket.objects.keys()].filter((k) => k.startsWith('exports/'));
		expect(exportKeys().length).toBe(3);
		await deleteExport(s.bucket as unknown as R2Bucket, parseExportInstanceId(s.instanceId)!);
		expect(exportKeys()).toEqual([]);
	});
});
