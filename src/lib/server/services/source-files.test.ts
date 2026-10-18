/**
 * Files on a source (ADR-060). A file on a source is visible exactly when the source is: the SQL
 * that serves and lists files and the row filter that masks a loaded tree must give one answer for a
 * cited source, an uncited one, one the viewer made, and a tree where nobody is private.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaItems, sources } from '../db/schema';
import { NotFoundError, ValidationError } from '../domain/errors';
import { maskRows } from '../domain/privacy-mask';
import { livingCutoff } from '../domain/living-state';
import { ChangeStore } from '../repositories/change-store';
import { MediaRepository } from '../repositories/media-repository';
import type { TreeRole } from '../../shared/roles';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeLogService } from './change-log-service';
import { EvidenceService } from './evidence-service';
import { MediaService } from './media-service';

const FIXTURE = `0 HEAD
0 @S1@ SOUR
1 TITL Birth certificate of Livia Aliveson
0 @S2@ SOUR
1 TITL Census 1851
0 @S3@ SOUR
1 TITL Nobody cites this
0 @S4@ SOUR
1 TITL Made by the contributor
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
2 SOUR @S2@
3 PAGE 4
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 BIRT
2 DATE 1985
2 SOUR @S1@
3 PAGE 7
0 TRLR`;

/** Nobody is private here, so `maskRows` takes its early return. */
const OPEN_FIXTURE = `0 HEAD
0 @S1@ SOUR
1 TITL Cited
0 @S2@ SOUR
1 TITL Uncited
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
2 SOUR @S1@
3 PAGE 4
0 TRLR`;

let t: TestDatabase;
let media: MediaService;
const actors = {} as Record<TreeRole, TestActor>;
let treeId: string;
let openTreeId: string;
const sourceIds = {} as Record<string, string>;
const openSourceIds = {} as Record<string, string>;

async function addFile(tree: string, entityId: string | null, id: string) {
	await t.db.insert(mediaItems).values({
		id,
		treeId: tree,
		entityId,
		r2ObjectKey: `media/${tree}/${id}.png`,
		title: `${id}.png`,
		mimeType: 'image/png',
		sizeBytes: 10,
		uploadedBy: actors.editor.userId,
		version: 1,
		createdAt: new Date(1_700_000_000_000),
		updatedAt: new Date(1_700_000_000_000)
	});
}

const rowOf = async (id: string) =>
	(await t.db.select().from(mediaItems).where(eq(mediaItems.id, id)))[0]!;

