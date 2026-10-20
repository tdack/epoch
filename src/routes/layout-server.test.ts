import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { DEFAULT_PALETTE, type Palette } from '#lib/shared/palette.js';
import { PUBLIC_VISITOR, type UserIdentity } from '#lib/server/domain/identity.js';
import { SettingsRepository } from '#lib/server/repositories/settings-repository.js';
import { SettingsService } from '#lib/server/services/settings-service.js';
import { createTestDatabase, createTestUser, type TestDatabase } from '#lib/server/testing/d1.js';
import { SETTINGS_DEPENDENCY } from '#lib/shared/settings.js';
import { load } from './+layout.server';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
	await new SettingsRepository(t.db).saveSiteData(
		JSON.stringify({
			version: 1,
			sexColours: { male: '#3a6ea5', female: '#b8607f', unknown: '#7d756a' }
		}),
		new Date()
	);
});
afterAll(async () => {
	await t.dispose();
});

interface Appearance {
	palette: Palette;
	isMotionReduced: boolean;
}

/** `null` for `db` stands for a platform with no D1 binding at all. */
async function run(user: UserIdentity | null, db: D1Database | null = t.d1) {
	const depends = vi.fn();
	const event = {
		platform: { env: { DB: db ?? undefined } },
		locals: { user, notAdmitted: null, correlationId: 'layout-test' },
		depends
	};
	const data = (await load(event as unknown as Parameters<typeof load>[0])) as Appearance;
	return { data, depends };
}

describe('root layout load', () => {
	it('gives anyone signed out and the public visitor the site default', async () => {
		for (const user of [null, PUBLIC_VISITOR]) {
			const { data, depends } = await run(user);
			expect(data.palette.sex.male.border).toBe('#3a6ea5');
			expect(data.isMotionReduced).toBe(false);
			expect(depends).toHaveBeenCalledWith(SETTINGS_DEPENDENCY);
		}
	});

	it("lets a user's own colours and motion setting win over the site default", async () => {
		const user = await createTestUser(t.db, 'layout');
		await new SettingsService(t.db).updateMine(
			{
				sexColours: { male: '#4a86c8', female: '#b8607f', unknown: '#7d756a' },
				isMotionReduced: true
			},
			user.context
		);
		const { data } = await run(user.context.user);
		expect(data.palette.sex.male.border).toBe('#4a86c8');
		expect(data.isMotionReduced).toBe(true);
	});

	it('falls back to the built-in palette when settings cannot be read', async () => {
		const broken = {
			prepare: () => {
				throw new Error('no such table: site_settings');
			}
		} as unknown as D1Database;
		const { data } = await run(null, broken);
		expect(data.palette).toEqual(DEFAULT_PALETTE);
		expect(data.isMotionReduced).toBe(false);
	});

	it('names the signed-in user for the header, and nobody for a visitor or a signed-out reader', async () => {
		const user = await createTestUser(t.db, 'viewer');
		const { data } = await run(user.context.user);
		expect((data as unknown as { viewer: unknown }).viewer).toEqual({
			email: expect.stringContaining('@epoch.test'),
			name: 'viewer',
			avatarUrl: null,
			canUseAccessPicture: false
		});
		for (const none of [null, PUBLIC_VISITOR]) {
			const { data: anon } = await run(none);
			expect((anon as unknown as { viewer: unknown }).viewer).toBeNull();
		}
	});

	it('keeps the user in the header when the profile cannot be read', async () => {
		const broken = {
			prepare: () => {
				throw new Error('no such table: users');
			}
		} as unknown as D1Database;
		const user = await createTestUser(t.db, 'broken');
		const { data } = await run(user.context.user, broken);
		expect((data as unknown as { viewer: { name: string } }).viewer.name).toBe('broken');
	});

	it('falls back without a database at all', async () => {
		const { data } = await run(null, null);
		expect(data.palette).toEqual(DEFAULT_PALETTE);
	});
});
