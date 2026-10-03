import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import type { UserIdentity } from '../domain/identity';
import { UserRepository } from '../repositories/user-repository';

/**
 * Turns who Access says someone is into Epoch's user, upserting by the stable `sub` and taking up
 * any invitation for their address. Both ways in come through here, a validated Access token and
 * the local dev bypass, so they cannot differ in what a signed-in user is.
 *
 * With no database bound (a unit test, a bare preview) there is nothing to upsert into, and the
 * identity is used as it is under `fallbackId`.
 */
export async function resolveUser(
	d1: D1Database | undefined,
	identity: { accessSub: string; email: string; name?: string | null },
	fallbackId: string
): Promise<UserIdentity> {
	if (d1) return new UserRepository(getDb(d1)).upsertFromAccess(identity);
	return {
		id: fallbackId,
		accessSub: identity.accessSub,
		email: identity.email,
		name: identity.name
	};
}
