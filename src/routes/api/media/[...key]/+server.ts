import { error, type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { errorResponse } from '#lib/server/http/error-response.js';
import { MediaService } from '#lib/server/services/media-service.js';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!platform?.env?.MEDIA_BUCKET || !platform?.env?.DB) {
    error(500, 'R2 storage binding unavailable');
  }

  const key = params.key;
  if (!key) {
    error(400, 'Media object key required');
  }

  try {
    // The key is not a credential: the caller must be able to see the tree and the record it names.
    await new MediaService(getDb(platform.env.DB)).requireRead(key, { user: locals.user, correlationId: locals.correlationId });
  } catch (err) {
    return errorResponse(err, 'Failed to read media');
  }

  const object = await platform.env.MEDIA_BUCKET.get(key);
  if (!object) {
    error(404, 'Media object not found');
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers as any);
  headers.set('etag', object.httpEtag);
  // Private, not public: a shared cache would hand the object to someone who never passed the check above.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');

  return new Response(object.body as unknown as ReadableStream, {
    headers
  });
};
