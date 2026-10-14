/**
 * The Files manager's reads (Phase 2): who sees which files and what each may do with them, the
 * same answer `requireRead` gives for a single file, paging, and storage totals.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { individuals, mediaItems, trees, unions } from '../db/schema';
import { PUBLIC_VISITOR, type AuthenticatedContext } from '../domain/identity';
import { UnauthorizedError, ValidationError } from '../domain/errors';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import type { FileRowDto } from '../../shared/files';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FakeMediaBucket } from '../testing/fake-bucket';
import { MediaService } from './media-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Pub /Visible/
1 DEAT
2 DATE 1990
0 @I2@ INDI
1 NAME Liv /Living/
0 @I3@ INDI
1 NAME Pri /Private/
1 DEAT
2 DATE 1990
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 TRLR`;

const visitorCtx: AuthenticatedContext = { user: PUBLIC_VISITOR, correlationId: 'public' };

let t: TestDatabase;
let service: MediaService;
let owner: TestActor;
let manager: TestActor;
let editor: TestActor;
let contributor: TestActor;
let viewer: TestActor;
let stranger: TestActor;
let installOwner: AuthenticatedContext;
let treeId: string;
let otherTreeId: string;
let publicTreeId: string;
let personId: (xref: string) => string;
let unionId: string;
const EMPTY_UNION = 'union-empty';

/** A tree-scoped file row, inserted directly so every ownership state can be set. */
async function addFile(
	tree: string,
	entityId: string | null,
	uploadedBy: string | null,
	options: { id: string; title: string; sizeBytes?: number; createdAt?: number }
) {
	await t.db.insert(mediaItems).values({
		id: options.id,
		treeId: tree,
		entityId,
		r2ObjectKey: `media/${tree}/${options.id}.png`,
		title: options.title,
		mimeType: 'image/png',
		sizeBytes: options.sizeBytes ?? 10,
		uploadedBy,
		version: 1,
		createdAt: new Date((options.createdAt ?? 1_700_000_000) * 1000),
		updatedAt: new Date((options.createdAt ?? 1_700_000_000) * 1000)
	});
}

