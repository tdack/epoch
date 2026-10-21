import { apiHandler } from '#lib/server/http/handler.js';
import { enforceRateLimit } from '#lib/server/http/rate-limit.js';
import { parseBoundedFormData } from '#lib/server/http/bounded-form.js';
import { assertUploadWithinSizeLimit, validateMediaUpload } from '#lib/server/media/media-type.js';
import { MediaService } from '#lib/server/services/media-service.js';
import { BindingUnavailableError, ValidationError } from '#lib/server/domain/errors.js';
import { MAX_MEDIA_UPLOAD_BYTES } from '#lib/shared/media.js';

export const POST = apiHandler(
	{ failure: 'Failed to upload media', status: 201 },
	async ({ db, ctx, event }) => {
		const bucket = event.platform?.env?.MEDIA_BUCKET;
		if (!bucket) throw new BindingUnavailableError('MEDIA_BUCKET');

		// Before the body is read, so a refused upload costs nothing to parse.
		await enforceRateLimit({
			binding: event.platform?.env?.UPLOAD_RATE_LIMIT,
			bindingName: 'UPLOAD_RATE_LIMIT',
			key: ctx.user.id,
			message: 'Too many uploads; try again in a minute'
		});
		const formData = await parseBoundedFormData(event.request, MAX_MEDIA_UPLOAD_BYTES);
		const file = formData.get('file');
		const treeId = formData.get('treeId');
		const entityId = formData.get('entityId');
		const title = formData.get('title');

		// A text field named `file` is not a file; without this its `file.size` is `undefined` and
		// slips past the size cap below.
		const isMissingFields =
			!(file instanceof File) ||
			typeof treeId !== 'string' ||
			treeId === '' ||
			typeof entityId !== 'string' ||
			entityId === '';
		if (isMissingFields) {
			throw new ValidationError('file, treeId, and entityId are required');
		}

		assertUploadWithinSizeLimit(file.size);

		// Before a byte is stored: the caller must be allowed to add media to this record of this tree.
		const service = new MediaService(db);
		await service.requireUpload(treeId, entityId, ctx);
		// Still before any byte is written: a full tree refuses the file rather than storing it.
		await service.requireQuotaFor(treeId, file.size, bucket);

		// The bytes decide the type; the declared type and filename are attacker-controlled and are
		// ignored. The extension comes from the sniffed type so it cannot disagree with the content.
		const bytes = new Uint8Array(await file.arrayBuffer());
		const { mimeType, extension } = validateMediaUpload(file.type, bytes);
		// The key names the file, not its owner: ownership is the row's entity_id, so a file can be
		// moved or detached without touching R2.
		const mediaId = crypto.randomUUID();
		const objectKey = `media/${treeId}/${mediaId}.${extension}`;

		await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } });

		const mediaTitle = typeof title === 'string' && title !== '' ? title : file.name;
		try {
			await service.record(treeId, entityId, {
				id: mediaId,
				objectKey,
				title: mediaTitle,
				mimeType,
				sizeBytes: file.size,
				uploadedBy: ctx.user.id
			});
		} catch (err) {
			// The object would otherwise be unreachable and still counted against the quota. A failed
			// cleanup leaves that one object behind, which is no worse than before this was added.
			await bucket.delete(objectKey).catch(() => undefined);
			throw err;
		}

		return { media: { id: mediaId, objectKey, title: mediaTitle, mimeType } };
	}
);
