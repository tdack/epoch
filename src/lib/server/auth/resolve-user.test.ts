import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestDatabase
} from '../testing/d1';
import { installMeta, treeInvitations, users } from '../db/schema';
import { resolveUser, type ResolveOptions } from './resolve-user';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const OWNER_EMAIL = 'owner@epoch.test';
const asOwnerless: ResolveOptions = { fallbackId: 'unused', fallbackOwnerEmail: null };

async function withOwner(email: string | null, run: () => Promise<void>) {
	if (email) await t.db.insert(installMeta).values({ installId: 'install-1', ownerEmail: email });
	try {
		await run();
	} finally {
		await t.db.delete(installMeta);
	}
}

async function userRowsFor(accessSub: string) {
	return t.db.select().from(users).where(eq(users.accessSub, accessSub)).all();
}

describe('resolveUser', () => {
	it('upserts the owner by the stable sub: the same sub is the same user, and the email follows', async () => {
		await withOwner(OWNER_EMAIL, async () => {
			const first = await resolveUser(
				t.d1,
				{ accessSub: 'sub-resolve', email: OWNER_EMAIL, name: 'A' },
				asOwnerless
			);
			const again = await resolveUser(
				t.d1,
				{ accessSub: 'sub-resolve', email: 'Owner@Epoch.test', name: 'B' },
				asOwnerless
			);
			expect(again.user?.id).toBe(first.user?.id);
			expect(again.user).toMatchObject({
				accessSub: 'sub-resolve',
				email: 'Owner@Epoch.test',
				// Access's name only seeds the row; a later one must not overwrite it.
				name: 'A',
				isInstallOwner: true
			});
			expect(first.user?.id).not.toBe('unused');
		});
	});

	it('keeps a name the person edited, and fills one that was never set', async () => {
		await withOwner(OWNER_EMAIL, async () => {
			const first = await resolveUser(
				t.d1,
				{ accessSub: 'sub-name', email: OWNER_EMAIL, name: 'From Access' },
				asOwnerless
			);
			expect(first.user?.isNewUser).toBe(true);
			await t.db.update(users).set({ name: 'My Own Name' }).where(eq(users.accessSub, 'sub-name'));
			const again = await resolveUser(
				t.d1,
				{ accessSub: 'sub-name', email: OWNER_EMAIL, name: 'From Access' },
				asOwnerless
			);
			expect(again.user?.name).toBe('My Own Name');
			expect(again.user?.isNewUser).toBeUndefined();
			await t.db.update(users).set({ name: null }).where(eq(users.accessSub, 'sub-name'));
			await resolveUser(
				t.d1,
				{ accessSub: 'sub-name', email: OWNER_EMAIL, name: 'From Access' },
				asOwnerless
			);
			expect((await userRowsFor('sub-name'))[0]?.name).toBe('From Access');
		});
	});

	it('carries the Access picture on the request without storing it', async () => {
		await withOwner(OWNER_EMAIL, async () => {
			const admission = await resolveUser(
				t.d1,
				{
					accessSub: 'sub-pic',
					email: OWNER_EMAIL,
					name: 'P',
					pictureUrl: 'https://lh3.googleusercontent.com/a'
				},
				asOwnerless
			);
			expect(admission.user?.pictureUrl).toBe('https://lh3.googleusercontent.com/a');
			expect(JSON.stringify(await userRowsFor('sub-pic'))).not.toContain('googleusercontent');
		});
	});

	it('turns a stranger away and stores nothing about them', async () => {
		await withOwner(OWNER_EMAIL, async () => {
			const admission = await resolveUser(
				t.d1,
				{ accessSub: 'sub-stranger', email: 'stranger@epoch.test', name: 'S' },
				asOwnerless
			);
			expect(admission).toEqual({
				user: null,
				notAdmitted: { accessSub: 'sub-stranger', email: 'stranger@epoch.test', name: 'S' }
			});
			expect(await userRowsFor('sub-stranger')).toEqual([]);
		});
	});

	it('admits an invitee, redeeming the invitation on this request', async () => {
		const treeId = await createTestTree(t.db, await createTestUser(t.db, 'inviter'));
		await t.db.insert(treeInvitations).values({
			id: crypto.randomUUID(),
			treeId,
			email: 'invitee@epoch.test',
			role: 'viewer',
			expiresAt: new Date(Date.now() + 1e9)
		});
		const invitee = await resolveUser(
			t.d1,
			{ accessSub: 'sub-invitee', email: 'Invitee@Epoch.test' },
			asOwnerless
		);
		expect(invitee.user).toMatchObject({ email: 'Invitee@Epoch.test', isInstallOwner: false });
		// The invitation is spent, so the membership is what admits them from now on.
		const later = await resolveUser(
			t.d1,
			{ accessSub: 'sub-invitee', email: 'invitee@epoch.test' },
			asOwnerless
		);
		expect(later.user?.id).toBe(invitee.user?.id);
	});

	it('with no install_meta row, has no owner unless the dev bypass names one', async () => {
		const outside = await resolveUser(
			t.d1,
			{ accessSub: 'sub-first', email: 'first@epoch.test' },
			asOwnerless
		);
		expect(outside.user).toBeNull();
		expect(await userRowsFor('sub-first')).toEqual([]);

		const dev = await resolveUser(
			t.d1,
			{ accessSub: 'sub-dev', email: 'developer@epoch.local' },
			{ fallbackId: 'x', fallbackOwnerEmail: 'developer@epoch.local' }
		);
		expect(dev.user?.isInstallOwner).toBe(true);
	});

	it('lets the install_meta row, not the dev bypass, decide the owner once setup has written it', async () => {
		await withOwner(OWNER_EMAIL, async () => {
			const dev = await resolveUser(
				t.d1,
				{ accessSub: 'sub-dev-after-setup', email: 'developer@epoch.local' },
				{ fallbackId: 'x', fallbackOwnerEmail: 'developer@epoch.local' }
			);
			expect(dev.user).toBeNull();
		});
	});

	it('uses the identity as it is, under the fallback id, when no database is bound', async () => {
		expect(
			await resolveUser(
				undefined,
				{ accessSub: 'sub', email: 'e@epoch.test', name: 'N' },
				{ fallbackId: 'dev-user-id', fallbackOwnerEmail: null }
			)
		).toEqual({
			user: { id: 'dev-user-id', accessSub: 'sub', email: 'e@epoch.test', name: 'N' },
			notAdmitted: null
		});
	});
});