/** Every page of the caller's listing, following the cursor to its end. */
async function listAll(
	context: AuthenticatedContext,
	query: { treeId?: string; limit?: number } = {}
): Promise<FileRowDto[]> {
	const files: FileRowDto[] = [];
	let cursor: string | undefined;
	do {
		const page = await service.list(context, { ...query, cursor });
		files.push(...page.files);
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	return files;
}

const titlesOf = (files: FileRowDto[]) => files.map((f) => f.title).sort();

beforeAll(async () => {
	t = await createTestDatabase();
	service = new MediaService(t.db);
	owner = await createTestUser(t.db, 'owner');
	manager = await createTestUser(t.db, 'manager');
	editor = await createTestUser(t.db, 'editor');
	contributor = await createTestUser(t.db, 'contributor');
	viewer = await createTestUser(t.db, 'viewer');
	stranger = await createTestUser(t.db, 'stranger');
	const installOwnerActor = await createTestUser(t.db, 'install-owner');
	installOwner = {
		...installOwnerActor.context,
		user: { ...installOwnerActor.context.user, isInstallOwner: true }
	};

	treeId = await createTestTree(t.db, owner);
	await addTestMember(t.db, treeId, manager, 'manager');
	await addTestMember(t.db, treeId, editor, 'editor');
	await addTestMember(t.db, treeId, contributor, 'contributor');
	await addTestMember(t.db, treeId, viewer, 'viewer');

	otherTreeId = await createTestTree(t.db, stranger);
	publicTreeId = await createTestTree(t.db, stranger);
	await t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, publicTreeId));

	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Files demo');
	const people = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(people.map((p) => [p.xref, p.id]));
	personId = (xref) => byXref.get(xref)!;
	await t.db
		.update(individuals)
		.set({ privacy: 'private' })
		.where(eq(individuals.id, personId('@I3@')));
	const [union] = await t.db
		.select({ id: unions.id })
		.from(unions)
		.where(eq(unions.treeId, treeId));
	unionId = union!.id;
	// A partnership with nobody in it: a file on it is visible to no restricted viewer.
	await t.db.insert(unions).values({ id: EMPTY_UNION, treeId, status: 'active' });

	await addFile(treeId, personId('@I1@'), editor.userId, {
		id: 'f-pub',
		title: 'Public.png',
		createdAt: 1_700_000_005
	});
	await addFile(treeId, personId('@I2@'), manager.userId, {
		id: 'f-living',
		title: 'Living.png',
		createdAt: 1_700_000_004
	});
	await addFile(treeId, personId('@I3@'), owner.userId, {
		id: 'f-private',
		title: 'Private.png',
		createdAt: 1_700_000_003
	});
	await addFile(treeId, null, manager.userId, {
		id: 'f-loose',
		title: 'Loose.png',
		createdAt: 1_700_000_002
	});
	await addFile(treeId, unionId, editor.userId, {
		id: 'f-union',
		title: 'Union.png',
		createdAt: 1_700_000_001
	});
	await addFile(treeId, EMPTY_UNION, null, {
		id: 'f-empty',
		title: 'Empty union.png',
		createdAt: 1_700_000_000
	});
	await addFile(otherTreeId, null, stranger.userId, { id: 'f-other', title: 'Other tree.png' });
	await addFile(publicTreeId, null, stranger.userId, { id: 'f-public', title: 'Public tree.png' });
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

const ALL_IN_TREE = [
	'Empty union.png',
	'Living.png',
	'Loose.png',
	'Private.png',
	'Public.png',
	'Union.png'
];
const ctxOf = (actor: TestActor) => actor.context;

describe('who sees which files', () => {
	it('lets an owner see every file in the tree, with every action on the ones they may manage', async () => {
		const files = await listAll(ctxOf(owner), { treeId });
		expect(titlesOf(files)).toEqual(ALL_IN_TREE);
		expect(files.every((f) => f.canPreview && f.canRename && f.canAttach !== f.canDetach)).toBe(
			true
		);
		expect(files.every((f) => f.canDelete)).toBe(true);
	});

	it('lets a manager delete any file and shows the uploader names to them', async () => {
		const files = await listAll(ctxOf(manager), { treeId });
		expect(titlesOf(files)).toEqual(ALL_IN_TREE);
		expect(files.every((f) => f.canDelete)).toBe(true);
		expect(files.find((f) => f.title === 'Public.png')?.uploadedBy).toBe('editor');
	});

	it('lets an editor delete only the files they uploaded, and hides uploader names from them', async () => {
		const files = await listAll(ctxOf(editor), { treeId });
		expect(titlesOf(files)).toEqual(ALL_IN_TREE);
		const byTitle = (title: string) => files.find((f) => f.title === title)!;
		expect(byTitle('Public.png').canDelete).toBe(true);
		expect(byTitle('Living.png').canDelete).toBe(false);
		expect(byTitle('Loose.png').canDelete).toBe(false);
		expect(files.every((f) => f.uploadedBy === null)).toBe(true);
	});

	it('lets an editor rename, attach and move, and offers attach only on a detached file', async () => {
		const files = await listAll(ctxOf(editor), { treeId });
		const loose = files.find((f) => f.title === 'Loose.png')!;
		const pub = files.find((f) => f.title === 'Public.png')!;
		expect(loose).toMatchObject({
			canRename: true,
			canAttach: true,
			canDetach: false,
			canMove: false
		});
		expect(pub).toMatchObject({
			canRename: true,
			canAttach: false,
			canDetach: true,
			canMove: true
		});
	});

	it('shows a contributor only the files attached to people they may see', async () => {
		const files = await listAll(ctxOf(contributor), { treeId });
		expect(titlesOf(files)).toEqual(['Public.png']);
		expect(files[0]).toMatchObject({ canPreview: true, canRename: false, canDelete: false });
	});

	it('shows a viewer the same restricted set, with no action on any file', async () => {
		const files = await listAll(ctxOf(viewer), { treeId });
		expect(titlesOf(files)).toEqual(['Public.png']);
		expect(
			files.every((f) => !f.canRename && !f.canAttach && !f.canDetach && !f.canMove && !f.canDelete)
		).toBe(true);
	});

	it('shows a user only the files of the trees they belong to', async () => {
		expect(titlesOf(await listAll(ctxOf(stranger)))).toEqual(['Other tree.png', 'Public tree.png']);
		expect(titlesOf(await listAll(ctxOf(stranger), { treeId }))).toEqual([]);
	});

	it('refuses a public visitor outright', async () => {
		await expect(service.list(visitorCtx, {})).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('gives the install owner metadata only in a tree they are not a member of', async () => {
		const files = await listAll(installOwner, { treeId });
		expect(titlesOf(files)).toEqual(ALL_IN_TREE);
		for (const file of files) {
			expect(file).toMatchObject({
				attachedTo: null,
				uploadedBy: null,
				canPreview: false,
				canRename: false,
				canAttach: false,
				canDetach: false,
				canMove: false,
				canDelete: false
			});
		}
	});

	it('gives the install owner metadata for every tree in the install, with the tree named', async () => {
		const files = await listAll(installOwner);
		expect(files.map((f) => f.title)).toEqual(
			expect.arrayContaining(['Other tree.png', 'Public tree.png'])
		);
		expect(files.find((f) => f.title === 'Other tree.png')?.treeName).toMatch(/^Test tree/);
	});
});

describe('cross-tree isolation', () => {
	it('never lists a file from a tree the caller is not in, even when no tree is named', async () => {
		const titles = titlesOf(await listAll(ctxOf(viewer)));
		expect(titles).not.toContain('Other tree.png');
		expect(titles).not.toContain('Public tree.png');
	});

	it('returns nothing when asked for a tree the caller is not in', async () => {
		expect(await listAll(ctxOf(viewer), { treeId: otherTreeId })).toEqual([]);
	});
});

describe('the list agrees with a direct read', () => {
	it('lists a file exactly when requireRead would let the caller read it', async () => {
		const actors = [owner, manager, editor, contributor, viewer];
		const rows = await t.db.select().from(mediaItems).where(eq(mediaItems.treeId, treeId));
		for (const actor of actors) {
			const listed = new Set((await listAll(ctxOf(actor), { treeId })).map((f) => f.id));
			for (const row of rows) {
				const canRead = await service.requireRead(row.r2ObjectKey, ctxOf(actor)).then(
					() => true,
					() => false
				);
				expect(listed.has(row.id), `${actor.context.user.name} / ${row.title}`).toBe(canRead);
			}
		}
	});
});

describe('paging', () => {
	it('returns every file across pages of one, with no file repeated', async () => {
		const files = await listAll(ctxOf(owner), { treeId, limit: 1 });
		expect(files.map((f) => f.id)).toHaveLength(new Set(files.map((f) => f.id)).size);
		expect(titlesOf(files)).toEqual(ALL_IN_TREE);
	});

	it('pages a restricted viewer through every visible file, though pages can come back empty', async () => {
		const files = await listAll(ctxOf(viewer), { treeId, limit: 1 });
		expect(titlesOf(files)).toEqual(['Public.png']);
	});

	it('refuses a cursor it did not issue', async () => {
		await expect(service.list(ctxOf(owner), { cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(
			ValidationError
		);
	});
});

describe('storage use', () => {
	/** R2 objects in two trees and one key that names no tree; sizes come from the listing. */
	function bucketWith(): R2Bucket {
		const bucket = new FakeMediaBucket();
		bucket.objects.set(`media/${treeId}/a.png`, { body: new Uint8Array(0), size: 100 });
		bucket.objects.set(`media/${otherTreeId}/b.png`, { body: new Uint8Array(0), size: 50 });
		bucket.objects.set('media/stray', { body: new Uint8Array(0), size: 7 });
		return bucket as unknown as R2Bucket;
	}

	it('shows an owner their tree total against the limit, and no install total', async () => {
		const usage = await service.usage(ctxOf(owner), bucketWith(), treeId);
		expect(usage.trees).toEqual([
			expect.objectContaining({ treeId, storedBytes: 100, limitBytes: MAX_TREE_MEDIA_BYTES })
		]);
		expect(usage.installBytes).toBeNull();
	});

	it('shows a viewer no tree totals', async () => {
		const usage = await service.usage(ctxOf(viewer), bucketWith());
		expect(usage).toEqual({ trees: [], installBytes: null });
	});

	it('shows the install owner the whole install total, including the key that names no tree', async () => {
		const usage = await service.usage(installOwner, bucketWith());
		expect(usage.installBytes).toBe(157);
		expect(usage.trees).toEqual([]);
	});

	it('refuses a public visitor', async () => {
		await expect(service.usage(visitorCtx, bucketWith())).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
