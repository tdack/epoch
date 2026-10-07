/**
 * What the members screen reads, as the API answers it. The service that builds it stays on the
 * server; only the shapes live here.
 */

import type { TreeRole } from './roles';

export interface MemberDto {
	userId: string;
	email: string;
	name: string | null;
	role: TreeRole;
	version: number;
	isYou: boolean;
	/** Whether the caller may change or remove them: lets the screen offer only what would succeed. */
	canManage: boolean;
}

interface InvitationDto {
	id: string;
	email: string;
	role: TreeRole;
	expiresAt: string;
	isExpired: boolean;
}

/** What inviting answers: the offer, and whether the email telling them about it was sent. */
export interface InvitationSentDto extends InvitationDto {
	/** False when there is no mailer or the send failed; the invitation exists either way. */
	wasEmailSent: boolean;
}

export interface MembersDto {
	members: MemberDto[];
	invitations: InvitationDto[];
	/** The roles the caller may give. */
	grantableRoles: TreeRole[];
}
