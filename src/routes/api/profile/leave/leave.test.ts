/** POST /api/profile/leave: the confirmation, the blockers, the visitor, and the farewell email. */

import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PUBLIC_VISITOR } from '#lib/server/domain/identity.js';
import { FakeMediaBucket } from '#lib/server/testing/fake-bucket.js';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '#lib/server/testing/d1.js';
import { UserRepository } from '#lib/server/repositories/user-repository.js';
import { POST } from './+server.js';

let t: TestDatabase;
let owner: TestActor;

beforeAll(async () => {
	t = await createTestDatabase();
	owner = await createTestUser(t.db, 'owner');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

function leave(
	actor: TestActor | null,
	confirmEmail: string,
	env: Record<string, unknown> = {},
	isInstallOwner = false
) {
	const request = new Request('http://localhost/api/profile/leave', {
		method: 'POST',
		body: JSON.stringify({ confirmEmail })
	});
	return POST({
		request,
		url: new URL(request.url),
		params: {},
		locals: {
			user:
				actor === null
					? PUBLIC_VISITOR
					: { ...actor.context.user, ...(isInstallOwner && { isInstallOwner }) },
			correlationId: 'leave-test'
		},
		platform: { env: { DB: t.d1, MEDIA_BUCKET: new FakeMediaBucket(), ...env } }
	} as unknown as RequestEvent);
}

async function member(label: string) {
	const actor = await createTestUser(t.db, label);
	await addTestMember(t.db, await createTestTree(t.db, owner), actor, 'viewer');
	return actor;
}

describe('POST /api/profile/leave', () => {
	it('refuses the visitor, a wrong address, and the install owner', async () => {
		const me = await member('a');
		expect((await leave(null, 'x')).status).toBe(403);
		expect((await leave(me, 'nope@epoch.test')).status).toBe(400);
		expect((await leave(me, me.context.user.email, {}, true)).status).toBe(409);
		expect(await new UserRepository(t.db).hasAnyMembership(me.userId)).toBe(true);
	});

	it('refuses the sole owner of a tree with 409 and names it', async () => {
		const solo = await createTestUser(t.db, 'solo');
		await createTestTree(t.db, solo);
		const response = await leave(solo, solo.context.user.email);
		expect(response.status).toBe(409);
		expect(
			((await response.json()) as { details: { soleOwnerTrees: unknown[] } }).details.soleOwnerTrees
		).toHaveLength(1);
	});

	it('leaves and sends the farewell, listing the tree owner', async () => {
		const me = await member('b');
		const send = vi.fn(async () => ({}));
		const response = await leave(me, me.context.user.email, {
			EMAIL: { send },
			EPOCH_EMAIL_SENDER: 'epoch@example.com'
		});
		expect(response.status).toBe(200);
		expect(await new UserRepository(t.db).hasAnyMembership(me.userId)).toBe(false);
		expect(send).toHaveBeenCalledOnce();
		const message = (send.mock.calls[0] as unknown as [Record<string, string>])[0];
		expect(message.to).toBe(me.context.user.email);
		expect(message.subject).toBe('Sorry to see you go');
		// createTestUser stores a suffixed address, so the owner's name is what identifies them here.
		expect(message.text).toContain('owner: owner (owner-');
	});

	it('still leaves when the email fails, and when there is no email binding', async () => {
		const failing = await member('c');
		const send = vi.fn(async () => {
			throw new Error('down');
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const response = await leave(failing, failing.context.user.email, {
			EMAIL: { send },
			EPOCH_EMAIL_SENDER: 'epoch@example.com'
		});
		expect(response.status).toBe(200);
		expect(await new UserRepository(t.db).hasAnyMembership(failing.userId)).toBe(false);
		const quiet = await member('d');
		expect((await leave(quiet, quiet.context.user.email)).status).toBe(200);
	});
});
