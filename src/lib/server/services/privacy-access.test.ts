/**
 * Who may reach the tree at all, and the doors around it that are not reads of a record: who
 * becomes an owner, who may export, and who may read or add an R2 object (ADR-015).
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals, mediaItems, treeMemberships, trees } from '../db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../gedcom/importer';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { addTestMember, createTestDatabase, createTestTree, createTestUser, type TestActor, type TestDatabase } from '../testing/d1';
import { GenealogyService } from './genealogy-service';
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

async function addMedia(entityId: string): Promise<string> {
	const key = `media/${treeId}/${entityId}/${crypto.randomUUID()}.jpg`;
	await t.db.insert(mediaItems).values({ id: crypto.randomUUID(), treeId, entityId, r2ObjectKey: key, title: 'x', mimeType: 'image/jpeg' });
	return key;
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
	const rows = await t.db.select({ id: individuals.id, xref: individuals.xrefId }).from(individuals).where(eq(individuals.treeId, treeId));
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
		expect(await t.db.select().from(treeMemberships).where(eq(treeMemberships.treeId, orphan))).toEqual([]);
	});
});

describe('export', () => {
	it.each(['owner', 'manager'] as const)('is allowed for a %s', async (role) => {
		await expect(new GenealogyService(t.db).requireExport(treeId, actors[role].context)).resolves.toBeUndefined();
	});
	it.each(['editor', 'contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(new GenealogyService(t.db).requireExport(treeId, actors[role].context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('does not hand the whole tree to a viewer through the tree or individual reads', async () => {
		const service = new GenealogyService(t.db);
		await expect(service.getTree(treeId, actors.viewer.context)).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(service.getIndividual(treeId, idOf('@I1@'), actors.contributor.context)).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(service.previewDeleteTree(treeId, actors.manager.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
});

describe('media keys', () => {
	it('parses only keys this app writes', () => {
		expect(parseMediaKey('media/t1/p1/file.jpg')).toEqual({ treeId: 't1', entityId: 'p1' });
		for (const bad of ['exports/t1-1.ged', 'media/t1/p1', 'media/t1/p1/a/b.jpg', 'media//p1/x.jpg', '../media/t1/p1/x.jpg']) {
			expect(parseMediaKey(bad), bad).toBeNull();
		}
	});
});

describe('reading an object', () => {
	it('is refused to a non-member', async () => {
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(media().requireRead(await addMedia(idOf('@I1@')), stranger.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('is allowed for a viewer when the record is visible, and for an owner always', async () => {
		const visible = await addMedia(idOf('@I1@'));
		const hidden = await addMedia(idOf('@I2@'));
		await expect(media().requireRead(visible, actors.viewer.context)).resolves.toBeUndefined();
		await expect(media().requireRead(hidden, actors.owner.context)).resolves.toBeUndefined();
		await expect(media().requireRead(hidden, actors.editor.context)).resolves.toBeUndefined();
	});
	it('answers a private person\'s object exactly as a missing one', async () => {
		const hidden = await addMedia(idOf('@I2@'));
		const missing = `media/${treeId}/no-such-person/${crypto.randomUUID()}.jpg`;
		const a = await media().requireRead(hidden, actors.viewer.context).catch((e) => e);
		const b = await media().requireRead(missing, actors.viewer.context).catch((e) => e);
		expect(a).toBeInstanceOf(NotFoundError);
		expect(b).toBeInstanceOf(NotFoundError);
		expect(a.message.replace(hidden, 'KEY')).toBe(b.message.replace(missing, 'KEY'));
	});
	it('does not trust a key that names another tree', async () => {
		const other = await createTestTree(t.db, actors.owner);
		await expect(media().requireRead(`media/${other}/x/f.jpg`, actors.viewer.context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
});

describe('adding an object', () => {
	it.each(['contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(media().requireUpload(treeId, idOf('@I1@'), actors[role].context)).rejects.toBeInstanceOf(UnauthorizedError);
	});
	it('is allowed for an editor, but only onto a record of this tree', async () => {
		await expect(media().requireUpload(treeId, idOf('@I1@'), actors.editor.context)).resolves.toBeUndefined();
		await expect(media().requireUpload(treeId, 'not-a-record', actors.editor.context)).rejects.toBeInstanceOf(ValidationError);
		const other = await createTestTree(t.db, actors.owner);
		await addTestMember(t.db, other, actors.editor, 'editor');
		await expect(media().requireUpload(other, idOf('@I1@'), actors.editor.context)).rejects.toBeInstanceOf(ValidationError);
	});
});
