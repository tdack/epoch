/**
 * `/setup` is open only on an unclaimed workers.dev install (ADR-082), and never hands the token
 * back. The claim itself is tested in `claim-install.test.ts`; nothing here reaches Cloudflare.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installMeta } from '#lib/server/db/schema/index.js';
import { createTestDatabase, type TestDatabase } from '#lib/server/testing/d1.js';
import { actions, load } from './+page.server.js';
import { load as welcomeLoad } from '../welcome/+page.server.js';

let t: TestDatabase;

beforeAll(async () => {
	t = await createTestDatabase();
});

afterAll(async () => {
	await t.dispose();
});

beforeEach(async () => {
	await t.db.delete(installMeta);
});

const OPEN_HOST = 'https://epoch-genealogy.dacks.workers.dev';

function event(origin: string, path = '/setup', body?: Record<string, string>) {
	return {
		url: new URL(path, origin),
		platform: { env: { DB: t.d1 } },
		locals: { user: null, notAdmitted: null, hostTree: null, correlationId: 'test' },
		setHeaders: () => {},
		request: new Request(new URL(path, origin), {
			method: body ? 'POST' : 'GET',
			body: body ? new URLSearchParams(body) : undefined
		})
	} as never;
}

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
	try {
		await promise;
		return null;
	} catch (err) {
		return (err as { status?: number }).status ?? -1;
	}
}

async function claimed() {
	await t.db.insert(installMeta).values({ installId: 'i', ownerEmail: 'owner@example.com' });
}

describe('the setup page', () => {
	it('opens on an unclaimed workers.dev install, linking to the token template', async () => {
		const data = (await load(event(OPEN_HOST))) as Record<string, string>;
		expect(data.address).toBe('epoch-genealogy.dacks.workers.dev');
		expect(data.tokenTemplateUrl).toMatch(
			/^https:\/\/dash\.cloudflare\.com\/\?to=\/:account\/api-tokens/
		);
	});

	it('is a 404 on any other host, and once an owner is recorded', async () => {
		expect(await statusOf(Promise.resolve(load(event('https://epoch.example.com'))))).toBe(404);
		await claimed();
		expect(await statusOf(Promise.resolve(load(event(OPEN_HOST))))).toBe(404);
		expect(
			await statusOf(
				Promise.resolve(
					actions.default(event(OPEN_HOST, '/setup', { ownerEmail: 'x@y.z', token: 't' }))
				)
			)
		).toBe(404);
	});

	it('asks for a missing token, and never returns one it was given', async () => {
		const missing = (await actions.default(
			event(OPEN_HOST, '/setup', { ownerEmail: 'owner@example.com', token: '' })
		)) as { status: number; data: Record<string, unknown> };
		expect(missing.status).toBe(400);
		expect(missing.data.message).toMatch(/Paste the API token/);

		const refused = (await actions.default(
			event(OPEN_HOST, '/setup', { ownerEmail: 'not an address', token: 'secret-token' })
		)) as { status: number; data: Record<string, unknown> };
		expect(refused.status).toBe(400);
		expect(JSON.stringify(refused.data)).not.toContain('secret-token');
	});
});

describe('the welcome page on a fresh button install', () => {
	it('sends a signed-out visitor to /setup until an owner is recorded', async () => {
		const toWelcome = () => Promise.resolve(welcomeLoad(event(OPEN_HOST, '/welcome')));
		let location: string | null = null;
		try {
			await toWelcome();
		} catch (err) {
			location = (err as { location?: string }).location ?? null;
		}
		expect(location).toBe('/setup');
		await claimed();
		expect(await statusOf(toWelcome())).toBeNull();
	});

	it('leaves an install on its own domain alone', async () => {
		expect(
			await statusOf(Promise.resolve(welcomeLoad(event('https://epoch.example.com', '/welcome'))))
		).toBeNull();
	});
});
