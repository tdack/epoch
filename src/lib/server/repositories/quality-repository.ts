/** Dismissed data-quality findings of a tree (Phase 5). Every query is scoped to the tree. */

import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../db';
import { qualityDismissals, users } from '../db/schema';
import { chunkByParamLimit } from './param-chunks';
import type { QualityDismissal } from '../../shared/quality';

/** What a dismissal shows of the person who made it: a name, never an email address. */
const UNNAMED_MEMBER = 'A member';

export class QualityRepository {
	constructor(private db: DbClient) {}

	async list(treeId: string): Promise<QualityDismissal[]> {
		const rows = await this.db
			.select({
				key: qualityDismissals.findingKey,
				reason: qualityDismissals.reason,
				by: users.name,
				at: qualityDismissals.dismissedAt
			})
			.from(qualityDismissals)
			.leftJoin(users, eq(users.id, qualityDismissals.dismissedBy))
			.where(eq(qualityDismissals.treeId, treeId))
			.orderBy(qualityDismissals.findingKey)
			.all();
		return rows.map((r) => ({
			key: r.key,
			reason: r.reason,
			dismissedBy: r.by ?? UNNAMED_MEMBER,
			dismissedAt: r.at
		}));
	}

	/**
	 * Records one decision for every key, all or none; dismissing again replaces the reason and the
	 * person, so the latest word stands.
	 */
	async dismiss(
		treeId: string,
		findingKeys: string[],
		reason: string,
		userId: string,
		now: number
	): Promise<void> {
		const rows = findingKeys.map((findingKey) => ({
			id: crypto.randomUUID(),
			treeId,
			findingKey,
			reason,
			dismissedBy: userId,
			dismissedAt: now
		}));
		const inserts = chunkByParamLimit(rows, 6).map((chunk) =>
			this.db
				.insert(qualityDismissals)
				.values(chunk)
				.onConflictDoUpdate({
					target: [qualityDismissals.treeId, qualityDismissals.findingKey],
					set: { reason, dismissedBy: userId, dismissedAt: now }
				})
		);
		const [first, ...rest] = inserts;
		if (first) await this.db.batch([first, ...rest]);
	}

	/** @returns false when there was no such dismissal. */
	async restore(treeId: string, findingKey: string): Promise<boolean> {
		const removed = await this.db
			.delete(qualityDismissals)
			.where(
				and(eq(qualityDismissals.treeId, treeId), eq(qualityDismissals.findingKey, findingKey))
			)
			.returning({ id: qualityDismissals.id })
			.all();
		return removed.length > 0;
	}
}
