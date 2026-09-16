import { error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.MEDIA_BUCKET) {
    error(500, 'R2 storage binding unavailable');
  }

  const key = params.key;
  if (!key) {
    error(400, 'Media object key required');
  }

  const object = await platform.env.MEDIA_BUCKET.get(key);
  if (!object) {
    error(404, 'Media object not found');
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers as any);
  headers.set('etag', object.httpEtag);
  // Edge asset caching for immutable media assets
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body as unknown as ReadableStream, {
    headers
  });
};
