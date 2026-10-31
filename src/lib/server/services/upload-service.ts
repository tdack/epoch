/**
 * Resumable chunked uploads to R2 (ADR-074). A session opens an R2 multipart upload; the client
 * sends each part as its own request, and complete assembles them under a key the server chose.
 * Nothing here uses the finished object: a later task imports it or turns it into a media file.
 */

import type { R2Bucket, ReadableStream as WorkersReadableStream } from '@cloudflare/workers-types';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { sumStoredBytes } from '../media/stored-bytes';
import { UploadRepository, type UploadSessionRow } from '../repositories/upload-repository';
import { UserRepository } from '../repositories/user-repository';
import type { DbClient } from '../db';
import { requireTreeAction } from './tree-access';
import type { TreeAction } from '../auth/authorization';
import { MAX_TREE_MEDIA_BYTES } from '../../shared/media';
import {
	MAX_UPLOAD_BYTES_BY_PURPOSE,
	UPLOAD_PART_BYTES,
	UPLOAD_SESSION_TTL_SECONDS,
	expectedPartBytes,
	uploadPartCount,
	type UploadCompleteDto,
	type UploadPartDto,
	type UploadPurpose,
	type UploadSessionDto
} from '../../shared/uploads';

/** The existing action checks, reused so an upload cannot be allowed to someone the feature is not. */
const ACTION_BY_PURPOSE: Record<UploadPurpose, TreeAction> = {
	gedzip_import: 'tree:import',
	media: 'media:manage'
};

export interface UploadCreateInput {
	treeId: string;
	purpose: UploadPurpose;
	fileName: string;
	contentType: string;
	totalBytes: number;
}

export interface UploadServiceOptions {
	now?: () => Date;
	/** Tests use a small part so a whole upload fits in memory; production uses `UPLOAD_PART_BYTES`. */
	partSizeBytes?: number;
}

/** Where the client sends a part. Chosen here, so it can become a signed R2 URL without a client change. */
function partUrl(sessionId: string, partNumber: number): string {
	return `/api/uploads/${sessionId}/parts/${partNumber}`;
}

export class UploadService {
	private readonly uploads: UploadRepository;
	private readonly users: UserRepository;
	private readonly now: () => Date;
	private readonly partSizeBytes: number;

	constructor(
		db: DbClient,
		private readonly bucket: R2Bucket,
		options: UploadServiceOptions = {}
	) {
		this.uploads = new UploadRepository(db);
		this.users = new UserRepository(db);
		this.now = options.now ?? (() => new Date());
		this.partSizeBytes = options.partSizeBytes ?? UPLOAD_PART_BYTES;
	}

	/**
	 * The role check alone, so a route can refuse before it spends a rate-limit token on a caller
	 * who may not upload at all.
	 */
	async requireRole(
		treeId: string,
		purpose: UploadPurpose,
		context: AuthenticatedContext
	): Promise<void> {
		await requireTreeAction(this.users, treeId, context, ACTION_BY_PURPOSE[purpose]);
	}

	async create(input: UploadCreateInput, context: AuthenticatedContext): Promise<UploadSessionDto> {
		await this.requireRole(input.treeId, input.purpose, context);
		this.assertSize(input);
		const now = this.now();
		if (input.purpose === 'media') await this.requireMediaRoom(input, now);

		const sessionId = crypto.randomUUID();
		// Never derived from the file name: that is the client's, and it would put it in a path.
		const r2Key = `staging/uploads/${input.treeId}/${sessionId}`;
		const upload = await this.bucket.createMultipartUpload(r2Key);
		const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_SECONDS * 1000);
		try {
			await this.uploads.insert({
				id: sessionId,
				treeId: input.treeId,
				purpose: input.purpose,
				r2Key,
				r2UploadId: upload.uploadId,
				partSizeBytes: this.partSizeBytes,
				totalBytes: input.totalBytes,
				createdBy: context.user.id,
				createdAt: now,
				expiresAt
			});
			// The check above and the insert are not atomic, so parallel creates could each pass.
			// Counting again after the insert means at least the last of them sees the others.
			if (input.purpose === 'media') await this.requireMediaRoom(input, now, true);
		} catch (err) {
			await this.discard(sessionId, r2Key, upload.uploadId);
			throw err;
		}

