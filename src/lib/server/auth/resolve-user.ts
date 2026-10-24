import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import type { AccessIdentity, UserIdentity } from '../domain/identity';
import { InstallRepository } from '../repositories/install-repository';
import { UserRepository } from '../repositories/user-repository';
import type { InvitationMailer } from '../services/invitation-mailer';
import { MemberService } from '../services/member-service';

/** What a request carries once Access has named someone: an admitted user, or a stranger. */
export type Admission =
	{ user: UserIdentity; notAdmitted: null } | { user: null; notAdmitted: AccessIdentity };

export interface ResolveOptions {
	/** The user's id when no database is bound. */
	fallbackId: string;
	/**
	 * Who owns the install while `install_meta` has no row: the dev bypass identity on a local host,
	 * so a fresh local database can be used without running setup; null everywhere else, so an
	 * install that has not been set up admits only members and invitees (ADR-034).
	 */
	fallbackOwnerEmail: string | null;
	now?: Date;
	/** Where inviters are told their invitation was taken up; absent where nothing can send. */
	mailer?: InvitationMailer;
	/** Runs the notice after the response (`ExecutionContext.waitUntil`); without it the notice is awaited. */
	runInBackground?: (work: Promise<unknown>) => void;
	correlationId?: string;
}

/**
 * Turns who Access says someone is into Epoch's user, or into a stranger it turns away. Both ways in
 * come through here, a validated Access token and the local dev bypass, so they cannot differ in
 * who is admitted.
 *
 * With no database bound (a unit test, a bare preview) there is nothing to check against, and the
 * identity is used as it is under `fallbackId`.
 */
export async function resolveUser(
	d1: D1Database | undefined,
	identity: AccessIdentity,
	options: ResolveOptions
): Promise<Admission> {
	if (!d1) {
		return {
			user: {
				id: options.fallbackId,
				accessSub: identity.accessSub,
				email: identity.email,
				name: identity.name
			},
			notAdmitted: null
		};
	}
	const db = getDb(d1);
	const ownerEmail =
		(await new InstallRepository(db).findOwnerEmail()) ??
		options.fallbackOwnerEmail?.trim().toLowerCase() ??
		null;
	const admitted = await new UserRepository(db).admitFromAccess(
		identity,
		ownerEmail,
		options.now ?? new Date()
	);
	if (admitted) {
		const { joined, ...user } = admitted;
		if (joined.length > 0) {
			const notifying = new MemberService(db, undefined, options.mailer).notifyInvitersOfJoin(
				user,
				joined,
				options.correlationId
			);
			if (options.runInBackground) options.runInBackground(notifying);
			else await notifying;
		}
		return { user, notAdmitted: null };
	}
	return {
		user: null,
		notAdmitted: { accessSub: identity.accessSub, email: identity.email, name: identity.name }
	};
}
