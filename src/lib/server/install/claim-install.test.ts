import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { installMeta } from '../db/schema';
import { InstallRepository } from '../repositories/install-repository';
import type { AccessAppRequest, AccessApplication, CloudflareApi } from './cloudflare-api';
import { accessNames, claimInstall, parseWorkersDevHost } from './claim-install';

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

const HOST = { workerName: 'epoch-genealogy', subdomain: 'dacks' };
const LOGIN_DOMAIN = 'epoch-genealogy.dacks.workers.dev/login';

/** One account that serves `dacks.workers.dev`, with an organisation and one login method. */
function fakeApi(overrides: Partial<CloudflareApi> = {}) {
	const created: { policies: string[]; apps: AccessAppRequest[] } = { policies: [], apps: [] };
	const api: CloudflareApi = {
		listAccounts: async () => [
			{ id: 'other', name: 'Someone else' },
			{ id: 'acc1', name: 'Family' }
		],
		getWorkersSubdomain: async (id) => (id === 'acc1' ? 'dacks' : 'stranger'),
		hasWorker: async (id, name) => id === 'acc1' && name === 'epoch-genealogy',
		getTeamDomain: async () => 'dacks.cloudflareaccess.com',
		listIdentityProviders: async () => [{ id: 'otp', name: 'One-time PIN' }],
		findPolicyByName: async () => null,
		createOwnerPolicy: async (_id, name) => {
			created.policies.push(name);
			return { id: 'pol1' };
		},
		findAppByDomain: async () => null,
		createApp: async (_id, app): Promise<AccessApplication> => {
			created.apps.push(app);
			return { id: 'app1', name: app.name, domain: app.domain, aud: 'aud1' };
		},
		...overrides
	};
	return { api, created };
}

function claim(api: CloudflareApi, ownerEmail = 'Owner@Example.com') {
	return claimInstall({
		host: HOST,
		ownerEmail,
		api,
		install: new InstallRepository(t.db),
		newInstallId: () => 'install-1'
	});
}

describe('parseWorkersDevHost', () => {
	it('reads the Worker and subdomain from a workers.dev host', () => {
		expect(parseWorkersDevHost('Epoch-Genealogy.Dacks.workers.dev')).toEqual(HOST);
	});

	it('refuses any other host', () => {
		expect(parseWorkersDevHost('epoch.example.com')).toBeNull();
		expect(parseWorkersDevHost('dacks.workers.dev')).toBeNull();
		expect(parseWorkersDevHost('a.b.c.workers.dev')).toBeNull();
		expect(parseWorkersDevHost('evil.dacks.workers.dev.example.com')).toBeNull();
	});
});

describe('claimInstall', () => {
	it('makes the policy and the app on /login, then records the owner', async () => {
		const { api, created } = fakeApi();
		const result = await claim(api);
		expect(result).toEqual({
			accountName: 'Family',
			isAppForeign: false,
			policyName: 'Epoch epoch-genealogy sign-in',
			ownerEmail: 'owner@example.com'
		});
		expect(created.policies).toEqual([accessNames('epoch-genealogy').policy]);
		expect(created.apps[0]).toMatchObject({
			name: 'Epoch (epoch-genealogy)',
			domain: LOGIN_DOMAIN,
			policyIds: ['pol1'],
			idpIds: ['otp']
		});
		const install = new InstallRepository(t.db);
		expect(await install.findOwnerEmail()).toBe('owner@example.com');
		expect(await install.findAccessConfig()).toEqual({
			teamDomain: 'dacks.cloudflareaccess.com',
			aud: 'aud1'
		});
	});

	it('refuses a token for an account that does not serve this host, and records nothing', async () => {
		const { api } = fakeApi({ getWorkersSubdomain: async () => 'stranger' });
		await expect(claim(api)).rejects.toThrow(/cannot see the account that serves dacks/);
		expect(await new InstallRepository(t.db).hasOwner()).toBe(false);
	});

	it('refuses a preview alias, whose name is no Worker', async () => {
		const { api, created } = fakeApi({ hasWorker: async () => false });
		await expect(claim(api)).rejects.toThrow(/not a preview/);
		expect(created.apps).toEqual([]);
	});

	it('says to create an organisation or a login method first', async () => {
		await expect(claim(fakeApi({ getTeamDomain: async () => null }).api)).rejects.toThrow(
			/no Zero Trust organisation/
		);
		await expect(claim(fakeApi({ listIdentityProviders: async () => [] }).api)).rejects.toThrow(
			/no login method/
		);
	});

	it("reuses its own app on a retry, without calling it someone else's", async () => {
		const { api, created } = fakeApi({
			findAppByDomain: async (_id, domain) => ({
				id: 'app0',
				name: 'Epoch (epoch-genealogy)',
				domain,
				aud: 'aud0'
			})
		});
		expect((await claim(api)).isAppForeign).toBe(false);
		expect(created).toEqual({ policies: [], apps: [] });
	});

	it('reuses an app it did not name on /login, creating nothing, and says so', async () => {
		const { api, created } = fakeApi({
			findAppByDomain: async (_id, domain) =>
				domain === LOGIN_DOMAIN
					? { id: 'app0', name: 'Family sign-in', domain, aud: 'aud0' }
					: null,
			findPolicyByName: async () => ({ id: 'pol0' })
		});
		expect((await claim(api)).isAppForeign).toBe(true);
		expect(created).toEqual({ policies: [], apps: [] });
		expect((await new InstallRepository(t.db).findAccessConfig())?.aud).toBe('aud0');
	});

	it('refuses an address that is not one, before calling Cloudflare', async () => {
		let didCall = false;
		const { api } = fakeApi({
			listAccounts: async () => {
				didCall = true;
				return [];
			}
		});
		await expect(claim(api, 'not an address')).rejects.toThrow(/email address/);
		expect(didCall).toBe(false);
	});

	it('refuses once the install has an owner', async () => {
		await t.db.insert(installMeta).values({ installId: 'setup', ownerEmail: 'setup@example.com' });
		await expect(claim(fakeApi().api)).rejects.toThrow(/already has an owner/);
	});
});