beforeAll(async () => {
	t = await createTestDatabase();
	media = new MediaService(t.db);
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Source files');
	for (const row of await t.db.select().from(sources).where(eq(sources.treeId, treeId)))
		sourceIds[row.xref!] = row.id;
	await t.db
		.update(sources)
		.set({ createdBy: actors.contributor.userId })
		.where(eq(sources.id, sourceIds['@S4@']!));
	for (const [xref, id] of Object.entries(sourceIds)) await addFile(treeId, id, `file-${xref}`);

	openTreeId = await createTestTree(t.db, actors.owner);
	await addTestMember(t.db, openTreeId, actors.viewer, 'viewer');
	await importGedcomToDb(t.d1, openTreeId, OPEN_FIXTURE, 'Open');
	for (const row of await t.db.select().from(sources).where(eq(sources.treeId, openTreeId)))
		openSourceIds[row.xref!] = row.id;
	for (const [xref, id] of Object.entries(openSourceIds))
		await addFile(openTreeId, id, `open-${xref}`);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

/** What the viewer is shown, by the two readers that must agree. */
async function visibleBothWays(tree: string, role: 'contributor' | 'viewer') {
	const actor = actors[role];
	const rows = await new ChangeStore(t.db).loadRows(tree);
	const masked = maskRows(
		rows,
		livingCutoff(new Date(), 110),
		false,
		role === 'contributor' ? actor.userId : null
	).rows.mediaItems;
	const listed = new Set<string>();
	const served = new Set<string>();
	for (const file of rows.mediaItems) {
		const page = await media.list(actor.context, { treeId: tree, entityId: file.entityId! });
		if (page.files.some((f) => f.id === file.id)) listed.add(file.id);
		try {
			await media.requireRead(`media/${tree}/${file.id}.png`, actor.context);
			served.add(file.id);
		} catch (cause) {
			expect(cause).toBeInstanceOf(NotFoundError);
		}
	}
	return { masked: new Set(masked.map((m) => m.id)), listed, served };
}

describe('a file on a source is visible exactly when the source is', () => {
	it.each(['contributor', 'viewer'] as const)(
		'agrees across the list, the serve check and the row filter for a %s',
		async (role) => {
			const { masked, listed, served } = await visibleBothWays(treeId, role);
			expect(listed).toEqual(masked);
			expect(served).toEqual(masked);
		}
	);

	it('shows the cited source’s file, hides the one that supports only a private person, and the uncited', async () => {
		const viewer = await visibleBothWays(treeId, 'viewer');
		expect([...viewer.served]).toEqual(['file-@S2@']);
		const contributor = await visibleBothWays(treeId, 'contributor');
		expect([...contributor.served].sort()).toEqual(['file-@S2@', 'file-@S4@']);
	});

	it('hides a file on an uncited source even when nobody in the tree is private', async () => {
		const { masked, listed, served } = await visibleBothWays(openTreeId, 'viewer');
		expect([...masked]).toEqual(['open-@S1@']);
		expect(listed).toEqual(masked);
		expect(served).toEqual(masked);
	});

	it('gives an editor every file, and names the source it hangs off', async () => {
		const page = await media.list(actors.editor.context, { treeId });
		expect(page.files.map((f) => f.id).sort()).toEqual([
			'file-@S1@',
			'file-@S2@',
			'file-@S3@',
			'file-@S4@'
		]);
		expect(page.files.find((f) => f.id === 'file-@S2@')?.attachedTo).toBe('Census 1851');
	});
});

describe('attaching, detaching and undoing a file on a source', () => {
	it('attaches a detached file to a source, and undo detaches it again', async () => {
		await addFile(treeId, null, 'loose');
		const result = await media.attach(actors.editor.context, {
			treeId,
			mediaId: 'loose',
			entityId: sourceIds['@S3@']!
		});
		expect(JSON.stringify(result)).toContain('Nobody cites this');
		expect((await rowOf('loose')).entityId).toBe(sourceIds['@S3@']);
		const detached = await media.list(actors.editor.context, { treeId, isDetachedOnly: true });
		expect(detached.files.map((f) => f.id)).not.toContain('loose');
		await new ChangeLogService(t.db).undoLast(treeId, actors.editor.context);
		expect((await rowOf('loose')).entityId).toBeNull();
	});

	it('refuses a source in another tree', async () => {
		await expect(
			media.attach(actors.editor.context, {
				treeId,
				mediaId: 'loose',
				entityId: openSourceIds['@S1@']!
			})
		).rejects.toBeInstanceOf(Error);
	});

	it('lets an upload name a source as its owner, and refuses a contributor', async () => {
		await expect(
			media.requireUpload(treeId, sourceIds['@S2@']!, actors.editor.context)
		).resolves.toBeUndefined();
		await expect(
			media.requireUpload(treeId, sourceIds['@S2@']!, actors.contributor.context)
		).rejects.toBeDefined();
		await expect(
			media.requireUpload(treeId, 'no-such-record', actors.editor.context)
		).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('deleting and merging a source carries its files', () => {
	it('detaches the files of a deleted source and undo hangs them back', async () => {
		const evidence = new EvidenceService(t.db);
		const target = sourceIds['@S3@']!;
		await addFile(treeId, target, 'del-1');
		await evidence.deleteSource(treeId, target, {}, actors.editor.context);
		expect((await rowOf('del-1')).entityId).toBeNull();
		expect((await rowOf('file-@S3@')).entityId).toBeNull();
		await new ChangeLogService(t.db).undoLast(treeId, actors.editor.context);
		expect((await rowOf('del-1')).entityId).toBe(target);
	});

	it('moves the files of a merged source to the survivor and undo moves them back', async () => {
		const evidence = new EvidenceService(t.db);
		const survivor = sourceIds['@S2@']!;
		const merged = sourceIds['@S4@']!;
		await evidence.mergeSources(treeId, survivor, [merged], undefined, actors.editor.context);
		expect((await rowOf('file-@S4@')).entityId).toBe(survivor);
		await new ChangeLogService(t.db).undoLast(treeId, actors.editor.context);
		expect((await rowOf('file-@S4@')).entityId).toBe(merged);
	});
});

describe('the media repository', () => {
	it('looks partners up inside the tree only', async () => {
		const repo = new MediaRepository(t.db);
		expect(await repo.partnerIds(openTreeId, 'union-in-another-tree')).toEqual([]);
	});

	it('counts files per source', async () => {
		const repo = new MediaRepository(t.db);
		const counts = await repo.fileCountsOf(treeId, Object.values(sourceIds));
		expect(counts.get(sourceIds['@S2@']!)).toBe(1);
	});
});
