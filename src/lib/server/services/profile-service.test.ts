import type { R2Bucket } from '@cloudflare/workers-types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { PUBLIC_VISITOR, type AuthenticatedContext } from '../domain/identity';
import { FakeMediaBucket } from '../testing/fake-bucket';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { MAX_AVATAR_BYTES } from '../../shared/profile';
import { ProfileService } from './profile-service';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GOOD_URL = 'https://lh3.googleusercontent.com/a/photo';

let t: TestDatabase;
let service: ProfileService;
let fake: FakeMediaBucket;
let bucket: R2Bucket;
let me: TestActor;
let coMember: TestActor;
let stranger: TestActor;

beforeAll(async () => {
	t = await createTestDatabase();
	service = new ProfileService(t.db);
	me = await createTestUser(t.db, 'me');
	coMember = await createTestUser(t.db, 'co');
	stranger = await createTestUser(t.db, 'stranger');
	const treeId = await createTestTree(t.db, me);
	await addTestMember(t.db, treeId, coMember, 'viewer');
	await createTestTree(t.db, stranger);
}, 60_000);
afterAll(async () => {
	await t.dispose();
});
beforeEach(async () => {
	fake = new FakeMediaBucket();
	bucket = fake as unknown as R2Bucket;
	await service.removeAvatar(bucket, me.context);
});

const visitor: AuthenticatedContext = { user: PUBLIC_VISITOR, correlationId: 'v' };
const withPicture = (actor: TestActor): AuthenticatedContext => ({
	...actor.context,
	user: { ...actor.context.user, pictureUrl: GOOD_URL }
});
const pngResponse = (async () => new Response(PNG)) as unknown as typeof fetch;

describe('ProfileService name', () => {
	it('trims the name and rejects an empty one', async () => {
		expect((await service.saveName('  Ada L  ', me.context)).name).toBe('Ada L');
		await expect(service.saveName('   ', me.context)).rejects.toThrow('Name is required');
		const row = await t.db.select().from(users).where(eq(users.id, me.userId)).get();
		expect(row?.name).toBe('Ada L');
	});

	it('is not for the public visitor', async () => {
		await expect(service.saveName('X', visitor)).rejects.toThrow('Forbidden');
	});
});

describe('ProfileService avatar upload', () => {
	it('stores an image under the user key and reports its URL', async () => {
		const view = await service.saveAvatar(PNG, bucket, me.context);
		expect(view.avatarUrl).toMatch(new RegExp(`^/api/profile/avatar/${me.userId}\\?v=\\d+$`));
		expect(fake.objects.get(`avatars/${me.userId}`)?.contentType).toBe('image/png');
	});

	it('refuses a file over the cap and bytes that are not an inline image', async () => {
		const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
		big.set(PNG);
		await expect(service.saveAvatar(big, bucket, me.context)).rejects.toThrow('at most');
		for (const bytes of [
			new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
			new TextEncoder().encode('%PDF-1.7'),
			new TextEncoder().encode('<html></html>')
		]) {
			await expect(service.saveAvatar(bytes, bucket, me.context)).rejects.toThrow('must be a');
		}
		expect(fake.objects.size).toBe(0);
	});

	it('deletes the object and clears the key', async () => {
		await service.saveAvatar(PNG, bucket, me.context);
		const view = await service.removeAvatar(bucket, me.context);
		expect(view.avatarUrl).toBeNull();
		expect(fake.objects.size).toBe(0);
	});

	it('is refused for the public visitor', async () => {
		await expect(service.saveAvatar(PNG, bucket, visitor)).rejects.toThrow('Forbidden');
	});
});

describe('ProfileService avatar read', () => {
	beforeEach(async () => {
		await service.saveAvatar(PNG, bucket, me.context);
	});

	it('serves the user themself and a member of a shared tree', async () => {
		expect((await service.readAvatar(me.userId, bucket, me.context)).key).toBe(
			`avatars/${me.userId}`
		);
		expect((await service.readAvatar(me.userId, bucket, coMember.context)).key).toBe(
			`avatars/${me.userId}`
		);
	});

	it('refuses a stranger and the public visitor', async () => {
		await expect(service.readAvatar(me.userId, bucket, stranger.context)).rejects.toThrow(
			'Forbidden'
		);
		await expect(service.readAvatar(me.userId, bucket, visitor)).rejects.toThrow('Forbidden');
	});

	it('is a 404 for a co-member whose person has no avatar', async () => {
		await expect(service.readAvatar(coMember.userId, bucket, me.context)).rejects.toThrow(
			'Avatar not found'
		);
	});
});

describe('ProfileService Access picture', () => {
	it('offers the button only while there is a picture URL and no avatar', async () => {
		expect((await service.view(me.context)).canUseAccessPicture).toBe(false);
		expect((await service.view(withPicture(me))).canUseAccessPicture).toBe(true);
		await service.saveAvatar(PNG, bucket, me.context);
		expect((await service.view(withPicture(me))).canUseAccessPicture).toBe(false);
	});

	it('copies the picture in on request, and says so when it cannot', async () => {
		const view = await service.useAccessPicture(bucket, withPicture(me), pngResponse);
		expect(view.avatarUrl).not.toBeNull();
		expect(fake.objects.has(`avatars/${me.userId}`)).toBe(true);
		await expect(service.useAccessPicture(bucket, me.context, pngResponse)).rejects.toThrow(
			'did not include'
		);
		const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		await expect(service.useAccessPicture(bucket, withPicture(me), bad)).rejects.toThrow(
			'could not be used'
		);
	});

	it('imports for a new user in the background and swallows any failure', async () => {
		const user = { ...me.context.user, pictureUrl: GOOD_URL };
		await service.importForNewUser(user, bucket, pngResponse);
		expect(fake.objects.has(`avatars/${me.userId}`)).toBe(true);
		fake.objects.clear();
		const throws = (async () => {
			throw new Error('boom');
		}) as unknown as typeof fetch;
		await expect(service.importForNewUser(user, bucket, throws)).resolves.toBeUndefined();
		expect(fake.objects.size).toBe(0);
	});
});
