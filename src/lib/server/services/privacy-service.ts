/**
 * What a manager can do about privacy (ADR-015): force one person public or private, and set the
 * tree's own thresholds. A person's override is a logged, undoable change like any other edit of
 * them; the tree settings are not tree content and are not logged.
 */

import type { DbClient } from '../db';
import { ValidationError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { describeCommand } from '../domain/command-summary';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { PERSON_PRIVACY_VALUES, type PersonPrivacy } from '../../shared/privacy';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';
import { requireTreeAction } from './tree-access';

/** Bounds on the tree's threshold: below this living people would be shown; above it nothing is ever old enough. */
export const MIN_MAX_ALIVE_YEARS = 50;
export const MAX_MAX_ALIVE_YEARS = 150;

export interface PrivacySettingsDto {
	maxAliveYears: number;
	shouldShowPrivateStructure: boolean;
}

export class PrivacyService {
	private runner: MutationRunner;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	/** Force a person public or private, or hand them back to the derivation (`auto`). */
	async setPersonPrivacy(treeId: string, personId: string, privacy: PersonPrivacy, expectedVersion: number | undefined, context: AuthenticatedContext): Promise<MutationResult> {
		if (!PERSON_PRIVACY_VALUES.includes(privacy)) throw new ValidationError('Privacy must be auto, public or private');
		await requireTreeAction(this.users, treeId, context, 'person:set_privacy');
		const command = { kind: 'set_person_privacy' as const, personId, privacy, expectedVersion };
		return this.runner.run(treeId, context, { kind: command.kind, summary: (rows) => describeCommand(command, rows), commands: [command] });
	}

	async getSettings(treeId: string, context: AuthenticatedContext): Promise<PrivacySettingsDto> {
		await requireTreeAction(this.users, treeId, context, 'tree:update_settings');
		const settings = await this.trees.privacySettings(treeId);
		if (!settings) throw new ValidationError('Tree not found');
		return settings;
	}

	async updateSettings(treeId: string, patch: Partial<PrivacySettingsDto>, context: AuthenticatedContext): Promise<PrivacySettingsDto> {
		await requireTreeAction(this.users, treeId, context, 'tree:update_settings');
		const { maxAliveYears } = patch;
		if (maxAliveYears !== undefined && (!Number.isInteger(maxAliveYears) || maxAliveYears < MIN_MAX_ALIVE_YEARS || maxAliveYears > MAX_MAX_ALIVE_YEARS)) {
			throw new ValidationError(`The age after which someone is assumed to have died must be between ${MIN_MAX_ALIVE_YEARS} and ${MAX_MAX_ALIVE_YEARS} years`);
		}
		await this.trees.updatePrivacySettings(treeId, patch);
		return this.getSettings(treeId, context);
	}
}
