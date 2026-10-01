import type { DbClient } from '../db';
import { users, treeMemberships } from '../db/schema';
import type { UserIdentity, TreeRole, TreeMembership } from '../domain/identity';
import { eq, and } from 'drizzle-orm';
import { NotFoundError } from '../domain/errors';

export class UserRepository {
  constructor(private db: DbClient) {}

  /**
   * Upsert a user based on stable Cloudflare Access sub.
   * Treats email and name as mutable profile attributes.
   */
  async upsertFromAccess(identity: { accessSub: string; email: string; name?: string | null }): Promise<UserIdentity> {
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.accessSub, identity.accessSub))
      .get();

    if (existing) {
      if (existing.email !== identity.email || existing.name !== identity.name) {
        await this.db
          .update(users)
          .set({
            email: identity.email,
            name: identity.name || existing.name,
            updatedAt: new Date()
          })
          .where(eq(users.id, existing.id));
      }
      return {
        id: existing.id,
        accessSub: existing.accessSub,
        email: identity.email,
        name: identity.name || existing.name
      };
    }

    const newUserId = crypto.randomUUID();
    const newUser = {
      id: newUserId,
      accessSub: identity.accessSub,
      email: identity.email,
      name: identity.name || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.db.insert(users).values(newUser);

    return {
      id: newUserId,
      accessSub: identity.accessSub,
      email: identity.email,
      name: identity.name || null
    };
  }

  async findById(userId: string): Promise<UserIdentity | null> {
    const user = await this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return null;
    return {
      id: user.id,
      accessSub: user.accessSub,
      email: user.email,
      name: user.name
    };
  }

  async getMembership(treeId: string, userId: string): Promise<TreeMembership | null> {
    const member = await this.db
      .select()
      .from(treeMemberships)
      .where(and(eq(treeMemberships.treeId, treeId), eq(treeMemberships.userId, userId)))
      .get();

    // Not a member means no access. This used to make the first caller the owner of any tree with
    // no members, so once a second person could sign in they would have taken every ownerless tree;
    // ownership is now assigned by `tree-repository.create` or by hand (ADR-015, Phase 4 migration).
    if (!member) return null;

    return {
      id: member.id,
      treeId: member.treeId,
      userId: member.userId,
      role: member.role as TreeRole,
      createdAt: member.createdAt || new Date(),
      updatedAt: member.updatedAt || new Date()
    };
  }

  async addMembership(treeId: string, userId: string, role: TreeRole): Promise<TreeMembership> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.db.insert(treeMemberships).values({
      id,
      treeId,
      userId,
      role,
      createdAt: now,
      updatedAt: now
    });

    return {
      id,
      treeId,
      userId,
      role,
      createdAt: now,
      updatedAt: now
    };
  }
}
