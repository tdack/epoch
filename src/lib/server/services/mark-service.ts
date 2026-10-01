/**
 * Recents and favourites. Both need only `tree:view`: a viewer's shortcuts change nothing in the
 * tree, and they are kept per user (ADR-014), so they are not tree content and are not logged.
 */

import type { DbClient } from '../db';
import { NotFoundError } from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { GraphWindowRepository } from '../repositories/graph-window-repository';
import { MarkRepository, type MarkKind } from '../repositories/mark-repository';
import { UserRepository } from '../repositories/user-repository';
import type { MarkedPersonDto, MarksDto } from '../../shared/marks';
import { filterForViewer } from './privacy-seam';
import { personSummaries } from './person-summaries';
import { requireTreeAction } from './tree-access';

export class MarkService {
	private marks: MarkRepository;
	private graphRepo: GraphWindowRepository;
	private users: UserRepository;

	constructor(
		db: DbClient,
		private now: () => number = () => Date.now()
	) {
		this.marks = new MarkRepository(db);
		this.graphRepo = new GraphWindowRepository(db);
		this.users = new UserRepository(db);
	}

	async get(treeId: string, context: AuthenticatedContext): Promise<MarksDto> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		const [favoriteIds, recentIds] = await Promise.all([
			this.marks.list(context.user.id, treeId, 'favorite'),
			this.marks.list(context.user.id, treeId, 'recent')
		]);
		const ids = [...new Set([...favoriteIds, ...recentIds])];
		// A mark for a person who no longer exists (deleted, maybe to be undone) is skipped, not shown as "Unknown".
		const [existing] = await this.graphRepo.run(this.graphRepo.individualsIn(treeId, ids));
		const present = new Set(existing.map(({ row }) => row.id));
		const summaries = await personSummaries(this.graphRepo, treeId, undefined, ids.filter((id) => present.has(id)));
		const named = (list: string[]): MarkedPersonDto[] =>
			filterForViewer(
				list.filter((id) => present.has(id)).map((id) => {
					const s = summaries.get(id)!;
					return { isPrivate: s.isPrivate, id, displayName: s.displayName, birthDate: s.birthDate, deathDate: s.deathDate, isDeceased: s.isDeceased };
				}),
				context
			);
		return { favorites: named(favoriteIds), recents: named(recentIds) };
	}

	private async mark(treeId: string, personId: string, kind: MarkKind, context: AuthenticatedContext): Promise<void> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		const [people] = await this.graphRepo.run(this.graphRepo.individualsIn(treeId, [personId]));
		if (people.length === 0) throw new NotFoundError('Person', personId);
		await this.marks.touch(context.user.id, treeId, personId, kind, this.now());
	}

	recordRecent(treeId: string, personId: string, context: AuthenticatedContext) {
		return this.mark(treeId, personId, 'recent', context);
	}

	addFavorite(treeId: string, personId: string, context: AuthenticatedContext) {
		return this.mark(treeId, personId, 'favorite', context);
	}

	async removeFavorite(treeId: string, personId: string, context: AuthenticatedContext): Promise<void> {
		await requireTreeAction(this.users, treeId, context, 'tree:view');
		await this.marks.remove(context.user.id, treeId, personId, 'favorite');
	}
}
