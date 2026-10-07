import type { TreeRole } from '../../shared/roles';

export interface InvitationEmail {
	to: string;
	inviterName: string;
	treeId: string;
	treeName: string;
	role: TreeRole;
	expiresAt: Date;
}

/**
 * Tells an invited address about the offer. Throws when the message was not accepted for delivery;
 * the caller decides that this never undoes the invitation (ADR-031).
 */
export interface InvitationMailer {
	sendInvitation(invitation: InvitationEmail): Promise<void>;
}
