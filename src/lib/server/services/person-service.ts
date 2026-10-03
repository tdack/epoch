import type { DbClient } from '../db';
import { GenealogyRepository } from '../repositories/genealogy-repository';
import { UserRepository } from '../repositories/user-repository';
import { requireTreeAction } from './tree-access';
import { NotFoundError, ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { describeCommand } from '../domain/command-summary';
import type { ImpactSummary } from '../../shared/impact';
import { MutationRunner, type MutationClock } from './mutation-runner';
import type { Sex } from '../../shared/sex';

/**
 * Create, edit and delete a person's own record (name fields, sex, birth and death). Everything
 * else about a person (facts, names, relationships) has its own service; this is the record itself.
 */
export class PersonService {
	private userRepo: UserRepository;
	private genealogyRepo: GenealogyRepository;
	private runner: MutationRunner;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
		this.userRepo = new UserRepository(db);
		this.genealogyRepo = new GenealogyRepository(db);
	}

	async create(
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
		await requireTreeAction(this.userRepo, treeId, context, 'record:create');
		if (!data.givenName?.trim() && !data.surname?.trim()) {
			throw new ValidationError('Given name or surname is required');
		}
		const personId = this.runner.clock.newId();
		const command = {
			kind: 'create_person' as const,
			personId,
			givenName: data.givenName ?? null,
			surname: data.surname ?? null,
			sex: data.sex ?? 'U',
			...data
		};
		const result = await this.runner.run(treeId, context, {
			kind: 'create_person',
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
		const individual = await this.genealogyRepo.getIndividual(treeId, personId);
		return { individual: individual!, change: result.change };
	}

	async update(
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
		await requireTreeAction(this.userRepo, treeId, context, 'record:edit');
		const command = {
			kind: 'update_person' as const,
			personId: individualId,
			expectedVersion,
			...data
		};
		const result = await this.runner.run(treeId, context, {
			kind: 'update_person',
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
		const individual = await this.genealogyRepo.getIndividual(treeId, individualId);
		return { individual: individual!, change: result.change };
	}

	async get(treeId: string, individualId: string, context: AuthenticatedContext) {
		await requireTreeAction(this.userRepo, treeId, context, 'record:edit');
		const individual = await this.genealogyRepo.getIndividual(treeId, individualId);
		if (!individual) throw new NotFoundError('Individual', individualId);
		return individual;
	}

	/** What deleting this person would remove and change, listed exactly. Nothing is saved. */
	async previewDelete(
		treeId: string,
		individualId: string,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		const command = { kind: 'delete_person' as const, personId: individualId };
		return this.runner.preview(treeId, context, [command], (rows) =>
			describeCommand(command, rows)
		);
	}

	async remove(
		treeId: string,
		individualId: string,
		context: AuthenticatedContext,
		expectedVersion?: number
	) {
		await requireTreeAction(this.userRepo, treeId, context, 'record:delete');
		const command = { kind: 'delete_person' as const, personId: individualId, expectedVersion };
		return this.runner.run(treeId, context, {
			kind: 'delete_person',
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}
}
