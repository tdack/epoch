/**
 * Media objects (ADR-082, migration steps 2 and 3): uploads write an object first, a file with no
 * object reads as its own, privacy is judged on the object and every link, an unresolved `FILE` is
 * never served, scanned, deleted from the bucket or counted, and the backfill SQL is idempotent.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { individuals, mediaItems, mediaLinks, mediaObjects } from '../db/schema';
import { NotFoundError } from '../domain/errors';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { mediaLinkId, unresolvedMediaKey } from '../../shared/media';
import { parseMediaKey } from '../media/media-key';
import { MediaRepository } from '../repositories/media-repository';
import { BACKFILL_MEDIA_OBJECTS_SQL } from '../repositories/media-backfill';
import { MediaService } from './media-service';
import { ChangeLogService } from './change-log-service';

let t: TestDatabase;
let service: MediaService;
let owner: TestActor;
let editor: TestActor;
let viewer: TestActor;
let treeId: string;
const OLD = new Date('1900-01-01');

/** A dead person (visible to a viewer) and a living one (private to them), inserted directly. */
const DEAD = 'person-dead';
const LIVING = 'person-living';

beforeAll(async () => {
	t = await createTestDatabase();
	service = new MediaService(t.db);
	owner = await createTestUser(t.db, 'owner');
	editor = await createTestUser(t.db, 'editor');
	viewer = await createTestUser(t.db, 'viewer');
	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, editor, 'editor');
	await addTestMember(t.db, treeId, viewer, 'viewer');
	await t.db.insert(individuals).values({ id: DEAD, treeId, givenName: 'Dead', privacy: 'public' });
	await t.db
		.insert(individuals)
		.values({ id: LIVING, treeId, givenName: 'Living', privacy: 'private' });
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

const keyOf = (id: string) => `media/${treeId}/${id}.png`;

async function uploaded(id: string, entityId: string) {
	await service.record(treeId, entityId, {
		id,
		objectKey: keyOf(id),
		title: id,
		mimeType: 'image/png',
		sizeBytes: 5,
		uploadedBy: editor.userId
	});
}

/** An object with its first file, written directly so privacy and links can be set. */
async function addObject(id: string, privacy: 'auto' | 'private' | 'public', linkedTo: string[]) {
	await t.db.insert(mediaObjects).values({ id, treeId, privacy });
	await t.db.insert(mediaItems).values({
		id,
		treeId,
		objectId: id,
		r2ObjectKey: keyOf(id),
		title: id,
		mimeType: 'image/png',
		sizeBytes: 5,
		uploadedBy: editor.userId
	});
	for (const entityId of linkedTo)
		await t.db
			.insert(mediaLinks)
			.values({ id: mediaLinkId(id, entityId), treeId, mediaId: id, entityId });
}

const canRead = async (actor: TestActor, key: string) =>
	service.requireRead(key, actor.context).then(
		() => true,
		(err) => {
			if (err instanceof NotFoundError) return false;
			throw err;
		}
	);

describe('a write creates the object first', () => {
	it('inserts an object whose id is the file id, the file pointing at it, and the link', async () => {
		await uploaded('up-1', DEAD);
		const [object] = await t.db.select().from(mediaObjects).where(eq(mediaObjects.id, 'up-1'));
		const [file] = await t.db.select().from(mediaItems).where(eq(mediaItems.id, 'up-1'));
		const [link] = await t.db.select().from(mediaLinks).where(eq(mediaLinks.mediaId, 'up-1'));
		expect(object).toMatchObject({ treeId, privacy: 'auto', version: 1, createdBy: editor.userId });
		expect(file).toMatchObject({ objectId: 'up-1', status: null, sortOrder: null });
		expect(link).toMatchObject({ id: 'up-1:' + DEAD, factId: null, sortOrder: null });
	});
});

describe('privacy of an object', () => {
	it('hides a private object from a viewer, shows it to an editor, and ignores public for a private person', async () => {
		await addObject('o-plain', 'auto', [DEAD]);
		await addObject('o-private', 'private', [DEAD]);
		await addObject('o-public-living', 'public', [LIVING]);
		await addObject('o-detached', 'auto', []);
		expect(await canRead(viewer, keyOf('o-plain'))).toBe(true);
		expect(await canRead(viewer, keyOf('o-private'))).toBe(false);
		expect(await canRead(viewer, keyOf('o-public-living'))).toBe(false);
		expect(await canRead(viewer, keyOf('o-detached'))).toBe(false);
		for (const id of ['o-plain', 'o-private', 'o-public-living', 'o-detached'])
			expect(await canRead(editor, keyOf(id))).toBe(true);
	});

	it('judges a fact link by its owner, and a secondary file by its object', async () => {
		await addObject('o-fact', 'auto', []);
		await t.db.insert(mediaLinks).values({
			id: mediaLinkId('o-fact', LIVING, 'some-fact'),
			treeId,
			mediaId: 'o-fact',
			entityId: LIVING,
			factId: 'some-fact'
		});
		expect(await canRead(viewer, keyOf('o-fact'))).toBe(false);
		await t.db.insert(mediaItems).values({
			id: 'o-fact-2',
			treeId,
			objectId: 'o-fact',
			sortOrder: 1,
			r2ObjectKey: keyOf('o-fact-2'),
			title: 'second',
			mimeType: 'image/png'
		});
		expect(await canRead(viewer, keyOf('o-fact-2'))).toBe(false);
		expect(await canRead(editor, keyOf('o-fact-2'))).toBe(true);
	});

	it('lists exactly what requireRead allows', async () => {
		const listed = (await service.list(viewer.context, { treeId, limit: 100 })).files.map(
			(f) => f.id
		);
		for (const id of ['o-plain', 'o-private', 'o-public-living', 'o-detached', 'o-fact'])
			expect(listed.includes(id)).toBe(await canRead(viewer, keyOf(id)));
		// One row per object: the second file is not listed on its own.
		const editorListed = (await service.list(editor.context, { treeId, limit: 100 })).files;
		expect(editorListed.map((f) => f.id)).not.toContain('o-fact-2');
		expect(editorListed.find((f) => f.id === 'o-fact')).toMatchObject({
			objectId: 'o-fact',
			objectVersion: 1
		});
	});

	it('sets privacy through a logged op that undo reverses', async () => {
		await addObject('o-set', 'auto', [DEAD]);
		await service.setObjectPrivacy(editor.context, {
			treeId,
			mediaId: 'o-set',
			privacy: 'private',
			expectedVersion: 1
		});
		expect(await canRead(viewer, keyOf('o-set'))).toBe(false);
		await new ChangeLogService(t.db).undoLast(treeId, editor.context);
		expect(await canRead(viewer, keyOf('o-set'))).toBe(true);
	});
});

describe('link ops on an object', () => {
	it('links under a fact, bumps the object version, and undoes', async () => {
		await addObject('o-link', 'auto', []);
		await service.link(editor.context, {
			treeId,
			mediaId: 'o-link',
			entityId: DEAD,
			expectedVersion: 1
		});
		const [object] = await t.db.select().from(mediaObjects).where(eq(mediaObjects.id, 'o-link'));
		const [file] = await t.db.select().from(mediaItems).where(eq(mediaItems.id, 'o-link'));
		expect(object!.version).toBe(2);
		expect(file!.version).toBe(1);
		await new ChangeLogService(t.db).undoLast(treeId, editor.context);
		expect(await t.db.select().from(mediaLinks).where(eq(mediaLinks.mediaId, 'o-link'))).toEqual(
			[]
		);
	});

	it('undoes a change whose images predate the new columns (null-fill)', async () => {
		await addObject('o-old', 'auto', [DEAD]);
		await service.unlink(editor.context, { treeId, mediaId: 'o-old', entityId: DEAD });
		await new ChangeLogService(t.db).undoLast(treeId, editor.context);
		expect(
			await t.db
				.select()
				.from(mediaLinks)
				.where(eq(mediaLinks.id, mediaLinkId('o-old', DEAD)))
		).toHaveLength(1);
	});
});

describe('a file with no object yet (before the backfill)', () => {
	it('reads as its own object, and link ops guard the file', async () => {
		await t.db.insert(mediaItems).values({
			id: 'legacy',
			treeId,
			r2ObjectKey: keyOf('legacy'),
			title: 'legacy',
			mimeType: 'image/png',
			uploadedBy: editor.userId
		});
		await t.db
			.insert(mediaLinks)
			.values({ id: mediaLinkId('legacy', DEAD), treeId, mediaId: 'legacy', entityId: DEAD });
		expect(await canRead(viewer, keyOf('legacy'))).toBe(true);
		await service.link(editor.context, { treeId, mediaId: 'legacy', entityId: LIVING });
		expect(await canRead(viewer, keyOf('legacy'))).toBe(false);
		const [file] = await t.db.select().from(mediaItems).where(eq(mediaItems.id, 'legacy'));
		expect(file!.version).toBe(2);
		const listed = (await service.list(editor.context, { treeId, limit: 100 })).files;
		expect(listed.find((f) => f.id === 'legacy')).toMatchObject({
			objectId: 'legacy',
			objectVersion: 2
		});
	});

	it('is given an object by the backfill SQL, once, and a second run does nothing', async () => {
		await t.db.insert(mediaItems).values({
			id: 'to-backfill',
			treeId,
			r2ObjectKey: keyOf('to-backfill'),
			mimeType: 'image/png',
			uploadedBy: editor.userId,
			version: 7,
			createdAt: OLD,
			updatedAt: OLD
		});
		for (const sql of BACKFILL_MEDIA_OBJECTS_SQL) await t.d1.exec(sql);
		const [object] = await t.db
			.select()
			.from(mediaObjects)
			.where(eq(mediaObjects.id, 'to-backfill'));
		const [file] = await t.db.select().from(mediaItems).where(eq(mediaItems.id, 'to-backfill'));
		expect(object).toMatchObject({
			treeId,
			version: 7,
			createdBy: editor.userId,
			createdAt: OLD,
			updatedAt: OLD
		});
		expect(file!.objectId).toBe('to-backfill');
		const countBefore = (await t.db.select().from(mediaObjects)).length;
		for (const sql of BACKFILL_MEDIA_OBJECTS_SQL) await t.d1.exec(sql);
		expect((await t.db.select().from(mediaObjects)).length).toBe(countBefore);
	});
});

describe('an unresolved FILE (ADR-082)', () => {
	const ID = 'unres-1';
	const bucketWith = (...keys: string[]) => {
		const bucket = new FakeMediaBucket();
		for (const key of keys)
			bucket.objects.set(key, {
				body: new Uint8Array(0),
				size: 10,
				uploaded: new Date(Date.now() - 2 * 3_600_000)
			});
		return bucket;
	};

	beforeAll(async () => {
		await new MediaRepository(t.db).insertUnresolved(treeId, {
			id: ID,
			gedcomPath: 'photos/john smith.jpg',
			mimeType: 'image/jpeg',
			title: 'John'
		});
		await t.db
			.insert(mediaLinks)
			.values({ id: mediaLinkId(ID, DEAD), treeId, mediaId: ID, entityId: DEAD });
	});

	it('is stored with the placeholder key, an object, and no size', async () => {
		const [file] = await t.db.select().from(mediaItems).where(eq(mediaItems.id, ID));
		expect(file).toMatchObject({
			r2ObjectKey: unresolvedMediaKey(ID),
			status: 'unresolved',
			objectId: ID,
			gedcomPath: 'photos/john smith.jpg',
			sizeBytes: null
		});
		expect(await t.db.select().from(mediaObjects).where(eq(mediaObjects.id, ID))).toHaveLength(1);
	});

	it('is refused by parseMediaKey and answers 404 on the serve path', async () => {
		expect(parseMediaKey(unresolvedMediaKey(ID))).toBeNull();
		await expect(
			service.requireRead(unresolvedMediaKey(ID), editor.context)
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it('is never listed as an unlinked object, whatever the bucket holds', async () => {
		const result = await service.listUnlinked(
			owner.context,
			bucketWith(unresolvedMediaKey(ID)) as unknown as R2Bucket,
			treeId
		);
		expect(result.files).toEqual([]);
	});

	it('is listed as missing, with nothing to preview, and costs nothing in the quota', async () => {
		const row = (await service.list(owner.context, { treeId, limit: 100 })).files.find(
			(f) => f.id === ID
		);
		expect(row).toMatchObject({ isUnresolved: true, previewKey: null, canPreview: false });
		const usage = await service.usage(owner.context, bucketWith() as unknown as R2Bucket, treeId);
		expect(usage.trees[0]!.storedBytes).toBe(0);
	});

	it('is deleted without a bucket call', async () => {
		await new MediaRepository(t.db).insertUnresolved(treeId, {
			id: 'unres-del',
			gedcomPath: 'x.jpg',
			mimeType: 'image/jpeg'
		});
		const bucket = bucketWith();
		const result = await service.delete(
			owner.context,
			{ treeId, mediaId: 'unres-del' },
			bucket as unknown as R2Bucket
		);
		expect(result).toEqual({ wasObjectRemoved: true });
		expect(bucket.deleteBatches).toEqual([]);
		expect(await t.db.select().from(mediaItems).where(eq(mediaItems.id, 'unres-del'))).toEqual([]);
		expect(await t.db.select().from(mediaObjects).where(eq(mediaObjects.id, 'unres-del'))).toEqual(
			[]
		);
	});
});

describe('deleting an object', () => {
	it('removes its links, every file and every resolved file’s bytes', async () => {
		await addObject('o-del', 'auto', [DEAD]);
		await t.db.insert(mediaItems).values({
			id: 'o-del-2',
			treeId,
			objectId: 'o-del',
			sortOrder: 1,
			r2ObjectKey: keyOf('o-del-2'),
			mimeType: 'image/png'
		});
		const bucket = new FakeMediaBucket();
		for (const id of ['o-del', 'o-del-2'])
			bucket.objects.set(keyOf(id), { body: new Uint8Array(0), size: 1, uploaded: OLD });
		await service.delete(
			owner.context,
			{ treeId, mediaId: 'o-del' },
			bucket as unknown as R2Bucket
		);
		expect([...bucket.objects.keys()]).toEqual([]);
		expect(await t.db.select().from(mediaItems).where(eq(mediaItems.objectId, 'o-del'))).toEqual(
			[]
		);
		expect(await t.db.select().from(mediaLinks).where(eq(mediaLinks.mediaId, 'o-del'))).toEqual([]);
	});

	it('removes one file alone and leaves the object and the other file', async () => {
		await addObject('o-one', 'auto', [DEAD]);
		await t.db.insert(mediaItems).values({
			id: 'o-one-2',
			treeId,
			objectId: 'o-one',
			sortOrder: 1,
			r2ObjectKey: keyOf('o-one-2'),
			mimeType: 'image/png'
		});
		await service.delete(
			owner.context,
			{ treeId, mediaId: 'o-one-2', isFileOnly: true },
			new FakeMediaBucket() as unknown as R2Bucket
		);
		expect(await t.db.select().from(mediaObjects).where(eq(mediaObjects.id, 'o-one'))).toHaveLength(
			1
		);
		expect(
			await t.db.select().from(mediaItems).where(eq(mediaItems.objectId, 'o-one'))
		).toHaveLength(1);
	});
});
