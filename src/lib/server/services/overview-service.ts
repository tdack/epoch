/**
 * A tree's Overview page: counts and spreads over the people the viewer may see. Reads only the
 * tables of people and their facts, since unlike the quality report this page is opened often; the
 * mask reads no others to decide who is hidden.
 */

import type { DbClient } from '../db';
import type { TreeRows } from '../domain/change-log';
import type { AuthenticatedContext } from '../domain/identity';
import { overviewStats } from '../domain/overview';
import { omitForScope } from '../domain/privacy-mask';
import { ChangeStore } from '../repositories/change-store';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import type { OverviewDto } from '../../shared/overview';
import { requireTreeScope } from './tree-access';

export class OverviewService {
	private store: ChangeStore;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => number = () => Date.now()
	) {
		this.store = new ChangeStore(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
	}

	async load(treeId: string, context: AuthenticatedContext): Promise<OverviewDto> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			new Date(this.now())
		);
		const load = <K extends keyof TreeRows>(key: K) => this.store.loadTable(treeId, key);
		const [individuals, personNames, unions, unionPartners, parentChild, events] =
			await Promise.all([
				load('individuals'),
				load('personNames'),
				load('unions'),
				load('unionPartners'),
				load('parentChild'),
				load('events')
			]);
		const rows: TreeRows = {
			individuals,
			personNames,
			unions,
			unionPartners,
			parentChild,
			events,
			mediaItems: [],
			mediaLinks: [],
			sources: [],
			repositories: [],
			sourceRepositories: [],
			citations: [],
			notes: [],
			noteAttachments: [],
			researchTasks: [],
			subtrees: []
		};
		return { stats: overviewStats(omitForScope(rows, scope)) };
	}
}
