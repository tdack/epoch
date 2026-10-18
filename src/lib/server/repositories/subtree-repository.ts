/**
 * Reads for sub-trees. A sub-tree is listed, and answers by id or slug, only for a viewer who may
 * see its root person, because its name could otherwise give the person away. The test is the
 * visibility predicate (`visibility.ts`) on the root, in the same statement as the sub-tree.
 *
 * Writes are not here: they go through the mutation runner and the change log.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import type { SubtreeRow } from '../domain/change-log';
import type { ViewerScope } from '../services/tree-access';
import { toImage } from './change-store';
import { subtrees } from '../db/schema';
import { andVisible } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface SubtreeRead {
	row: SubtreeRow;
	/** The root person is not in the tree (deleted, and an undo would bring them back). */
	isRootMissing: boolean;
}

interface Found {
	id: string;
	isRootVisible: number;
	isRootPresent: number;
}

export class SubtreeRepository {
	constructor(private db: DbClient) {}

	/**
	 * The sub-trees of a tree in `position` order. A sub-tree whose root the viewer may not see is
	 * left out; one whose root is missing is kept only when `shouldShowMissingRoots` (a manager, who
	 * can repair or delete it), since nobody else can open it.
	 */
	async list(
		treeId: string,
		scope: Scope,
		shouldShowMissingRoots: boolean,
		where: SQL = sql``
	): Promise<SubtreeRead[]> {
		const found = await this.db.all<Found>(sql`
			select s.id as id,
				exists (select 1 from individuals i where i.id = s.root_person_id and i.tree_id = s.tree_id${andVisible('i', scope)}) as isRootVisible,
				exists (select 1 from individuals i where i.id = s.root_person_id and i.tree_id = s.tree_id) as isRootPresent
			from subtree s where s.tree_id = ${treeId}${where}
			order by s.position, s.rowid`);
		const kept = found.filter((f) => (f.isRootPresent ? f.isRootVisible : shouldShowMissingRoots));
		if (kept.length === 0) return [];
		const rows = await this.db
			.select()
			.from(subtrees)
			.where(sql`${subtrees.treeId} = ${treeId}`);
		const byId = new Map(rows.map((r) => [r.id, toImage(subtrees, r) as SubtreeRow]));
		return kept.map((f) => ({ row: byId.get(f.id)!, isRootMissing: !f.isRootPresent }));
	}

	/** One sub-tree by id or slug under the same rule; undefined when it is unknown or not visible. */
	async find(
		treeId: string,
		idOrSlug: string,
		scope: Scope,
		shouldShowMissingRoots: boolean
	): Promise<SubtreeRead | undefined> {
		const matches = await this.list(
			treeId,
			scope,
			shouldShowMissingRoots,
			sql` and (s.id = ${idOrSlug} or s.slug = ${idOrSlug})`
		);
		return matches[0];
	}
}
