import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, trees } from '../db/schema';
import {
	NotAdmittedError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GedcomService, type ImportFile, type ImportQueueMessage } from './gedcom-service';
import { buildExportInstanceId } from '../workflows/export-instance';

const FILE = '0 HEAD\n0 @I1@ INDI\n1 NAME Ann /Fox/\n0 @I2@ INDI\n1 NAME Ben /Fox/\n0 TRLR';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/** An R2 stand-in that keeps what is put in it. */
function fakeBucket() {
	const objects = new Map<
		string,
		{
			value: string | Uint8Array;
			options?: { httpMetadata?: unknown; customMetadata?: Record<string, string> };
		}
	>();
	const bucket = {
		put: async (
			key: string,
			value: string | Uint8Array,
			options?: { httpMetadata?: unknown; customMetadata?: Record<string, string> }
		) => {
			objects.set(key, { value, options });
		},
		get: async (key: string) => {
			const found = objects.get(key);
			return found ? { text: async () => found.value } : null;
		},
		delete: async (key: string) => {
			objects.delete(key);
		}
	};
	return { objects, bucket: bucket as unknown as R2Bucket };
}

const fileOf = (overrides: Partial<ImportFile> = {}): ImportFile => ({
	treeId: null,
	treeName: null,
	fileName: 'Fox family.ged',
	text: FILE,
	sizeBytes: FILE.length,
	mode: 'replace',
	shouldMergeDuplicateFamilies: false,
	...overrides
});

async function tree(role?: 'viewer' | 'editor') {
	const owner = await createTestUser(t.db);
	const treeId = await createTestTree(t.db, owner);
	const member = await createTestUser(t.db);
	if (role) await addTestMember(t.db, treeId, member, role);
	return { owner, member, treeId };
}

describe('importFile', () => {
	it('creates a tree for a file with no tree, named from the file, and imports into it', async () => {
		const caller = await createTestUser(t.db);
		const context = { ...caller.context, user: { ...caller.context.user, isInstallOwner: true } };
		const outcome = await new GedcomService(t.db).importFile(fileOf(), context);
		expect(outcome).toMatchObject({ status: 'complete', individualsCount: 2 });
		const created = await t.db.select().from(trees).where(eq(trees.id, outcome.treeId)).get();
		expect(created?.name).toBe('Fox family');
	});

	it('refuses to start a tree for someone who may not create one (ADR-034)', async () => {
		const caller = await createTestUser(t.db);
		await expect(
			new GedcomService(t.db).importFile(fileOf(), caller.context)
		).rejects.toBeInstanceOf(NotAdmittedError);
	});

	it('refuses a viewer, and a stranger, before writing anything', async () => {
		const s = await tree('viewer');
		const stranger = await createTestUser(t.db);
		for (const actor of [s.member, stranger]) {
			await expect(
				new GedcomService(t.db).importFile(fileOf({ treeId: s.treeId }), actor.context)
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
		expect(await t.db.select().from(individuals).where(eq(individuals.treeId, s.treeId))).toEqual(
			[]
		);
	});

	it('lets an editor import into the tree', async () => {
		const s = await tree('editor');
		const outcome = await new GedcomService(t.db).importFile(
			fileOf({ treeId: s.treeId }),
			s.member.context
		);
		expect(outcome).toMatchObject({ status: 'complete', treeId: s.treeId });
	});

	it('stages a large file in R2 and queues exactly what the consumer will import', async () => {
		const s = await tree();
		const { objects, bucket } = fakeBucket();
		const sent: ImportQueueMessage[] = [];
		const service = new GedcomService(t.db, {
			bucket,
			queue: { send: async (message: ImportQueueMessage) => void sent.push(message) }
		});
		const outcome = await service.importFile(
			fileOf({
				treeId: s.treeId,
				treeName: 'Foxes',
				sizeBytes: 3 * 1024 * 1024,
				mode: 'merge',
				shouldMergeDuplicateFamilies: true
			}),
			s.owner.context
		);
		expect(outcome).toEqual({ status: 'queued', treeId: s.treeId });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			treeId: s.treeId,
			treeName: 'Foxes',
			mode: 'merge',
			shouldMergeDuplicateFamilies: true
		});
		expect(objects.has(sent[0]!.r2ObjectKey)).toBe(true);
		// Nothing is written until the consumer runs.
		expect(await t.db.select().from(individuals).where(eq(individuals.treeId, s.treeId))).toEqual(
			[]
		);

		expect(await service.importStaged(sent[0]!)).toBe(true);
		expect(
			(await t.db.select().from(individuals).where(eq(individuals.treeId, s.treeId))).length
		).toBe(2);
		expect(objects.size).toBe(0);
	});

	it('imports a large file in the request when the queue is not bound', async () => {
		const s = await tree();
		const outcome = await new GedcomService(t.db, { bucket: fakeBucket().bucket }).importFile(
			fileOf({ treeId: s.treeId, sizeBytes: 3 * 1024 * 1024 }),
			s.owner.context
		);
		expect(outcome.status).toBe('complete');
	});

	it('reports a staged file that is gone, so the consumer can drop the message', async () => {
		const s = await tree();
		const service = new GedcomService(t.db, { bucket: fakeBucket().bucket });
		expect(await service.importStaged({ treeId: s.treeId, r2ObjectKey: 'staging/none.ged' })).toBe(
			false
		);
	});
});

