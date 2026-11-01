/**
 * What the screens read of an object (ADR-082, task 2.5): the Files list says which other files an
 * object has and what its record calls it, and a person's page shows secondary files, fact-level
 * links and unresolved files with the placeholder key withheld.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { events, individuals, mediaItems, mediaLinks, mediaObjects } from '../db/schema';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { mediaLinkId, unresolvedMediaKey } from '../../shared/media';
import { MediaService } from './media-service';
import { PersonPageService } from './person-page-service';

let t: TestDatabase;
let owner: TestActor;
let treeId: string;
const PERSON = 'screen-person';
const FACT = 'screen-birth';

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, owner);
	await t.db.insert(individuals).values({ id: PERSON, treeId, givenName: 'Ada' });
	await t.db
		.insert(events)
		.values({ id: FACT, treeId, entityType: 'INDIVIDUAL', entityId: PERSON, type: 'BIRT' });

	// o1: two files, one record link titled; the second file is unresolved.
	await t.db.insert(mediaObjects).values({ id: 'o1', treeId });
	await t.db.insert(mediaItems).values([
		{
			id: 'o1',
			treeId,
			objectId: 'o1',
			sortOrder: 0,
			r2ObjectKey: `media/${treeId}/o1.png`,
			mimeType: 'image/png',
			title: 'Front',
			sizeBytes: 10
		},
		{
			id: 'o1-b',
			treeId,
			objectId: 'o1',
			sortOrder: 1,
			status: 'unresolved',
			r2ObjectKey: unresolvedMediaKey('o1-b'),
			gedcomPath: 'https://example.org/back.jpg',
			mimeType: 'image/jpeg',
			// A stale size, as an undone resolve leaves behind.
			sizeBytes: 99
		}
	]);
	await t.db.insert(mediaLinks).values({
		id: mediaLinkId('o1', PERSON),
		treeId,
		mediaId: 'o1',
		entityId: PERSON,
		title: 'Wedding'
	});
	// o2: one file, linked to the person's birth only, after o1 in the section.
	await t.db.insert(mediaObjects).values({ id: 'o2', treeId });
	await t.db.insert(mediaItems).values({
		id: 'o2',
		treeId,
		objectId: 'o2',
		r2ObjectKey: `media/${treeId}/o2.png`,
		mimeType: 'image/png'
	});
	await t.db.insert(mediaLinks).values({
		id: mediaLinkId('o2', PERSON, FACT),
		treeId,
		mediaId: 'o2',
		entityId: PERSON,
		factId: FACT
	});
}, 60_000);

afterAll(async () => {
	await t.dispose();
});

describe('the Files list', () => {
	it('lists one row per object with its other files and its record’s title', async () => {
		const { files } = await new MediaService(t.db).list(owner.context, {
			treeId,
			entityId: PERSON,
			limit: 100
		});
		const row = files.find((f) => f.id === 'o1')!;
		expect(row.hostLink).toEqual({ title: 'Wedding', sortOrder: 0 });
		expect(row.extraFiles).toHaveLength(1);
		expect(row.extraFiles[0]).toMatchObject({
			id: 'o1-b',
			isUnresolved: true,
			gedcomPath: 'https://example.org/back.jpg',
			previewKey: null,
			sizeBytes: null
		});
		expect(files.map((f) => f.id)).not.toContain('o1-b');
	});

	it('has no host link when the list is not narrowed to a record', async () => {
		const { files } = await new MediaService(t.db).list(owner.context, { treeId, limit: 100 });
		expect(files.find((f) => f.id === 'o1')?.hostLink).toBeNull();
	});
});

describe('a person’s media section', () => {
	it('shows the record’s file first, a fact’s file labelled, and withholds the placeholder key', async () => {
		const page = await new PersonPageService(t.db).getPerson(treeId, PERSON, owner.context);
		expect(page.media.map((m) => [m.id, m.factLabel, m.linkTitle])).toEqual([
			['o1', null, 'Wedding'],
			['o2', 'Birth', null]
		]);
		const first = page.media[0]!;
		expect(first.extraFiles).toEqual([
			expect.objectContaining({ id: 'o1-b', isUnresolved: true, r2ObjectKey: null })
		]);
		expect(first.objectVersion).toBe(1);
	});
});
