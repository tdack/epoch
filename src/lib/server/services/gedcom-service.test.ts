import type { R2Bucket } from '@cloudflare/workers-types';
import { and, eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, changeLog, treeMemberships, trees } from '../db/schema';
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
import { GedcomRepository } from '../repositories/gedcom-repository';
import { MAX_STAGED_BYTES_PER_TREE, STAGED_IMPORT_MAX_AGE_MS } from '../gedcom/limits';

const FILE = '0 HEAD\n0 @I1@ INDI\n1 NAME Ann /Fox/\n0 @I2@ INDI\n1 NAME Ben /Fox/\n0 TRLR';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

/**
 * An R2 stand-in that keeps what is put in it. `size` overrides the length a listing reports, so a
 * test can fill a tree's staging area to its cap without allocating the bytes.
 */
function fakeBucket() {
	const objects = new Map<
		string,
		{
			value: string | Uint8Array;
			size?: number;
			uploaded?: Date;
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
		},
		list: async (options: { prefix?: string } = {}) => ({
			truncated: false as const,
			objects: [...objects.entries()]
				.filter(([key]) => key.startsWith(options.prefix ?? ''))
				.map(([key, found]) => ({
					key,
					uploaded: found.uploaded,
					size:
						found.size ??
						(typeof found.value === 'string' ? found.value.length : found.value.byteLength)
				}))
		})
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

	it('refuses a large import once the tree has its staging cap queued, and queues nothing', async () => {
		const s = await tree();
		const { objects, bucket } = fakeBucket();
		const sent: ImportQueueMessage[] = [];
		objects.set(`staging/gedcom-${s.treeId}-earlier.ged`, {
			value: '',
			size: MAX_STAGED_BYTES_PER_TREE - 10
		});
		const service = new GedcomService(t.db, {
			bucket,
			queue: { send: async (message: ImportQueueMessage) => void sent.push(message) }
		});
		await expect(
			service.importFile(fileOf({ treeId: s.treeId, sizeBytes: 3 * 1024 * 1024 }), s.owner.context)
		).rejects.toMatchObject({ status: 413 });
		expect(sent).toHaveLength(0);
		expect(objects.size).toBe(1);
	});

	it('stops counting a staged file older than the queue keeps messages, so a crash cannot block imports for good', async () => {
		const s = await tree();
		const { objects, bucket } = fakeBucket();
		objects.set(`staging/gedcom-${s.treeId}-stuck.ged`, {
			value: '',
			size: MAX_STAGED_BYTES_PER_TREE,
			uploaded: new Date(Date.now() - STAGED_IMPORT_MAX_AGE_MS - 60_000)
		});
		const service = new GedcomService(t.db, {
			bucket,
			queue: { send: async () => {} }
		});
		const outcome = await service.importFile(
			fileOf({ treeId: s.treeId, sizeBytes: 3 * 1024 * 1024 }),
			s.owner.context
		);
		expect(outcome).toEqual({ status: 'queued', treeId: s.treeId });
	});

	it('counts only this tree’s staged files against its cap', async () => {
		const s = await tree();
		const other = await tree();
		const { objects, bucket } = fakeBucket();
		const sent: ImportQueueMessage[] = [];
		objects.set(`staging/gedcom-${other.treeId}-earlier.ged`, {
			value: '',
			size: MAX_STAGED_BYTES_PER_TREE
		});
		const service = new GedcomService(t.db, {
			bucket,
			queue: { send: async (message: ImportQueueMessage) => void sent.push(message) }
		});
		const outcome = await service.importFile(
			fileOf({ treeId: s.treeId, sizeBytes: 3 * 1024 * 1024 }),
			s.owner.context
		);
		expect(outcome).toEqual({ status: 'queued', treeId: s.treeId });
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
		expect(
			await service.importStaged({
				treeId: s.treeId,
				r2ObjectKey: `staging/gedcom-${s.treeId}-none.ged`,
				actorId: s.owner.userId
			})
		).toBe(false);
	});
});

describe('runImport', () => {
	it('leaves the tree as it was when a replace import fails part way', async () => {
		const s = await tree();
		const service = new GedcomService(t.db);
		await service.runImport(s.treeId, FILE);
		// The child the family names is not in the file, so its link fails its foreign key after the
		// people and the partnership are already queued.
		const broken =
			'0 HEAD\n0 @I7@ INDI\n1 NAME Cy /Oak/\n0 @F1@ FAM\n1 HUSB @I7@\n1 CHIL @I99@\n0 TRLR';
		await expect(service.runImport(s.treeId, broken, undefined, 'replace')).rejects.toThrow();
		const people = await t.db
			.select({ xref: individuals.xrefId })
			.from(individuals)
			.where(eq(individuals.treeId, s.treeId))
			.all();
		expect(people.map((p) => p.xref).sort()).toEqual(['@I1@', '@I2@']);
	});
});

