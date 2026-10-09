import type { TreeRole } from '../../shared/roles';

export interface UserIdentity {
	id: string; // Internal User ID (UUID)
	accessSub: string; // Cloudflare Access Subject identifier
	email: string;
	name?: string | null;
	/**
	 * Decided once, when the request is admitted (ADR-034), so a service need not know about the dev
	 * bypass. Absent means not the owner: a context built anywhere else fails closed.
	 */
	isInstallOwner?: boolean;
}

/** Who Access says someone is, before Epoch has decided whether to admit them. */
export interface AccessIdentity {
	accessSub: string;
	email: string;
	name?: string | null;
}

export interface TreeMembership {
	id: string;
	treeId: string;
	userId: string;
	role: TreeRole;
	createdAt: Date;
	updatedAt: Date;
}

export interface AuthenticatedContext {
	user: UserIdentity;
	correlationId: string;
}
