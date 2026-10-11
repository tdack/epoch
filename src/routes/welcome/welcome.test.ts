/**
 * The welcome page's state, and `/login`'s, come from who the hook decided is asking, never from
 * the query string (ADR-034).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { trees } from '#lib/server/db/schema/index.js';
import { createTestDatabase, type TestDatabase } from '#lib/server/testing/d1.js';
import type { AccessIdentity, UserIdentity } from '#lib/server/domain/identity.js';
import { load as welcomeLoad } from './+page.server.js';
import { load as loginLoad } from '../login/+page.server.js';

const STRANGER: AccessIdentity = { accessSub: 'sub-s', email: 'stranger@example.com' };
const MEMBER: UserIdentity = { id: 'u1', accessSub: 'sub-m', email: 'member@example.com' };

function eventFor(
	path: string,
	locals: { user: UserIdentity | null; notAdmitted: AccessIdentity | null }
) {
	const headers: Record<string, string> = {};
	const event = {
		locals: { ...locals, correlationId: 'test' },
		url: new URL(path, 'https://epoch.test'),
		setHeaders: (set: Record<string, string>) => Object.assign(headers, set)
	};
	return { event: event as unknown as Parameters<typeof welcomeLoad>[0], headers };
}

async function welcome(path: string, locals: Parameters<typeof eventFor>[1]) {
	const { event, headers } = eventFor(path, locals);
	return { data: (await welcomeLoad(event)) as Record<string, unknown>, headers };
}

describe('the welcome page', () => {
	it('names a visitor who is not admitted and offers sign-out, uncached', async () => {
		const { data, headers } = await welcome('/welcome?reason=not-invited', {
			user: null,
			notAdmitted: STRANGER
		});
		expect(data).toMatchObject({
			state: 'not-invited',
			actionHref: '/cdn-cgi/access/logout',
			notAdmittedEmail: 'stranger@example.com'
		});
		expect(headers['cache-control']).toBe('no-store');
	});

	it('ignores ?reason= for anyone else', async () => {
		expect(
			(await welcome('/welcome?reason=not-invited', { user: MEMBER, notAdmitted: null })).data
		).toMatchObject({ state: 'signed-in', actionHref: '/', notAdmittedEmail: null });
		expect(
			(await welcome('/welcome?reason=not-invited&next=/trees', { user: null, notAdmitted: null }))
				.data
		).toMatchObject({ state: 'signed-out', actionHref: '/login?next=%2Ftrees' });
	});
});

describe('the login page', () => {
	it('sends a visitor who is not admitted to the not-invited page, not back to sign in', async () => {
		const { event } = eventFor('/login?next=/trees', { user: null, notAdmitted: STRANGER });
		let thrown: unknown;
		try {
			await loginLoad(event as unknown as Parameters<typeof loginLoad>[0]);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toMatchObject({ status: 303, location: '/welcome?reason=not-invited' });
	});
});

describe('the welcome page with a public tree (ADR-040)', () => {
	let t: TestDatabase;
	beforeAll(async () => {
		t = await createTestDatabase();
		await t.db.insert(trees).values([
			{ id: 'royal', name: 'Royal family' },
			{ id: 'private', name: 'Ours' }
		]);
	});
	afterAll(async () => {
		await t.dispose();
	});

	const withDb = async (locals: Parameters<typeof eventFor>[1]) => {
		const { event } = eventFor('/welcome', locals);
		return (await welcomeLoad({
			...event,
			platform: { env: { DB: t.d1 } }
		} as unknown as Parameters<typeof welcomeLoad>[0])) as Record<string, unknown>;
	};

	it('offers no link while no tree is public, and names the tree once one is', async () => {
		expect(await withDb({ user: null, notAdmitted: null })).toMatchObject({ publicTree: null });
		await t.db.update(trees).set({ isPublic: true }).where(eq(trees.id, 'royal'));
		expect(await withDb({ user: null, notAdmitted: null })).toMatchObject({
			publicTree: { name: 'Royal family', href: '/trees/royal' }
		});
	});

	it('does not offer it to someone Access named, who would only be sent back', async () => {
		expect(await withDb({ user: null, notAdmitted: STRANGER })).toMatchObject({ publicTree: null });
	});
});
