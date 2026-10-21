import { describe, expect, it } from 'vitest';
import { load } from './+page.server.js';

function eventFor(isInstallOwner: boolean) {
	return {
		locals: {
			user: { id: 'u1', email: 'a@example.test', isInstallOwner },
			correlationId: 'c1'
		},
		// Never reached: the owner check comes before any read.
		platform: { env: { DB: {} } },
		depends: () => {}
	} as unknown as Parameters<typeof load>[0];
}

describe('administration load', () => {
	it('is a 404 for anyone but the install owner', async () => {
		await expect(load(eventFor(false))).rejects.toMatchObject({ status: 404 });
	});
});
