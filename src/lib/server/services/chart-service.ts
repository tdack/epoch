/**
 * The pedigree and descendant charts (Phase 3 item 9). Each loads a bounded kin window around one
 * person, masks it for the viewer as the record pages do, and hands it to the pure builders. A
 * private person asked for as the subject answers like a missing one; below or above them, a
 * hidden person is absent, or a "Private" card where the tree shows its private structure.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { buildDescendants, buildPedigree } from '../domain/descent-charts';
import { requireVisibleSubject } from '../domain/privacy-mask';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import {
	MAX_DESCENDANT_GENERATIONS,
	MAX_PEDIGREE_GENERATIONS,
	type DescendantsDto,
	type PedigreeDto
} from '../../shared/charts';
import { ValidationError } from '../domain/errors';
import { loadKinWindow } from './kin-window';
import { requireTreeScope } from './tree-access';

const clamp = (generations: number, max: number) => {
	if (!Number.isInteger(generations) || generations < 1 || generations > max)
		throw new ValidationError(`Generations must be a whole number from 1 to ${max}`);
	return generations;
};

export class ChartService {
	private repo: GraphWindowRepository;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => Date = () => new Date()
	) {
		this.repo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	async pedigree(
		treeId: string,
		personId: string,
		generations: number,
		context: AuthenticatedContext
	): Promise<PedigreeDto> {
		clamp(generations, MAX_PEDIGREE_GENERATIONS);
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			this.now()
		);
		const window = await loadKinWindow(this.repo, {
			treeId,
			startIds: [personId],
			ancestorGenerations: generations - 1,
			descendantGenerations: null,
			partnersOf: 'none'
		});
		const dto = buildPedigree(
			requireVisibleSubject(window, personId, scope),
			personId,
			generations
		);
		if (!dto) throw new NotFoundError('Person', personId);
		return { ...dto, hasMoreAbove: dto.hasMoreAbove || window.hasMoreAbove || window.isCapped };
	}

	async descendants(
		treeId: string,
		personId: string,
		generations: number,
		context: AuthenticatedContext
	): Promise<DescendantsDto> {
		clamp(generations, MAX_DESCENDANT_GENERATIONS);
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			this.now()
		);
		const window = await loadKinWindow(this.repo, {
			treeId,
			startIds: [personId],
			ancestorGenerations: null,
			descendantGenerations: generations - 1,
			partnersOf: 'all'
		});
		const built = buildDescendants(
			requireVisibleSubject(window, personId, scope),
			personId,
			generations
		);
		if (!built) throw new NotFoundError('Person', personId);
		return {
			root: built.root,
			generations,
			hasMoreBelow: built.hasMoreBelow || window.hasMoreBelow || window.isCapped
		};
	}
}
