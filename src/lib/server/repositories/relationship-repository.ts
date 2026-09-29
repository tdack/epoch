/**
 * Read-side queries for relationship editing. Writes do not live here: every mutation is planned
 * as row operations and applied by `ChangeStore`, which also logs it (ADR-007).
 */

import type { DbClient } from '../db';
import { individuals } from '../db/schema';
import { eq, and, like } from 'drizzle-orm';

export interface DuplicateCandidate {
	id: string;
	givenName: string | null;
	surname: string | null;
}

export class RelationshipRepository {
	constructor(private db: DbClient) {}

	/** Search for similarly named people (duplicate cues) within a tree. */
	async searchPeople(treeId: string, query: string): Promise<DuplicateCandidate[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const rows = await this.db
			.select({
				id: individuals.id,
				givenName: individuals.givenName,
				surname: individuals.surname
			})
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), like(individuals.givenName, `%${trimmed}%`)))
			.all();

		// Also match on surname for a broader duplicate cue.
		const surnameRows = await this.db
			.select({
				id: individuals.id,
				givenName: individuals.givenName,
				surname: individuals.surname
			})
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), like(individuals.surname, `%${trimmed}%`)))
			.all();

		const byId = new Map<string, DuplicateCandidate>();
		for (const r of [...rows, ...surnameRows]) {
			if (!byId.has(r.id)) byId.set(r.id, r);
		}
		return [...byId.values()];
	}
}