describe('importStaged authorization', () => {
	const REPLACEMENT = '0 HEAD\n0 @I1@ INDI\n1 NAME Solo /Fox/\n0 TRLR';

	/** A tree that already holds two people, with a replace import queued by its editor. */
	async function queuedReplace() {
		const s = await tree('editor');
		await new GedcomService(t.db).runImport(s.treeId, FILE);
		const { objects, bucket } = fakeBucket();
		const key = `staging/gedcom-${s.treeId}-${crypto.randomUUID()}.ged`;
		await bucket.put(key, REPLACEMENT);
		const message: ImportQueueMessage = {
			treeId: s.treeId,
			r2ObjectKey: key,
			mode: 'replace',
			actorId: s.member.userId
		};
		const service = new GedcomService(t.db, { bucket });
		const countPeople = async () =>
			(await t.db.select().from(individuals).where(eq(individuals.treeId, s.treeId))).length;
		return { s, objects, key, message, service, countPeople };
	}

	it.each([
		['a media object', () => 'media/someone-elses-photo.jpg'],
		["another tree's staging file", () => 'staging/gedcom-other-tree-1.ged'],
		[
			'a key that climbs out of staging',
			(treeId: string) => `staging/gedcom-${treeId}-/../../exports/x.ged`
		]
	])('refuses a message naming %s, and deletes nothing', async (_label, keyFor) => {
		const q = await queuedReplace();
		const key = keyFor(q.s.treeId);
		q.objects.set(key, { value: 'precious' });
		await expect(q.service.importStaged({ ...q.message, r2ObjectKey: key })).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		expect(q.objects.has(key)).toBe(true);
		expect(await q.countPeople()).toBe(2);
	});

	it('writes nothing for an editor whose access was revoked after queueing', async () => {
		const q = await queuedReplace();
		const message = q.message;
		await t.db
			.delete(treeMemberships)
			.where(
				and(eq(treeMemberships.treeId, q.s.treeId), eq(treeMemberships.userId, q.s.member.userId))
			);
		await expect(q.service.importStaged(message)).rejects.toBeInstanceOf(UnauthorizedError);
		expect(await q.countPeople()).toBe(2);
		expect(q.objects.has(q.key)).toBe(false);
	});

	it('writes nothing for an editor demoted to viewer after queueing', async () => {
		const q = await queuedReplace();
		const message = q.message;
		await t.db
			.update(treeMemberships)
			.set({ role: 'viewer' })
			.where(
				and(eq(treeMemberships.treeId, q.s.treeId), eq(treeMemberships.userId, q.s.member.userId))
			);
		await expect(q.service.importStaged(message)).rejects.toBeInstanceOf(UnauthorizedError);
		expect(await q.countPeople()).toBe(2);
		expect(q.objects.has(q.key)).toBe(false);
	});

	it('refuses a message with no actor, writing nothing', async () => {
		const q = await queuedReplace();
		await expect(
			q.service.importStaged({ ...q.message, actorId: undefined })
		).rejects.toBeInstanceOf(UnauthorizedError);
		expect(await q.countPeople()).toBe(2);
	});

	it('still runs the replace for an editor who holds the right', async () => {
		const q = await queuedReplace();
		const message = q.message;
		expect(await q.service.importStaged(message)).toBe(true);
		expect(await q.countPeople()).toBe(1);
		expect(q.objects.size).toBe(0);
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

const NAMED_FILE = [
	'0 HEAD',
	'1 GEDC',
	'2 VERS 5.5.1',
	'1 FILE /old/path.ged',
	'1 NOTE Tree: The Ash Lineage',
	'0 @I1@ INDI',
	'1 NAME Ann /Ash/',
	'0 TRLR'
].join('\n');

const FILE_ONLY = [
	'0 HEAD',
	'1 GEDC',
	'2 VERS 5.5.1',
	'1 FILE Other Name',
	'0 @I1@ INDI',
	'1 NAME Ann /Ash/',
	'0 TRLR'
].join('\n');

/** An install owner, so a new tree may be started by the import. */
const installOwner = async () => {
	const caller = await createTestUser(t.db);
	return { ...caller.context, user: { ...caller.context.user, isInstallOwner: true } };
};

const nameOf = async (treeId: string) =>
	(await t.db.select().from(trees).where(eq(trees.id, treeId)).get())?.name;

const logOf = (treeId: string) =>
	t.db.select().from(changeLog).where(eq(changeLog.treeId, treeId)).all();

describe('naming a tree from the file it imports', () => {
	it('renames a newly created tree from its embedded Tree: name, and logs the change', async () => {
		const context = await installOwner();
		const outcome = await new GedcomService(t.db).importFile(
			fileOf({ fileName: 'upload.ged', text: NAMED_FILE }),
			context
		);
		expect(await nameOf(outcome.treeId)).toBe('The Ash Lineage');
		const changes = await logOf(outcome.treeId);
		expect(changes.map((c) => c.kind)).toEqual(['import_tree_name']);
		expect(changes[0]?.actorId).toBe(context.user.id);
	});

	it('leaves an explicitly named tree alone', async () => {
		const context = await installOwner();
		const outcome = await new GedcomService(t.db).importFile(
			fileOf({ fileName: 'upload.ged', treeName: 'My Own Name', text: NAMED_FILE }),
			context
		);
		expect(await nameOf(outcome.treeId)).toBe('My Own Name');
		expect(await logOf(outcome.treeId)).toEqual([]);
	});

	it('keeps the uploaded filename, which beats HEAD.FILE', async () => {
		const context = await installOwner();
		const outcome = await new GedcomService(t.db).importFile(
			fileOf({ fileName: 'Uploaded.ged', text: FILE_ONLY }),
			context
		);
		expect(await nameOf(outcome.treeId)).toBe('Uploaded');
	});

	it('falls back to HEAD.FILE when the filename yields no name at all', async () => {
		const context = await installOwner();
		// A name that is only an extension yields nothing, so the tree is created with its placeholder
		// name and HEAD.FILE, not the filename, is what renames it.
		const outcome = await new GedcomService(t.db).importFile(
			fileOf({ fileName: '.ged', text: FILE_ONLY }),
			context
		);
		expect(await nameOf(outcome.treeId)).toBe('Other Name');
		const changes = await logOf(outcome.treeId);
		expect(changes.map((c) => c.kind)).toEqual(['import_tree_name']);
	});

	it('never renames a tree it imports into, in replace or merge mode', async () => {
		const s = await tree('editor');
		const service = new GedcomService(t.db);
		for (const mode of ['replace', 'merge'] as const) {
			const outcome = await service.importFile(
				fileOf({ treeId: s.treeId, treeName: 'Keep', text: NAMED_FILE, mode }),
				s.member.context
			);
			expect(outcome.treeId).toBe(s.treeId);
		}
		expect(await nameOf(s.treeId)).toMatch(/^Test tree /);
		expect(await logOf(s.treeId)).toEqual([]);
	});

	it('renames a new tree on the queued path too', async () => {
		const context = await installOwner();
		const { bucket } = fakeBucket();
		const sent: ImportQueueMessage[] = [];
		const service = new GedcomService(t.db, {
			bucket,
			queue: { send: async (message: ImportQueueMessage) => void sent.push(message) }
		});
		const outcome = await service.importFile(
			fileOf({ fileName: 'big.ged', text: NAMED_FILE, sizeBytes: 3 * 1024 * 1024 }),
			context
		);
		expect(outcome.status).toBe('queued');
		expect(sent[0]).toMatchObject({
			createdTreeName: 'big',
			isTreeNameExplicit: false,
			actorId: context.user.id
		});
		expect(await service.importStaged(sent[0]!)).toBe(true);
		expect(await nameOf(outcome.treeId)).toBe('The Ash Lineage');
	});

	it('treats a queued message with no flag as explicit, so an old message never renames', async () => {
		const s = await tree();
		const { bucket } = fakeBucket();
		const key = `staging/gedcom-${s.treeId}-legacy.ged`;
		await bucket.put(key, NAMED_FILE);
		const before = (await t.db.select().from(trees).where(eq(trees.id, s.treeId)).get())!;
		expect(
			await new GedcomService(t.db, { bucket }).importStaged({
				treeId: s.treeId,
				r2ObjectKey: key,
				treeName: before.name,
				createdTreeName: before.name,
				createdTreeVersion: before.version,
				actorId: s.owner.userId
			})
		).toBe(true);
		expect(await nameOf(s.treeId)).toBe(before.name);
		expect(await logOf(s.treeId)).toEqual([]);
	});
});

describe('renameImportedTree', () => {
	it('renames only while the name and version still match, then logs the change', async () => {
		const s = await tree();
		const repo = new GedcomRepository(t.db);
		const before = (await t.db.select().from(trees).where(eq(trees.id, s.treeId)).get())!;

		expect(
			await repo.renameImportedTree(
				s.treeId,
				`Not ${before.name}`,
				before.version,
				'Nope',
				s.owner.userId
			)
		).toBe(false);
		expect(
			await repo.renameImportedTree(
				s.treeId,
				before.name,
				before.version,
				'The Ash Lineage',
				s.owner.userId
			)
		).toBe(true);

		const after = (await t.db.select().from(trees).where(eq(trees.id, s.treeId)).get())!;
		expect(after.name).toBe('The Ash Lineage');
		expect(after.version).toBe(before.version + 1);
		// The version it was renamed on is now stale, so a second writer cannot rename it again.
		expect(
			await repo.renameImportedTree(s.treeId, before.name, before.version, 'Again', s.owner.userId)
		).toBe(false);

		const changes = await logOf(s.treeId);
		expect(changes).toHaveLength(1);
		expect(changes[0]?.kind).toBe('import_tree_name');
	});
});
