import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';
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

		// The extension lands in an R2 key, so it is reduced to letters and digits.
		const rawExt = file.name.split('.').pop() ?? '';
		const fileExt = /^[A-Za-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'dat';
		const objectKey = `media/${treeId}/${entityId}/${crypto.randomUUID()}.${fileExt}`;
		const arrayBuffer = await file.arrayBuffer();

		// Store in Cloudflare R2
		await platform.env.MEDIA_BUCKET.put(objectKey, arrayBuffer, {
			httpMetadata: {
				contentType: file.type || 'application/octet-stream'
			}
		});

		// Save metadata to D1
		const mediaId = crypto.randomUUID();
		await service.record(treeId, entityId, {
			id: mediaId,
			objectKey,
			title: title || file.name,
			mimeType: file.type || 'application/octet-stream'
		});

		return Response.json(
			{
				success: true,
				media: {
					id: mediaId,
					objectKey,
					title: title || file.name,
					mimeType: file.type
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		return errorResponse(err, 'Failed to upload media');
	}
};
