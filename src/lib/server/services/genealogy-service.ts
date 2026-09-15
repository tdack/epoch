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

  async getIndividual(treeId: string, individualId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:view');
    const individual = await this.genealogyRepo.getIndividual(treeId, individualId);
    if (!individual) throw new NotFoundError('Individual', individualId);
    return individual;
  }

  async deleteIndividual(treeId: string, individualId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'record:delete');
    return this.genealogyRepo.deleteIndividual(treeId, individualId);
  }

  async createFamily(
    treeId: string,
    data: {
      husbandId?: string | null;
      wifeId?: string | null;
      partner1Id?: string | null;
      partner2Id?: string | null;
      childrenIds?: string[];
      marriageDate?: string | null;
      marriagePlace?: string | null;
    },
    context: AuthenticatedContext
  ) {
    await this.verifyTreeAccess(treeId, context, 'record:create');
    const partner1 = data.partner1Id !== undefined ? data.partner1Id : data.husbandId;
    const partner2 = data.partner2Id !== undefined ? data.partner2Id : data.wifeId;

    if (!partner1 && !partner2 && (!data.childrenIds || data.childrenIds.length === 0)) {
      throw new ValidationError('A family requires at least one spouse or child');
    }
    return this.genealogyRepo.createFamily({
      treeId,
      husbandId: partner1,
      wifeId: partner2,
      partner1Id: partner1,
      partner2Id: partner2,
      childrenIds: data.childrenIds,
      marriageDate: data.marriageDate,
      marriagePlace: data.marriagePlace
    });
  }

  async getFamily(treeId: string, familyId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:view');
    const family = await this.genealogyRepo.getFamily(treeId, familyId);
    if (!family) throw new NotFoundError('Family', familyId);
    return family;
  }

  async updateFamily(
    treeId: string,
    familyId: string,
    expectedVersion: number | undefined,
    data: {
      husbandId?: string | null;
      wifeId?: string | null;
      partner1Id?: string | null;
      partner2Id?: string | null;
      childrenIds?: string[];
      marriageDate?: string | null;
      marriagePlace?: string | null;
      divorceDate?: string | null;
      divorcePlace?: string | null;
    },
    context: AuthenticatedContext
  ) {
    await this.verifyTreeAccess(treeId, context, 'record:edit');
    const partner1 = data.partner1Id !== undefined ? data.partner1Id : data.husbandId;
    const partner2 = data.partner2Id !== undefined ? data.partner2Id : data.wifeId;

    return this.genealogyRepo.updateFamily(treeId, familyId, expectedVersion, {
      husbandId: partner1,
      wifeId: partner2,
      partner1Id: partner1,
      partner2Id: partner2,
      childrenIds: data.childrenIds,
      marriageDate: data.marriageDate,
      marriagePlace: data.marriagePlace,
      divorceDate: data.divorceDate,
      divorcePlace: data.divorcePlace
    });
  }

  async deleteFamily(treeId: string, familyId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'record:delete');
    return this.genealogyRepo.deleteFamily(treeId, familyId);
  }
}
