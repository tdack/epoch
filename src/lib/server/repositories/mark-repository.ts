/** A user's favourites and recents in a tree (ADR-014). Every query is scoped to user and tree. */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { personMarks } from '../db/schema';
import { MAX_RECENTS } from '../../shared/marks';

export type MarkKind = 'favorite' | 'recent';

export class MarkRepository {
	constructor(private db: DbClient) {}

	/** Person ids, most recently marked first. */
	async list(userId: string, treeId: string, kind: MarkKind): Promise<string[]> {
		const rows = await this.db
			.select({ personId: personMarks.personId })
			.from(personMarks)
			.where(and(eq(personMarks.userId, userId), eq(personMarks.treeId, treeId), eq(personMarks.kind, kind)))
			.orderBy(desc(personMarks.touchedAt), desc(personMarks.id))
			.all();
		return rows.map((r) => r.personId);
	}

	/** Marks the person, or moves an existing mark to the front. Idempotent. */
	async touch(userId: string, treeId: string, personId: string, kind: MarkKind, now: number): Promise<void> {
		await this.db
			.insert(personMarks)
			.values({ id: crypto.randomUUID(), userId, treeId, personId, kind, touchedAt: now })
			.onConflictDoUpdate({ target: [personMarks.userId, personMarks.treeId, personMarks.kind, personMarks.personId], set: { touchedAt: now } });
		if (kind === 'recent') {
			// Keep the newest MAX_RECENTS; the list index orders them.
			await this.db.run(sql`
				delete from person_marks where user_id = ${userId} and tree_id = ${treeId} and kind = 'recent'
				and id not in (select id from person_marks where user_id = ${userId} and tree_id = ${treeId} and kind = 'recent' order by touched_at desc, id desc limit ${MAX_RECENTS})`);
		}
	}

	async remove(userId: string, treeId: string, personId: string, kind: MarkKind): Promise<void> {
		await this.db
			.delete(personMarks)
			.where(and(eq(personMarks.userId, userId), eq(personMarks.treeId, treeId), eq(personMarks.kind, kind), eq(personMarks.personId, personId)));
	}
}
