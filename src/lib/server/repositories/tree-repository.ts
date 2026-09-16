import type { DbClient } from '../db';
import { trees, treeMemberships, individuals, families, familyChildren, events } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { ConcurrencyConflictError, NotFoundError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';

export interface TreeSummary {
  id: string;
  name: string;
  description: string | null;
  version: number;
  role?: TreeRole;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export class TreeRepository {
  constructor(private db: DbClient) {}

  async listForUser(userId: string): Promise<TreeSummary[]> {
    // 1. Backfill memberships for any existing unassigned trees (e.g. legacy D1 data)
    // Find trees that have no memberships at all and assign them to this user as owner.
    const allTrees = await this.db.select().from(trees).all();
    const existingMemberships = await this.db.select().from(treeMemberships).all();
    const treesWithMembers = new Set(existingMemberships.map((m) => m.treeId));

    for (const tree of allTrees) {
      if (!treesWithMembers.has(tree.id)) {
        await this.db.insert(treeMemberships).values({
          id: crypto.randomUUID(),
          treeId: tree.id,
          userId,
          role: 'owner',
          createdAt: new Date(),
          updatedAt: new Date()
        }).onConflictDoNothing();
      }
    }

    const records = await this.db
      .select({
        id: trees.id,
        name: trees.name,
        description: trees.description,
        version: trees.version,
        role: treeMemberships.role,
        createdAt: trees.createdAt,
        updatedAt: trees.updatedAt
      })
      .from(treeMemberships)
      .innerJoin(trees, eq(treeMemberships.treeId, trees.id))
      .where(eq(treeMemberships.userId, userId))
      .orderBy(desc(trees.updatedAt))
      .all();

    return records.map((r) => ({
      ...r,
      role: r.role as TreeRole
    }));
  }

  async findById(treeId: string): Promise<TreeSummary | null> {
    const record = await this.db.select().from(trees).where(eq(trees.id, treeId)).get();
    if (!record) return null;
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  async create(name: string, description: string | null, ownerUserId: string): Promise<TreeSummary> {
    const treeId = crypto.randomUUID();
    const now = new Date();

    const newTree = {
      id: treeId,
      name: name.trim(),
      description: description?.trim() || null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    await this.db.insert(trees).values(newTree);

    // Automatically assign creator as owner
    await this.db.insert(treeMemberships).values({
      id: crypto.randomUUID(),
      treeId,
      userId: ownerUserId,
      role: 'owner',
      createdAt: now,
      updatedAt: now
    });

    return {
      ...newTree,
      role: 'owner'
    };
  }

  async update(treeId: string, expectedVersion: number, data: { name?: string; description?: string | null }): Promise<TreeSummary> {
    const current = await this.findById(treeId);
    if (!current) throw new NotFoundError('Tree', treeId);

    if (current.version !== expectedVersion) {
      throw new ConcurrencyConflictError(
        `Tree '${treeId}' was modified concurrently (current version: ${current.version}, expected: ${expectedVersion})`
      );
    }

    const now = new Date();
    const nextVersion = current.version + 1;

    await this.db
      .update(trees)
      .set({
        name: data.name !== undefined ? data.name.trim() : current.name,
        description: data.description !== undefined ? data.description : current.description,
        version: nextVersion,
        updatedAt: now
      })
      .where(and(eq(trees.id, treeId), eq(trees.version, expectedVersion)));

    return {
      id: treeId,
      name: data.name !== undefined ? data.name.trim() : current.name,
      description: data.description !== undefined ? data.description : current.description,
      version: nextVersion,
      createdAt: current.createdAt,
      updatedAt: now
    };
  }

  async delete(treeId: string): Promise<void> {
    await this.db.delete(trees).where(eq(trees.id, treeId));
  }
}