describe('previewImport', () => {
	it('needs the import right, because it reads the tree to compare', async () => {
		const s = await tree('viewer');
		await expect(
			new GedcomService(t.db).previewImport(s.treeId, FILE, s.member.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			new GedcomService(t.db).previewImport(s.treeId, FILE, s.owner.context)
		).resolves.toMatchObject({ incoming: { individuals: 2 } });
	});
});

describe('export', () => {
	it('names a download and the stored copy alike, by the tree', async () => {
		const s = await tree();
		await t.db.update(trees).set({ name: 'Fox / family: 1900' }).where(eq(trees.id, s.treeId));
		const { objects, bucket } = fakeBucket();
		const service = new GedcomService(t.db, { bucket });

		const download = await service.exportDownload(
			s.treeId,
			{ format: 'gedcom551' },
			s.owner.context
		);
		expect(download.filename).toBe('Fox___family__1900.ged');
		expect(download.content).toContain('0 HEAD');

		const clientUuid = crypto.randomUUID();
		const key = await service.storeExport(
			s.treeId,
			'Fox / family: 1900',
			'0 HEAD\n0 TRLR',
			'g551',
			clientUuid
		);
		expect(key).toBe(`exports/${s.treeId}-g551-${clientUuid}.ged`);
		expect(objects.get(key)?.options).toMatchObject({
			httpMetadata: {
				contentType: 'text/vnd.familysearch.gedcom',
				contentDisposition: 'attachment; filename="Fox___family__1900.ged"'
			},
			customMetadata: { uploadedAt: expect.any(String) }
		});
	});

	it('packages a 7.0 file as GEDZip with gedcom.ged inside, in a download and in R2', async () => {
		const s = await tree();
		await t.db.update(trees).set({ name: 'Fox' }).where(eq(trees.id, s.treeId));
		const { objects, bucket } = fakeBucket();
		const service = new GedcomService(t.db, { bucket });
		const options = { format: 'gedcom7', shouldCompress: true } as const;

		const download = await service.exportDownload(s.treeId, options, s.owner.context);
		expect(download.filename).toBe('Fox.gdz');
		expect(download.contentType).toBe('application/vnd.familysearch.gedcom+zip');
		const entries = unzipSync(download.content as Uint8Array);
		expect(Object.keys(entries)).toEqual(['gedcom.ged']);
		expect(strFromU8(entries['gedcom.ged'])).toContain('2 VERS 7.0');

		const clientUuid = crypto.randomUUID();
		const key = await service.storeExport(s.treeId, 'Fox', '0 HEAD\n0 TRLR', 'g7z', clientUuid);
		expect(key).toBe(`exports/${s.treeId}-g7z-${clientUuid}.gdz`);
		expect(objects.get(key)?.options).toMatchObject({
			httpMetadata: { contentDisposition: 'attachment; filename="Fox.gdz"' },
			customMetadata: { uploadedAt: expect.any(String) }
		});
	});

	it('refuses a GEDZip of a 5.5.1 file, which the format does not define', async () => {
		const s = await tree();
		await expect(
			new GedcomService(t.db).exportDownload(
				s.treeId,
				{ format: 'gedcom551', shouldCompress: true },
				s.owner.context
			)
		).rejects.toBeInstanceOf(ValidationError);
	});

	it('is a manager’s action', async () => {
		const s = await tree('editor');
		await expect(
			new GedcomService(t.db).exportDownload(s.treeId, { format: 'gedcom7' }, s.member.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('refuses a workflow job with no requester, or whose requester lost the role', async () => {
		const s = await tree('editor');
		const service = new GedcomService(t.db);
		await expect(service.requireExporter(s.treeId, undefined)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(service.requireExporter(s.treeId, s.member.userId)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(service.requireExporter(s.treeId, s.owner.userId)).resolves.toBeUndefined();
	});
});

describe('requireExportInstance', () => {
	it('answers the same 404 for an id it never minted and for a stranger’s tree', async () => {
		const s = await tree();
		const stranger = await createTestUser(t.db);
		const service = new GedcomService(t.db);
		await expect(
			service.requireExportInstance('not-an-id', s.owner.context)
		).rejects.toBeInstanceOf(NotFoundError);
		const foreign = buildExportInstanceId(
			crypto.randomUUID(),
			'gedcom7',
			false,
			crypto.randomUUID()
		);
		await expect(service.requireExportInstance(foreign, stranger.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		const realTreeId = buildExportInstanceId(s.treeId, 'gedcom7', false, crypto.randomUUID());
		await expect(
			service.requireExportInstance(realTreeId, stranger.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it('refuses a member who may not export, and never reads R2 to do it', async () => {
		const s = await tree('editor');
		const { bucket } = fakeBucket();
		const explosive = {
			...bucket,
			get: async () => {
				throw new Error('requireExportInstance must not read R2');
			}
		} as unknown as R2Bucket;
		const service = new GedcomService(t.db, { bucket: explosive });
		const id = buildExportInstanceId(s.treeId, 'gedcom7', false, crypto.randomUUID());
		await expect(service.requireExportInstance(id, s.member.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});

	it('returns the parsed id for a manager', async () => {
		const s = await tree();
		const clientUuid = crypto.randomUUID();
		const id = buildExportInstanceId(s.treeId, 'gedcom7', true, clientUuid);
		await expect(
			new GedcomService(t.db).requireExportInstance(id, s.owner.context)
		).resolves.toMatchObject({ treeId: s.treeId, token: 'g7z', clientUuid, shouldCompress: true });
	});
});

describe('countIndividuals', () => {
	it('counts the people a tree holds, and nothing from another tree', async () => {
		const s = await tree();
		const service = new GedcomService(t.db);
		expect(await service.countIndividuals(s.treeId)).toBe(0);
		await service.runImport(s.treeId, FILE, 'Fox');
		expect(await service.countIndividuals(s.treeId)).toBe(2);
		const other = await tree();
		expect(await service.countIndividuals(other.treeId)).toBe(0);
	});
});
