import type { MessageBatch, R2Bucket } from '@cloudflare/workers-types';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { individuals, treeMemberships } from '../db/schema';
import { MAX_STAGED_BYTES } from '../gedcom/limits';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { GedcomService, type ImportQueueMessage } from '../services/gedcom-service';
import consumer from './import-consumer';

// The real check reads Wrangler's bookkeeping table, which the test database never fills.
vi.mock('../db/schema-status', () => ({ assertSchemaCurrent: async () => {} }));

const FILE = '0 HEAD\n0 @I1@ INDI\n1 NAME Ann /Fox/\n0 @I2@ INDI\n1 NAME Ben /Fox/\n0 TRLR';
const REPLACEMENT = '0 HEAD\n0 @I1@ INDI\n1 NAME Solo /Fox/\n0 TRLR';

type Env = Parameters<typeof consumer.queue>[1];

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});
beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

/**
 * An R2 stand-in that keeps what is put in it, can be made to fail on read, and reports a size per
 * object (the text's length unless `sizes` says otherwise, so a test need not build a huge string).
 */
function fakeBucket(shouldFailOnGet = false) {
	const objects = new Map<string, string>();
	const sizes = new Map<string, number>();
	const bucket = {
		put: async (key: string, value: string) => void objects.set(key, value),
		get: async (key: string) => {
			if (shouldFailOnGet) throw new Error('R2 unavailable');
			const found = objects.get(key);
			return found === undefined
				? null
				: { text: async () => found, size: sizes.get(key) ?? found.length };
		},
		delete: async (key: string) => void objects.delete(key)
	};
	return { objects, sizes, bucket: bucket as unknown as R2Bucket };
}

/** A tree with two people, and an editor's replace import sitting in the queue. */
async function queuedReplace(options: { shouldFailOnGet?: boolean } = {}) {
	const owner = await createTestUser(t.db, 'owner');
	const treeId = await createTestTree(t.db, owner);
	const editor = await createTestUser(t.db, 'editor');
	await addTestMember(t.db, treeId, editor, 'editor');
	await new GedcomService(t.db).runImport(treeId, FILE);

	const { objects, sizes, bucket } = fakeBucket(options.shouldFailOnGet);
	const key = `staging/gedcom-${treeId}-${crypto.randomUUID()}.ged`;
	objects.set(key, REPLACEMENT);
	const body: ImportQueueMessage = {
		treeId,
		r2ObjectKey: key,
		mode: 'replace',
		actorId: editor.userId
	};
	const message = { body, ack: vi.fn(), retry: vi.fn() };
	const batch = {
		messages: [message],
		retryAll: vi.fn()
	} as unknown as MessageBatch<ImportQueueMessage>;
	const env = { DB: t.d1, MEDIA_BUCKET: bucket } as unknown as Env;

	const countPeople = async () =>
		(await t.db.select().from(individuals).where(eq(individuals.treeId, treeId))).length;
	return { treeId, editor, objects, sizes, key, message, batch, env, countPeople };
}

describe('import queue consumer', () => {
	it('acks without writing when the editor was revoked after queueing', async () => {
		const q = await queuedReplace();
		await t.db
			.delete(treeMemberships)
			.where(
				and(eq(treeMemberships.treeId, q.treeId), eq(treeMemberships.userId, q.editor.userId))
			);

		await consumer.queue(q.batch, q.env);

		expect(q.message.ack).toHaveBeenCalledTimes(1);
		expect(q.message.retry).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(q.treeId));
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(q.editor.userId));
		expect(await q.countPeople()).toBe(2);
		// Nothing else would ever remove a refused user's upload from the bucket.
		expect(q.objects.has(q.key)).toBe(false);
	});

	it('acks without writing when the editor was demoted to viewer after queueing', async () => {
		const q = await queuedReplace();
		await t.db
			.update(treeMemberships)
			.set({ role: 'viewer' })
			.where(
				and(eq(treeMemberships.treeId, q.treeId), eq(treeMemberships.userId, q.editor.userId))
			);

		await consumer.queue(q.batch, q.env);

		expect(q.message.ack).toHaveBeenCalledTimes(1);
		expect(q.message.retry).not.toHaveBeenCalled();
		expect(await q.countPeople()).toBe(2);
	});

	it('runs the replace and acks for an editor who still holds the right', async () => {
		const q = await queuedReplace();

		await consumer.queue(q.batch, q.env);

		expect(q.message.ack).toHaveBeenCalledTimes(1);
		expect(q.message.retry).not.toHaveBeenCalled();
		expect(await q.countPeople()).toBe(1);
		expect(q.objects.size).toBe(0);
	});

	it('drops a staged file over the size cap without reading it, and removes it', async () => {
		const q = await queuedReplace();
		q.sizes.set(q.key, MAX_STAGED_BYTES + 1);

		await consumer.queue(q.batch, q.env);

		expect(q.message.ack).toHaveBeenCalledTimes(1);
		expect(q.message.retry).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('too large'));
		expect(await q.countPeople()).toBe(2);
		expect(q.objects.has(q.key)).toBe(false);
	});

	it('retries a transient failure rather than dropping the message', async () => {
		const q = await queuedReplace({ shouldFailOnGet: true });

		await consumer.queue(q.batch, q.env);

		expect(q.message.retry).toHaveBeenCalledTimes(1);
		expect(q.message.ack).not.toHaveBeenCalled();
		expect(await q.countPeople()).toBe(2);
	});
});