		const partCount = uploadPartCount(input.totalBytes, this.partSizeBytes);
		return {
			sessionId,
			partSizeBytes: this.partSizeBytes,
			partCount,
			parts: Array.from({ length: partCount }, (_, i) => ({
				partNumber: i + 1,
				url: partUrl(sessionId, i + 1),
				method: 'PUT' as const
			})),
			expiresAt: expiresAt.getTime()
		};
	}

	/**
	 * Streams one part into R2. `body` must already be sized to `contentLength` (see
	 * `fixedLengthBody`); it is never read into memory here. Sending a part again replaces it,
	 * which is how a client retries.
	 */
	async putPart(
		sessionId: string,
		partNumber: number,
		contentLength: number | null,
		body: ReadableStream | null,
		context: AuthenticatedContext
	): Promise<UploadPartDto> {
		const session = await this.requireOpenSession(sessionId, context);
		const count = uploadPartCount(session.totalBytes, session.partSizeBytes);
		if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count)
			throw new ValidationError('That part number is not part of this upload');
		if (contentLength === null) throw new ValidationError('Content-Length is required');
		const expectedBytes = expectedPartBytes(partNumber, session.totalBytes, session.partSizeBytes);
		if (contentLength !== expectedBytes)
			throw new ValidationError(`This part must be exactly ${expectedBytes} bytes`);
		if (!body) throw new ValidationError('The part has no body');

		const part = await this.bucket
			.resumeMultipartUpload(session.r2Key, session.r2UploadId)
			// The DOM and Workers stream types differ only in declarations; it is one runtime object.
			.uploadPart(partNumber, body as unknown as WorkersReadableStream);
		await this.uploads.recordPart(session.id, partNumber, part.etag);
		return { partNumber, etag: part.etag };
	}

	async complete(sessionId: string, context: AuthenticatedContext): Promise<UploadCompleteDto> {
		const session = await this.requireOpenSession(sessionId, context);
		const count = uploadPartCount(session.totalBytes, session.partSizeBytes);
		const parts: Array<{ partNumber: number; etag: string }> = [];
		const missing: number[] = [];
		for (let n = 1; n <= count; n++) {
			const etag = session.parts[String(n)];
			if (etag === undefined) missing.push(n);
			else parts.push({ partNumber: n, etag });
		}
		if (missing.length > 0)
			throw new ValidationError('Some parts have not been uploaded', { missingParts: missing });

		try {
			await this.bucket.resumeMultipartUpload(session.r2Key, session.r2UploadId).complete(parts);
		} catch {
			await this.discard(session.id, session.r2Key, session.r2UploadId);
			throw new ValidationError('The upload could not be assembled; start it again');
		}
		const head = await this.bucket.head(session.r2Key);
		if (!head || head.size !== session.totalBytes) {
			// Already assembled, so it can no longer be aborted; the object itself goes.
			await this.bucket.delete(session.r2Key).catch(() => undefined);
			await this.uploads.closeOpen(session.id, 'aborted');
			throw new ValidationError('The uploaded file is not the size that was declared');
		}
		await this.uploads.closeOpen(session.id, 'complete');
		return { sessionId: session.id, r2Key: session.r2Key, totalBytes: session.totalBytes };
	}

	/** Idempotent: a closed session (aborted, or already complete) is left as it is. */
	async abort(sessionId: string, context: AuthenticatedContext): Promise<void> {
		const session = await this.requireOwnSession(sessionId, context);
		if (session.status !== 'open') return;
		await this.discard(session.id, session.r2Key, session.r2UploadId);
	}

	private assertSize(input: UploadCreateInput): void {
		if (input.totalBytes > MAX_UPLOAD_BYTES_BY_PURPOSE[input.purpose])
			throw new PayloadTooLargeError('This file is larger than uploads of this kind allow');
		// R2 allows 10,000 parts; the largest cap at 50 MiB a part is far below that, but a test
		// with a tiny part size is not, and refusing is cheaper than finding out at complete.
		if (uploadPartCount(input.totalBytes, this.partSizeBytes) > 10_000)
			throw new PayloadTooLargeError('This file is larger than uploads of this kind allow');
	}

	/**
	 * Throws when the tree has no room for the file on top of what is stored and what other open
	 * sessions have already reserved. `isAfterInsert` counts the new session's own bytes once, as
	 * part of the reserved total, instead of adding them again.
	 */
	private async requireMediaRoom(
		input: UploadCreateInput,
		now: Date,
		isAfterInsert = false
	): Promise<void> {
		const stored = await sumStoredBytes(this.bucket, `media/${input.treeId}/`);
		const reserved = await this.uploads.reservedBytes(input.treeId, 'media', now);
		const total = stored + reserved + (isAfterInsert ? 0 : input.totalBytes);
		if (total > MAX_TREE_MEDIA_BYTES)
			throw new PayloadTooLargeError(
				'This tree has no room for this file: its media storage is full'
			);
	}

	/** The caller's own session, or a 404 that is the same whether it is someone else's or absent. */
	private async requireOwnSession(
		sessionId: string,
		context: AuthenticatedContext
	): Promise<UploadSessionRow> {
		const session = await this.uploads.find(sessionId);
		if (!session || session.createdBy !== context.user.id) throw new NotFoundError('Upload');
		// Still holding the role: a demoted editor must not finish what they started.
		await this.requireRole(session.treeId, session.purpose, context);
		return session;
	}

	private async requireOpenSession(
		sessionId: string,
		context: AuthenticatedContext
	): Promise<UploadSessionRow> {
		const session = await this.requireOwnSession(sessionId, context);
		if (session.status !== 'open') throw new ValidationError('This upload is closed');
		if (session.expiresAt.getTime() <= this.now().getTime())
			throw new ValidationError('This upload has expired; start it again');
		return session;
	}

	/** Closes the session and drops its parts. R2 failing to abort leaves parts the 7-day rule removes. */
	private async discard(sessionId: string, r2Key: string, r2UploadId: string): Promise<void> {
		await this.uploads.closeOpen(sessionId, 'aborted');
		await this.bucket
			.resumeMultipartUpload(r2Key, r2UploadId)
			.abort()
			.catch(() => undefined);
	}
}
