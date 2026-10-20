import type { R2Bucket, R2ObjectBody } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import {
	NotFoundError,
	PayloadTooLargeError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { AuthenticatedContext, UserIdentity } from '../domain/identity';
import { fetchAccessPicture } from '../media/access-picture';
import { sniffMediaType } from '../media/media-type';
import { UserRepository } from '../repositories/user-repository';
import { isInlineMediaType } from '../../shared/media';
import { avatarKeyFor, MAX_AVATAR_BYTES, type ProfileViewDto } from '../../shared/profile';
import { requireRealUser } from './tree-access';

/**
 * A person's own profile: display name and avatar. This is the person's data, not tree data, so it
 * is written directly and kept out of the mutation runner and the change log, as settings are.
 */
export class ProfileService {
	private readonly users: UserRepository;

	constructor(
		db: DbClient,
		private readonly now: () => Date = () => new Date()
	) {
		this.users = new UserRepository(db);
	}

	/** What the profile page and the header's avatar show for the caller. */
	async view(context: AuthenticatedContext): Promise<ProfileViewDto> {
		requireRealUser(context);
		const row = await this.users.findProfile(context.user.id);
		if (!row) throw new NotFoundError('Profile');
		return {
			email: row.email,
			name: row.name,
			avatarUrl: row.avatarKey
				? `/api/profile/avatar/${encodeURIComponent(context.user.id)}?v=${row.updatedAt.getTime()}`
				: null,
			canUseAccessPicture: Boolean(context.user.pictureUrl) && !row.avatarKey
		};
	}

	/** The name is trimmed and must not be empty; it is a display label, never an identity (Access owns the email). */
	async saveName(name: string, context: AuthenticatedContext): Promise<ProfileViewDto> {
		requireRealUser(context);
		const trimmed = name.trim();
		if (!trimmed) throw new ValidationError('Name is required');
		await this.users.updateName(context.user.id, trimmed, this.now());
		return this.view(context);
	}

	/**
	 * Stores the bytes as the caller's avatar, replacing any earlier one. The bytes decide the type,
	 * and only types a browser renders inline are accepted.
	 */
	async saveAvatar(
		bytes: Uint8Array,
		bucket: R2Bucket,
		context: AuthenticatedContext
	): Promise<ProfileViewDto> {
		requireRealUser(context);
		if (bytes.byteLength > MAX_AVATAR_BYTES) {
			throw new PayloadTooLargeError(`A picture may be at most ${MAX_AVATAR_BYTES} bytes`);
		}
		const mimeType = sniffMediaType(bytes);
		if (!isInlineMediaType(mimeType)) {
			throw new ValidationError('The picture must be a JPEG, PNG, GIF, WebP or AVIF image');
		}
		await this.store(context.user.id, bytes, mimeType, bucket);
		return this.view(context);
	}

	async removeAvatar(bucket: R2Bucket, context: AuthenticatedContext): Promise<ProfileViewDto> {
		requireRealUser(context);
		await bucket.delete(avatarKeyFor(context.user.id));
		await this.users.setAvatarKey(context.user.id, null, this.now());
		return this.view(context);
	}

	/**
	 * Copies the Google picture Access sent on this request in as the avatar; the person asked for
	 * it, so a refusal says so rather than falling back silently.
	 */
	async useAccessPicture(
		bucket: R2Bucket,
		context: AuthenticatedContext,
		fetchFn: typeof fetch = fetch
	): Promise<ProfileViewDto> {
		requireRealUser(context);
		const { pictureUrl } = context.user;
		if (!pictureUrl) throw new ValidationError('Your sign-in did not include a picture');
		const picture = await fetchAccessPicture(pictureUrl, fetchFn);
		if (!picture) throw new ValidationError('Your Google picture could not be used');
		await this.store(context.user.id, picture.bytes, picture.mimeType, bucket);
		return this.view(context);
	}

	/**
	 * The first-login copy. Runs in the background after the response is sent, so it never throws:
	 * a failure leaves the person on initials, and "Use my Google picture" is still there.
	 */
	async importForNewUser(
		user: UserIdentity,
		bucket: R2Bucket,
		fetchFn: typeof fetch = fetch
	): Promise<void> {
		if (!user.pictureUrl) return;
		try {
			const picture = await fetchAccessPicture(user.pictureUrl, fetchFn);
			if (picture) await this.store(user.id, picture.bytes, picture.mimeType, bucket);
		} catch (error) {
			console.warn('Could not import the Access picture', error);
		}
	}

	/**
	 * The avatar of `userId` for the caller: their own, or that of someone who shares a tree with
	 * them. Anyone else, and the public visitor, is refused: a picture is a face, not tree data.
	 */
	async readAvatar(
		userId: string,
		bucket: R2Bucket,
		context: AuthenticatedContext
	): Promise<R2ObjectBody> {
		requireRealUser(context);
		const isAllowed =
			context.user.id === userId || (await this.users.sharesTree(context.user.id, userId));
		if (!isAllowed) throw new UnauthorizedError('Forbidden');
		const row = await this.users.findProfile(userId);
		const object = row?.avatarKey ? await bucket.get(row.avatarKey) : null;
		if (!object) throw new NotFoundError('Avatar');
		return object;
	}

	private async store(
		userId: string,
		bytes: Uint8Array,
		mimeType: string,
		bucket: R2Bucket
	): Promise<void> {
		const key = avatarKeyFor(userId);
		await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
		await this.users.setAvatarKey(userId, key, this.now());
	}
}
