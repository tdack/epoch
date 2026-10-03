export type TreeRole = 'owner' | 'manager' | 'editor' | 'contributor' | 'viewer';

export interface UserIdentity {
	id: string; // Internal User ID (UUID)
	accessSub: string; // Cloudflare Access Subject identifier
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
