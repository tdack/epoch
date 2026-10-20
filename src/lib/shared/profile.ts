/** What a person's profile page reads and what the header's avatar shows. */
export interface ProfileViewDto {
	email: string;
	name: string | null;
	/** Where the picture is served, with a `?v=` so a changed picture is not shown stale; null shows initials. */
	avatarUrl: string | null;
	/** Access sent a Google picture on this request and there is no avatar yet, so it can be copied in. */
	canUseAccessPicture: boolean;
}

/** A picture is a thumbnail in the header, so a small cap keeps the bucket and the page light. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export const MAX_DISPLAY_NAME_LENGTH = 100;

/** The R2 key of a user's avatar. One per person, overwritten on re-upload. */
export function avatarKeyFor(userId: string): string {
	return `avatars/${userId}`;
}

/**
 * The letters shown when there is no picture: the first letters of the name's first and second
 * words, else the first letter of the email. Empty when neither has a letter to give.
 */
export function initialsOf(
	name: string | null | undefined,
	email: string | null | undefined
): string {
	const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (words.length > 0) {
		// Spread, not index: the first character may be an astral code point.
		return words
			.slice(0, 2)
			.map((word) => [...word][0])
			.join('')
			.toUpperCase();
	}
	return ([...(email ?? '').trim()][0] ?? '').toUpperCase();
}

/** What stops a person leaving Epoch yet; both empty means they can. */
export interface LeaveBlockersDto {
	/** The install owner runs the deployment and cannot leave until that moves. */
	isInstallOwner: boolean;
	/** Trees where this person is the only owner. */
	soleOwnerTrees: { id: string; name: string }[];
}

/** Whether the typed address is the person's own: trimmed and case-insensitive, as the server checks it. */
export function isSameEmail(typed: string, email: string): boolean {
	return typed.trim().toLowerCase() === email.trim().toLowerCase();
}
