import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_VISITOR } from '../domain/identity';
import { UnauthorizedError, ValidationError } from '../domain/errors';
import { createTestDatabase, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { settingsPatchSchema } from '../validation/schemas';
import { SettingsService } from './settings-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const service = () => new SettingsService(t.db);
const visitor = { user: PUBLIC_VISITOR, correlationId: 'test-visitor' };

describe('settings', () => {
	it('round-trips a user colour and resolves it for that user only', async () => {
		const user = await createTestUser(t.db, 'round-trip');
		await service().updateMine(
			{ sexColours: { male: '#4a86c8', female: '#b8607f', unknown: '#7d756a' } },
			user.context
		);

		const view = await service().view(user.context);
		expect(view.user.sexColours?.male).toBe('#4a86c8');
		expect(view.effective.sexColours.male).toBe('#4a86c8');

		const other = await createTestUser(t.db, 'bystander');
		expect((await service().view(other.context)).effective.sexColours.male).toBe('#5a84b5');
	});

	it('clears a group back to inheriting when sent as null', async () => {
		const user = await createTestUser(t.db, 'clear');
		await service().updateMine(
			{ focusColours: { ancestor: '#101010', descendant: '#0f766e', partner: '#7c3a72' } },
			user.context
		);
		const cleared = await service().updateMine({ focusColours: null }, user.context);
		expect(cleared.user.focusColours).toBeUndefined();
		expect(cleared.effective.focusColours.ancestor).toBe('#8a5a14');
	});

	it('refuses a contrast floor breach and stores nothing', async () => {
		const user = await createTestUser(t.db, 'floor');
		await expect(
			service().updateMine(
				{ sexColours: { male: '#ffff00', female: '#b8607f', unknown: '#7d756a' } },
				user.context
			)
		).rejects.toBeInstanceOf(ValidationError);
		expect((await service().view(user.context)).user.sexColours).toBeUndefined();
	});

	it('lets the public visitor read the site default, and refuses them any write', async () => {
		const view = await service().view(visitor);
		expect(view.user).toEqual({});
		await expect(service().updateMine({ isMotionReduced: true }, visitor)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});

	it('refuses a site default from anyone but the install owner', async () => {
		const user = await createTestUser(t.db, 'not-owner');
		await expect(
			service().updateSite(
				{ focusColours: { ancestor: '#101010', descendant: '#0f766e', partner: '#7c3a72' } },
				user.context
			)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('lets the owner set the site default, which a reader without a choice inherits', async () => {
		const owner = await createTestUser(t.db, 'owner');
		const ownerContext = {
			...owner.context,
			user: { ...owner.context.user, isInstallOwner: true }
		};
		await service().updateSite(
			{ focusColours: { ancestor: '#202020', descendant: '#0f766e', partner: '#7c3a72' } },
			ownerContext
		);

		const reader = await service().resolveFor(null);
		expect(reader.palette.focus.ancestor).toBe('#202020');
		expect(reader.isMotionReduced).toBe(false);
	});

	it('keeps motion a personal setting', async () => {
		const user = await createTestUser(t.db, 'motion');
		const view = await service().updateMine({ isMotionReduced: true }, user.context);
		expect(view.effective.isMotionReduced).toBe(true);
		expect((await service().resolveFor(user.userId)).isMotionReduced).toBe(true);
	});
});

describe('settings request validation', () => {
	it('rejects a colour that is not six-digit hex', () => {
		expect(
			settingsPatchSchema.safeParse({
				sexColours: { male: 'red', female: '#b8607f', unknown: '#7d756a' }
			}).success
		).toBe(false);
		expect(
			settingsPatchSchema.safeParse({
				focusColours: { ancestor: 'javascript:alert(1)', descendant: '#0f766e', partner: '#7c3a72' }
			}).success
		).toBe(false);
	});

	it('strips keys it does not know rather than storing them', () => {
		const parsed = settingsPatchSchema.parse({ isMotionReduced: true, evil: '<script>' });
		expect(parsed).toEqual({ isMotionReduced: true });
	});

	it('lower-cases an accepted colour so it matches the stored form', () => {
		const parsed = settingsPatchSchema.parse({
			tracePalette: {
				trace: ['#AABBCC', '#000000', '#000000', '#000000', '#000000', '#000000'],
				intersection: '#FFFFFF'
			}
		});
		expect(parsed.tracePalette?.trace[0]).toBe('#aabbcc');
		expect(parsed.tracePalette?.intersection).toBe('#ffffff');
	});
});
