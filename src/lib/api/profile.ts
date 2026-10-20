import type { ProfileViewDto } from '#lib/shared/profile.js';
import { call, json } from './client.js';

export function saveMyName(name: string): Promise<ProfileViewDto> {
	return call('/api/profile', json('PUT', { name }), 'Failed to save your name');
}

export function uploadMyAvatar(file: File): Promise<ProfileViewDto> {
	const body = new FormData();
	body.set('file', file);
	return call('/api/profile/avatar', { method: 'POST', body }, 'Failed to upload your picture');
}

export function removeMyAvatar(): Promise<ProfileViewDto> {
	return call('/api/profile/avatar', { method: 'DELETE' }, 'Failed to remove your picture');
}

/** Copies the Google picture Access sent with this sign-in; the server reads it from the token, not from here. */
export function useMyAccessPicture(): Promise<ProfileViewDto> {
	return call(
		'/api/profile/access-picture',
		{ method: 'POST' },
		'Failed to use your Google picture'
	);
}

/** Leaves Epoch for good; the server re-checks the address and the blockers. */
export function leaveEpoch(confirmEmail: string): Promise<{ didLeave: true }> {
	return call('/api/profile/leave', json('POST', { confirmEmail }), 'Failed to leave Epoch');
}
