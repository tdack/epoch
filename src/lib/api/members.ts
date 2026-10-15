import type { InvitationSentDto, MemberDto, MembersDto } from '#lib/shared/members.js';
import type { TreeRole } from '#lib/shared/roles.js';
import { call, enc, json } from './client.js';

export type { InvitationSentDto, MemberDto, MembersDto };

export async function fetchMembers(
	treeId: string,
	fetcher: typeof fetch = fetch
): Promise<MembersDto> {
	return call(
		`/api/trees/${enc(treeId)}/members`,
		{ method: 'GET' },
		'Failed to load the members',
		fetcher
	);
}

export async function inviteMemberApi(
	treeId: string,
	email: string,
	role: TreeRole
): Promise<InvitationSentDto> {
	return call(
		`/api/trees/${enc(treeId)}/invitations`,
		json('POST', { email, role }),
		'Failed to send the invitation'
	);
}

export async function withdrawInvitationApi(treeId: string, invitationId: string): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/invitations/${enc(invitationId)}`,
		{ method: 'DELETE' },
		'Failed to withdraw the invitation'
	);
}

export async function changeMemberRoleApi(
	treeId: string,
	userId: string,
	role: TreeRole,
	version: number
): Promise<MemberDto> {
	return call(
		`/api/trees/${enc(treeId)}/members/${enc(userId)}`,
		json('PATCH', { role, version }),
		'Failed to change the role'
	);
}

export async function removeMemberApi(
	treeId: string,
	userId: string,
	version: number
): Promise<void> {
	await call(
		`/api/trees/${enc(treeId)}/members/${enc(userId)}?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the member'
	);
}
