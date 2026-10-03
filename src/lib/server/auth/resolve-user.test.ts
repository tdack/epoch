import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { resolveUser } from './resolve-user';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('resolveUser', () => {
	it('upserts by the stable sub: the same sub is the same user, and profile changes follow', async () => {
		const first = await resolveUser(
			t.d1,
			{ accessSub: 'sub-resolve', email: 'a@epoch.test', name: 'A' },
			'unused'
		);
		const again = await resolveUser(
			t.d1,
			{ accessSub: 'sub-resolve', email: 'renamed@epoch.test', name: 'B' },
			'unused'
		);
		expect(again.id).toBe(first.id);
		expect(again).toMatchObject({
			accessSub: 'sub-resolve',
			email: 'renamed@epoch.test',
			name: 'B'
		});
		expect(first.id).not.toBe('unused');
	});

	it('gives a different sub a different user', async () => {
		const one = await resolveUser(t.d1, { accessSub: 'sub-one', email: '1@epoch.test' }, 'x');
		const two = await resolveUser(t.d1, { accessSub: 'sub-two', email: '2@epoch.test' }, 'x');
		expect(one.id).not.toBe(two.id);
	});

	it('uses the identity as it is, under the fallback id, when no database is bound', async () => {
		expect(
			await resolveUser(
				undefined,
				{ accessSub: 'sub', email: 'e@epoch.test', name: 'N' },
				'dev-user-id'
			)
		).toEqual({ id: 'dev-user-id', accessSub: 'sub', email: 'e@epoch.test', name: 'N' });
	});
});
