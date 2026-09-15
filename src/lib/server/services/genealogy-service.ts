import type { DbClient } from '../db';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import { isActionAllowed } from '../auth/authorization';
import { UnauthorizedError, NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';

export class GenealogyService {
  private treeRepo: TreeRepository;
  private userRepo: UserRepository;
  private genealogyRepo: GenealogyRepository;

  constructor(private db: DbClient) {
    this.treeRepo = new TreeRepository(db);
    this.userRepo = new UserRepository(db);
    this.genealogyRepo = new GenealogyRepository(db);
  }

  private async verifyTreeAccess(treeId: string, context: AuthenticatedContext, action: Parameters<typeof isActionAllowed>[1]) {
    const membership = await this.userRepo.getMembership(treeId, context.user.id);
    if (!membership || !isActionAllowed(membership.role, action)) {
      throw new UnauthorizedError(`Forbidden: insufficient privileges for action '${action}' on tree '${treeId}'`);
    }
    return membership;
  }

  async listTrees(context: AuthenticatedContext) {
    return this.treeRepo.listForUser(context.user.id);
  }

  async getTree(treeId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:view');
    const tree = await this.treeRepo.findById(treeId);
    if (!tree) throw new NotFoundError('Tree', treeId);
    const data = await this.genealogyRepo.getTreeData(treeId);
    return {
      tree,
      ...data
    };
  }

  async createTree(name: string, description: string | null, context: AuthenticatedContext) {
    if (!name?.trim()) throw new ValidationError('Tree name is required');
    return this.treeRepo.create(name.trim(), description?.trim() || null, context.user.id);
  }

  async updateTree(treeId: string, expectedVersion: number, data: { name?: string; description?: string | null }, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:update_settings');
    return this.treeRepo.update(treeId, expectedVersion, data);
  }

  async deleteTree(treeId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:delete');
    return this.treeRepo.delete(treeId);
  }

  async createIndividual(
    treeId: string,
    data: {
      givenName?: string | null;
      surname?: string | null;
      sex?: 'M' | 'F' | 'U';
      birthDate?: string | null;
      birthPlace?: string | null;
      deathDate?: string | null;
      deathPlace?: string | null;
    },
    context: AuthenticatedContext
  ) {
    await this.verifyTreeAccess(treeId, context, 'record:create');
    if (!data.givenName?.trim() && !data.surname?.trim()) {
      throw new ValidationError('Given name or surname is required');
    }
    return this.genealogyRepo.createIndividual({ treeId, ...data });
  }

  async updateIndividual(
    treeId: string,
    individualId: string,
    expectedVersion: number,
    data: {
      givenName?: string | null;
      surname?: string | null;
      sex?: 'M' | 'F' | 'U';
      birthDate?: string | null;
      birthPlace?: string | null;
      deathDate?: string | null;
      deathPlace?: string | null;
    },
    context: AuthenticatedContext
  ) {
    await this.verifyTreeAccess(treeId, context, 'record:edit');
    return this.genealogyRepo.updateIndividual(treeId, individualId, expectedVersion, data);
  }

  async deleteIndividual(treeId: string, individualId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'record:delete');
    return this.genealogyRepo.deleteIndividual(treeId, individualId);
  }
}
