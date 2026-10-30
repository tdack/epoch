import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { installMeta } from '../db/schema';
import { resetAccessConfigCache, resolveAccessConfig } from './access-config';

let t: TestDatabase;

beforeAll(async () => {
	t = await createTestDatabase();
});

afterAll(async () => {
	await t.dispose();
});

beforeEach(async () => {
	await t.db.delete(installMeta);
	resetAccessConfigCache();
});

const NO_VARS = { teamDomain: '', aud: '' };

async function storeConfig() {
	await t.db.insert(installMeta).values({
		installId: 'install-1',
		ownerEmail: 'owner@example.com',
		accessTeamDomain: 'family.cloudflareaccess.com',
		accessAud: 'stored-aud'
	});
}

describe('resolveAccessConfig', () => {
	it('uses the vars when both are set, without reading D1', async () => {
		await storeConfig();
		const vars = { teamDomain: 'setup.cloudflareaccess.com', aud: 'var-aud' };
		expect(await resolveAccessConfig(vars, t.d1)).toEqual(vars);
	});

	it('falls back to what /setup stored when the Worker has no vars', async () => {
		await storeConfig();
		expect(await resolveAccessConfig(NO_VARS, t.d1)).toEqual({
			teamDomain: 'family.cloudflareaccess.com',
			aud: 'stored-aud'
		});
	});

	it('stays empty, and so fails closed, when nothing is configured', async () => {
		expect(await resolveAccessConfig(NO_VARS, t.d1)).toEqual(NO_VARS);
	});

	it('does not remember "none yet", so the first sign-in after /setup is checked', async () => {
		expect(await resolveAccessConfig(NO_VARS, t.d1)).toEqual(NO_VARS);
		await storeConfig();
		expect((await resolveAccessConfig(NO_VARS, t.d1)).aud).toBe('stored-aud');
	});
});
