/**
 * Who may reach the tree at all, and the doors around it that are not reads of a record: who
 * becomes an owner, who may export, and who may read or add an R2 object (ADR-015).
 */

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	individuals,
	mediaItems,
	treeMemberships,
	trees,
	unionPartners,
	unions
} from '../db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors';
import type { TreeRole } from '../../shared/roles';
import { importGedcomToDb } from '../testing/gedcom';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { GedcomService } from './gedcom-service';
import { PersonService } from './person-service';
import { TreeService } from './tree-service';
import { MediaService, parseMediaKey } from './media-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 BIRT
2 DATE 1850
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 BIRT
2 DATE 1985
0 TRLR`;

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
const media = () => new MediaService(t.db, () => NOW);

/** A legacy key names its owner; a current key does not. A null owner is a detached file. */
async function addMedia(
	entityId: string | null,
	shape: 'legacy' | 'current' = 'legacy'
): Promise<string> {
	const mediaId = crypto.randomUUID();
	const key =
		shape === 'current' || entityId === null
			? `media/${treeId}/${mediaId}.jpg`
			: `media/${treeId}/${entityId}/${mediaId}.jpg`;
	await t.db.insert(mediaItems).values({
		id: mediaId,
		treeId,
		entityId,
		r2ObjectKey: key,
		title: 'x',
		mimeType: 'image/jpeg'
	});
	return key;
}

/** A partnership's media is held by the union; it is visible only while every partner is. */
async function addUnionMedia(partnerIds: string[]): Promise<string> {
	const unionId = crypto.randomUUID();
	await t.db.insert(unions).values({ id: unionId, treeId });
	for (const [order, personId] of partnerIds.entries()) {
		await t.db.insert(unionPartners).values({
			id: crypto.randomUUID(),
			treeId,
			unionId,
			personId,
			order
		});
	}
	return addMedia(unionId, 'current');
}

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Access');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('ownership', () => {
	it('is never granted to whoever asks first for a tree with no members', async () => {
		const orphan = crypto.randomUUID();
		await t.db.insert(trees).values({ id: orphan, name: 'Orphan' });
		const stranger = await createTestUser(t.db, 'stranger');
		expect(await new UserRepository(t.db).getMembership(orphan, stranger.userId)).toBeNull();
		expect(await new TreeRepository(t.db).listForUser(stranger.userId)).toEqual([]);
		expect(
			await t.db.select().from(treeMemberships).where(eq(treeMemberships.treeId, orphan))
		).toEqual([]);
	});
});

describe('import', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each(['owner', 'manager', 'editor'] as const)('is allowed for a %s', async (role) => {
		await expect(
			new GedcomService(t.db).requireImport(treeId, actors[role].context)
		).resolves.toBeUndefined();
	});
	it.each(['contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(
			new GedcomService(t.db).requireImport(treeId, actors[role].context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('is refused to someone who is not a member, whatever the tree holds', async () => {
		const stranger = await createTestUser(t.db, 'stranger-import');
		await expect(
			new GedcomService(t.db).requireImport(treeId, stranger.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it("reads the caller's membership and nothing of the tree", async () => {
		const readTree = vi.spyOn(TreeRepository.prototype, 'findById');
		const readRows = vi.spyOn(GenealogyRepository.prototype, 'getTreeData');
		await new GedcomService(t.db).requireImport(treeId, actors.owner.context);
		expect(readTree).not.toHaveBeenCalled();
		expect(readRows).not.toHaveBeenCalled();
	});
});

describe('export', () => {
	it.each(['owner', 'manager'] as const)('is allowed for a %s', async (role) => {
		await expect(
			new GedcomService(t.db).requireExport(treeId, actors[role].context)
		).resolves.toBeUndefined();
	});
	it.each(['editor', 'contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(
			new GedcomService(t.db).requireExport(treeId, actors[role].context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('does not hand the whole tree to a viewer through the tree or individual reads', async () => {
		const trees = new TreeService(t.db);
		await expect(trees.getTree(treeId, actors.viewer.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
		await expect(
			new PersonService(t.db).get(treeId, idOf('@I1@'), actors.contributor.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(trees.previewDeleteTree(treeId, actors.manager.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});
});

describe('media keys', () => {
	it('parses the tree from both the current and the legacy key shapes', () => {
		expect(parseMediaKey('media/t1/3f2a.jpg')).toEqual({ treeId: 't1' });
		expect(parseMediaKey('media/t1/p1/file.jpg')).toEqual({ treeId: 't1' });
		expect(parseMediaKey('media/t1/p1')).toEqual({ treeId: 't1' });
		for (const bad of [
			'exports/t1-1.ged',
			'media/t1',
			'media/t1/',
			'media/t1/p1/a/b.jpg',
			'media//p1/x.jpg',
			'../media/t1/p1/x.jpg'
		]) {
			expect(parseMediaKey(bad), bad).toBeNull();
		}
	});
});

describe('reading an object', () => {
	it('is refused to a non-member', async () => {
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(
			media().requireRead(await addMedia(idOf('@I1@')), stranger.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('is allowed for a viewer when the record is visible, and for an owner always', async () => {
		const visible = await addMedia(idOf('@I1@'));
		const hidden = await addMedia(idOf('@I2@'));
		await expect(media().requireRead(visible, actors.viewer.context)).resolves.toBeDefined();
		await expect(media().requireRead(hidden, actors.owner.context)).resolves.toBeDefined();
		await expect(media().requireRead(hidden, actors.editor.context)).resolves.toBeDefined();
	});
	it("answers a private person's object exactly as a missing one", async () => {
		const hidden = await addMedia(idOf('@I2@'));
		const missing = `media/${treeId}/no-such-person/${crypto.randomUUID()}.jpg`;
		const a = await media()
			.requireRead(hidden, actors.viewer.context)
			.catch((e) => e);
		const b = await media()
			.requireRead(missing, actors.viewer.context)
			.catch((e) => e);
		expect(a).toBeInstanceOf(NotFoundError);
		expect(b).toBeInstanceOf(NotFoundError);
		expect(a.message.replace(hidden, 'KEY')).toBe(b.message.replace(missing, 'KEY'));
	});
	it('reads a current-shape key by its row, and a detached file only as an editor or above', async () => {
		const loose = await addMedia(null, 'current');
		await expect(media().requireRead(loose, actors.editor.context)).resolves.toBeDefined();
		await expect(media().requireRead(loose, actors.owner.context)).resolves.toBeDefined();
		for (const role of ['contributor', 'viewer'] as const) {
			await expect(media().requireRead(loose, actors[role].context)).rejects.toBeInstanceOf(
				NotFoundError
			);
		}
	});
	it('answers a current-shape key for a visible person to a viewer, and a private one as missing', async () => {
		const visible = await addMedia(idOf('@I1@'), 'current');
		const hidden = await addMedia(idOf('@I2@'), 'current');
		await expect(media().requireRead(visible, actors.viewer.context)).resolves.toBeDefined();
		await expect(media().requireRead(hidden, actors.viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});
	it('shows a union file only while every partner is visible to the viewer', async () => {
		const visibleUnion = await addUnionMedia([idOf('@I1@')]);
		const mixedUnion = await addUnionMedia([idOf('@I1@'), idOf('@I2@')]);
		const noPartners = await addUnionMedia([]);
		await expect(media().requireRead(visibleUnion, actors.viewer.context)).resolves.toBeDefined();
		await expect(media().requireRead(mixedUnion, actors.viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		await expect(media().requireRead(noPartners, actors.viewer.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
		await expect(media().requireRead(noPartners, actors.editor.context)).resolves.toBeDefined();
	});
	it('does not trust a key that names another tree', async () => {
		const other = await createTestTree(t.db, actors.owner);
		await expect(
			media().requireRead(`media/${other}/x/f.jpg`, actors.viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
});

describe('adding an object', () => {
	it.each(['contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(
			media().requireUpload(treeId, idOf('@I1@'), actors[role].context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('is allowed for an editor, but only onto a record of this tree', async () => {
		await expect(
			media().requireUpload(treeId, idOf('@I1@'), actors.editor.context)
		).resolves.toBeUndefined();
		await expect(
			media().requireUpload(treeId, 'not-a-record', actors.editor.context)
		).rejects.toBeInstanceOf(ValidationError);
		const other = await createTestTree(t.db, actors.owner);
		await addTestMember(t.db, other, actors.editor, 'editor');
		await expect(
			media().requireUpload(other, idOf('@I1@'), actors.editor.context)
		).rejects.toBeInstanceOf(ValidationError);
	});
});
