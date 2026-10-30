import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { installMeta } from '../db/schema';
import { InstallRepository } from './install-repository';

let t: TestDatabase;
let repo: InstallRepository;

beforeAll(async () => {
	t = await createTestDatabase();
	repo = new InstallRepository(t.db);
});

afterAll(async () => {
	await t.dispose();
});

beforeEach(async () => {
	await t.db.delete(installMeta);
});

const claim = {
	installId: 'install-1',
	ownerEmail: ' Owner@Example.com ',
	accessTeamDomain: 'family.cloudflareaccess.com',
	accessAud: 'aud-1'
};

describe('InstallRepository.claim', () => {
	it('records the owner, lower-cased, and the Access settings', async () => {
		expect(await repo.hasOwner()).toBe(false);
		expect(await repo.claim(claim)).toBe(true);
		expect(await repo.findOwnerEmail()).toBe('owner@example.com');
		expect(await repo.findAccessConfig()).toEqual({
			teamDomain: 'family.cloudflareaccess.com',
			aud: 'aud-1'
		});
	});

	it('refuses a second claim, leaving the first owner in place', async () => {
		await repo.claim(claim);
		expect(
			await repo.claim({ ...claim, installId: 'install-2', ownerEmail: 'other@example.com' })
		).toBe(false);
		expect(await repo.findOwnerEmail()).toBe('owner@example.com');
	});

	it('refuses a claim on an install that ./setup already owns', async () => {
		await t.db.insert(installMeta).values({ installId: 'setup', ownerEmail: 'setup@example.com' });
		expect(await repo.claim(claim)).toBe(false);
		expect(await repo.findAccessConfig()).toBeNull();
	});
});
