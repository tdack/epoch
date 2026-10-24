import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import migration from '../../../../drizzle/0042_media_links.sql?raw';
import { mediaItems, mediaLinks } from '../db/schema';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';

let t: TestDatabase;

beforeAll(async () => {
	t = await createTestDatabase();
}, 30_000);

afterAll(async () => {
	await t.dispose();
});

/** The backfill is the migration's last statement; the table already exists in the test database. */
const backfill = migration
	.split('--> statement-breakpoint')
	.map((statement) => statement.trim())
	.filter((statement) => statement.startsWith('INSERT INTO `media_links`'))[0]!;

describe('migration 0042 backfill', () => {
	it('links every file that had an owner and leaves a detached file alone', async () => {
		const owner = await createTestUser(t.db, 'owner');
		const treeId = await createTestTree(t.db, owner);
		const file = (id: string, entityId: string | null) => ({
			id,
			treeId,
			entityId,
			r2ObjectKey: `media/${treeId}/${id}.png`,
			mimeType: 'image/png',
			createdAt: new Date(1_700_000_000_000)
		});
		await t.db
			.insert(mediaItems)
			.values([file('owned', 'person-1'), file('on-source', 'source-1'), file('loose', null)]);
		await t.db.delete(mediaLinks).where(eq(mediaLinks.treeId, treeId));

		await t.d1.prepare(backfill).run();

		const links = await t.db.select().from(mediaLinks).where(eq(mediaLinks.treeId, treeId));
		expect(links.map((l) => [l.id, l.mediaId, l.entityId]).sort()).toEqual([
			['on-source:source-1', 'on-source', 'source-1'],
			['owned:person-1', 'owned', 'person-1']
		]);
		expect(links[0]!.createdAt).toEqual(new Date(1_700_000_000_000));
	});
});
