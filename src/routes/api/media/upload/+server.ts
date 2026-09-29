import type { RequestHandler } from '@sveltejs/kit';
import { getDb, mediaItems } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';

export const POST: RequestHandler = async ({ request, platform }) => {
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
    const fileExt = file.name.split('.').pop() || 'dat';
    const objectKey = `media/${treeId}/${entityId}/${crypto.randomUUID()}.${fileExt}`;
    const arrayBuffer = await file.arrayBuffer();

    // Store in Cloudflare R2
    await platform.env.MEDIA_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      }
    });

    // Save metadata to D1
    const db = getDb(platform.env.DB);
    const mediaId = crypto.randomUUID();

    await db.insert(mediaItems).values({
      id: mediaId,
      treeId,
      entityId,
      r2ObjectKey: objectKey,
      title: title || file.name,
      mimeType: file.type || 'application/octet-stream',
      createdAt: new Date()
    });

    return Response.json({
      success: true,
      media: {
        id: mediaId,
        objectKey,
        title: title || file.name,
        mimeType: file.type
      }
    }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Failed to upload media');
  }
};
