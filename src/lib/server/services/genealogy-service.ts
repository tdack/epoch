import type { DbClient } from '../db';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import { isActionAllowed } from '../auth/authorization';
import { requireTreeAction } from './tree-access';
import { UnauthorizedError, NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { describeCommand } from '../domain/command-summary';
import type { ImpactSummary } from '../domain/impact';
import { MutationRunner, type MutationClock } from './mutation-runner';
import type { Sex } from '../../shared/sex';

export class GenealogyService {
  private treeRepo: TreeRepository;
  private userRepo: UserRepository;
  private genealogyRepo: GenealogyRepository;
  private runner: MutationRunner;

  constructor(private db: DbClient, clock?: MutationClock) {
    this.runner = new MutationRunner(db, clock);
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
    // Every record of the tree, private people included, so only roles that see everyone (ADR-015).
    await this.verifyTreeAccess(treeId, context, 'record:edit');
    const tree = await this.treeRepo.findById(treeId);
    if (!tree) throw new NotFoundError('Tree', treeId);
    const data = await this.genealogyRepo.getTreeData(treeId);
    return {
      tree,
      ...data
    };
  }

  /**
   * Throws unless the caller may export this tree. The export carries every person, living ones
   * included, so it is a manager's action until exports can be filtered per viewer (ADR-015).
   */
  async requireExport(treeId: string, context: AuthenticatedContext): Promise<void> {
    await this.verifyTreeAccess(treeId, context, 'tree:export');
  }

  /** Throws unless the caller may import into this tree. Reads only the caller's membership, never the tree. */
  async requireImport(treeId: string, context: AuthenticatedContext): Promise<void> {
    await requireTreeAction(this.userRepo, treeId, context, 'tree:import');
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
      sex?: Sex;
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
    const personId = this.runner.clock.newId();
    const command = { kind: 'create_person' as const, personId, givenName: data.givenName ?? null, surname: data.surname ?? null, sex: data.sex ?? 'U', ...data };
    const result = await this.runner.run(treeId, context, {
      kind: 'create_person',
      summary: (rows) => describeCommand(command, rows),
      commands: [command]
    });
    const individual = await this.genealogyRepo.getIndividual(treeId, personId);
    return { individual: individual!, change: result.change };
  }

  async updateIndividual(
    treeId: string,
    individualId: string,
    expectedVersion: number,
    data: {
      givenName?: string | null;
      surname?: string | null;
      sex?: Sex;
      birthDate?: string | null;
      birthPlace?: string | null;
      deathDate?: string | null;
      deathPlace?: string | null;
    },
    context: AuthenticatedContext
  ) {
    await this.verifyTreeAccess(treeId, context, 'record:edit');
    const command = { kind: 'update_person' as const, personId: individualId, expectedVersion, ...data };
    const result = await this.runner.run(treeId, context, {
      kind: 'update_person',
      summary: (rows) => describeCommand(command, rows),
      commands: [command]
    });
    const individual = await this.genealogyRepo.getIndividual(treeId, individualId);
    return { individual: individual!, change: result.change };
  }

  async getIndividual(treeId: string, individualId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'record:edit');
    const individual = await this.genealogyRepo.getIndividual(treeId, individualId);
    if (!individual) throw new NotFoundError('Individual', individualId);
    return individual;
  }

  /** What deleting this person would remove and change, listed exactly. Nothing is saved. */
  async previewDeleteIndividual(treeId: string, individualId: string, context: AuthenticatedContext): Promise<ImpactSummary> {
    const command = { kind: 'delete_person' as const, personId: individualId };
    return this.runner.preview(treeId, context, [command], (rows) => describeCommand(command, rows));
  }

  async deleteIndividual(treeId: string, individualId: string, context: AuthenticatedContext, expectedVersion?: number) {
    await this.verifyTreeAccess(treeId, context, 'record:delete');
    const command = { kind: 'delete_person' as const, personId: individualId, expectedVersion };
    return this.runner.run(treeId, context, {
      kind: 'delete_person',
      summary: (rows) => describeCommand(command, rows),
      commands: [command]
    });
  }

  /** Counts of everything deleting a tree would erase. Deleting a tree is not undoable. */
  async previewDeleteTree(treeId: string, context: AuthenticatedContext) {
    await this.verifyTreeAccess(treeId, context, 'tree:delete');
    const rows = await this.runner.store.loadRows(treeId);
    return {
      people: rows.individuals.length,
      unions: rows.unions.length,
      links: rows.parentChild.length,
      events: rows.events.length,
      media: rows.mediaItems.length
    };
  }
}
