/**
 * A tree's Overview page: counts and spreads over the people the viewer may see. Reads only the
 * tables of people and their facts, since unlike the quality report this page is opened often; the
 * mask reads no others to decide who is hidden.
 */

import type { DbClient } from '../db';
import type { TreeRows } from '../domain/change-log';
import type { AuthenticatedContext } from '../domain/identity';
import { anniversariesAround, anniversariesOn, overviewStats } from '../domain/overview';
import { livingCutoff } from '../domain/living-state';
import { omitForScope } from '../domain/privacy-mask';
import { ChangeStore } from '../repositories/change-store';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { isActionAllowed } from '../auth/authorization';
import type { AnniversaryDto, OverviewDto } from '../../shared/overview';
import { ChangeLogService } from './change-log-service';
import { TaskReadService } from './task-read-service';
import { requireTreeScope, type ViewerScope } from './tree-access';

/** How many of the viewer's tasks and the tree's changes the page lists; each links to the rest. */
const WORK_ITEMS = 5;

export class OverviewService {
	private store: ChangeStore;
	private tasks: TaskReadService;
	private changes: ChangeLogService;
	private users: UserRepository;
	private trees: TreeRepository;

	constructor(
		db: DbClient,
		private now: () => number = () => Date.now()
	) {
		this.store = new ChangeStore(db);
		this.tasks = new TaskReadService(db, () => new Date(this.now()));
		this.changes = new ChangeLogService(db);
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
		const [myTasks, recentChanges] = await Promise.all([
			scope.isOutsider
				? null
				: this.tasks
						.listTasks(treeId, { isMine: true, status: 'open', limit: WORK_ITEMS }, context)
						.then((page) => ({ items: page.items, open: page.counts.open })),
			isActionAllowed(scope.role, 'record:edit')
				? this.changes
						.listRecent(treeId, context, WORK_ITEMS)
						.then((rows) =>
							rows.map((r) => ({ id: r.id, summary: r.summary, createdAt: r.createdAt }))
						)
				: null
		]);
		const visible = await this.visibleRows(treeId, scope);
		const now = new Date(this.now());
		const today = now.toISOString().slice(0, 10);
		const settings = await this.trees.privacySettings(treeId);
		return {
			stats: overviewStats(visible),
			anniversaries: anniversariesAround(
				visible,
				today,
				livingCutoff(now, settings?.maxAliveYears),
				scope.isOutsider
			),
			work: { myTasks, recentChanges },
			today
		};
	}

	/** The tree's people, partnerships and facts as the viewer may see them: the one masking every figure here shares. */
	private async visibleRows(treeId: string, scope: ViewerScope): Promise<TreeRows> {
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
			subtrees: [],
			placeLocations: []
		};
		return omitForScope(rows, scope);
	}

	/**
	 * The births, partnerships and deaths recorded to an exact day, for the calendar: one month, or
	 * (with no month) the whole year, which is what the `.ics` file carries. Masked and omitted for an
	 * outsider exactly as the Overview's "Coming up" is.
	 */
	async calendar(
		treeId: string,
		context: AuthenticatedContext,
		month: number | null = null
	): Promise<AnniversaryDto[]> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			'tree:view',
			new Date(this.now())
		);
		const [visible, settings] = await Promise.all([
			this.visibleRows(treeId, scope),
			this.trees.privacySettings(treeId)
		]);
		const prefix = month === null ? null : `${String(month).padStart(2, '0')}-`;
		return anniversariesOn(
			visible,
			(monthDay) => prefix === null || monthDay.startsWith(prefix),
			livingCutoff(new Date(this.now()), settings?.maxAliveYears),
			scope.isOutsider
		);
	}
}
