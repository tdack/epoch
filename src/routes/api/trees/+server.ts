import { json, type RequestHandler } from '@sveltejs/kit';
import { getDb, trees, ensureDbSchema } from '$lib/server/db';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const allTrees = await db.select().from(trees).orderBy(desc(trees.updatedAt)).all();

    return json({ trees: allTrees });
  } catch (err: any) {
    console.error('Failed to fetch trees:', err);
    return json({ error: err?.message || 'Failed to fetch trees' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env?.DB) {
    return json({ error: 'Database binding unavailable' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
  const { name, description } = body;
  if (!name || typeof name !== 'string') {
    return json({ error: 'Tree name is required' }, { status: 400 });
  }

  try {
    await ensureDbSchema(platform.env.DB);
    const db = getDb(platform.env.DB);
    const newTree = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.insert(trees).values(newTree);
    return json({ tree: newTree }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create tree:', err);
    return json({ error: err?.message || 'Failed to create tree' }, { status: 500 });
  }
};
