import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { validateMediaUpload } from '#lib/server/media/media-type.js';
import { MediaService } from '#lib/server/services/media-service.js';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}
	if (!platform?.env?.MEDIA_BUCKET || !platform?.env?.DB) {
		return Response.json({ error: 'R2 or DB binding unavailable' }, { status: 500 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const treeId = formData.get('treeId') as string | null;
	const entityId = formData.get('entityId') as string | null;
	const title = formData.get('title') as string | null;

	if (!file || !treeId || !entityId) {
		return Response.json({ error: 'file, treeId, and entityId are required' }, { status: 400 });
	}

	try {
		// Before a byte is stored: the caller must be allowed to add media to this record of this tree.
		const db = getDb(platform.env.DB);
		const service = new MediaService(db);
		await service.requireUpload(treeId, entityId, {
			user: locals.user,
			correlationId: locals.correlationId
		});

		// The bytes decide the type; the declared type and filename are attacker-controlled and are
		// ignored. The extension comes from the sniffed type so it cannot disagree with the content.
		const bytes = new Uint8Array(await file.arrayBuffer());
		const { mimeType, extension } = validateMediaUpload(file.type, bytes);
		const objectKey = `media/${treeId}/${entityId}/${crypto.randomUUID()}.${extension}`;

		// Store in Cloudflare R2
		await platform.env.MEDIA_BUCKET.put(objectKey, bytes, {
			httpMetadata: {
				contentType: mimeType
			}
		});

		// Save metadata to D1
		const mediaId = crypto.randomUUID();
		await service.record(treeId, entityId, {
			id: mediaId,
			objectKey,
			title: title || file.name,
			mimeType
		});

		return Response.json(
			{
				success: true,
				media: {
					id: mediaId,
					objectKey,
					title: title || file.name,
					mimeType
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		return errorResponse(err, 'Failed to upload media');
	}
};
