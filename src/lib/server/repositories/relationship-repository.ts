/**
 * Read-side queries for relationship editing. Writes do not live here: every mutation is planned
 * as row operations and applied by `ChangeStore`, which also logs it (ADR-007).
 */

import type { DbClient } from '../db';
import { individuals, personNames } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface DuplicateCandidate {
	id: string;
	givenName: string | null;
	surname: string | null;
	/** Set when the person matched through another of their names, not the one they are shown by. */
	matchedName?: string;
}

export class RelationshipRepository {
	constructor(private db: DbClient) {}

	/**
	 * People whose display name or any stored name matches. "Jessica Wren" finds someone
	 * whose fields are given "Jessica" and surname "Smith" as well as someone who is now
	 * "Jessica Lovejoy" but has a married name of Smith; `matchedName` says which stored name
	 * matched when the display name did not.
	 */
	async searchPeople(treeId: string, query: string): Promise<DuplicateCandidate[]> {
		const words = query.trim().split(/\s+/).filter(Boolean);
		if (words.length === 0) return [];
		// Every word must appear, in any order, so "Jessica Wren" finds "Jessica Louise Wren".
		const patterns = words.map((word) => `%${word.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
		const matches = (given: unknown, surname: unknown) =>
			and(...patterns.map((pattern) => sql`(coalesce(${given}, '') || ' ' || coalesce(${surname}, '')) like ${pattern} escape '\\'`));

		const own = await this.db
			.select({ id: individuals.id, givenName: individuals.givenName, surname: individuals.surname })
			.from(individuals)
			.where(
				and(eq(individuals.treeId, treeId), matches(individuals.givenName, individuals.surname))
			)
			.orderBy(sql`${individuals}.rowid`)
			.all();

		// person_names has no tree_id, so it joins through individuals; the `+` keeps SQLite from
		// choosing the tree index and reading the whole tree to return a few rows (ADR-011).
		const named = await this.db
			.select({ id: individuals.id, givenName: individuals.givenName, surname: individuals.surname, nameGiven: personNames.givenName, nameSurname: personNames.surname, prefix: personNames.namePrefix, nickname: personNames.nickname })
			.from(personNames)
			.innerJoin(individuals, eq(personNames.personId, individuals.id))
			.where(
				and(sql`+${individuals.treeId} = ${treeId}`, matches(personNames.givenName, personNames.surname))
			)
			.orderBy(sql`${individuals}.rowid`, sql`${personNames}.rowid`)
			.all();

		const byId = new Map<string, DuplicateCandidate>();
		for (const r of own) byId.set(r.id, r);
		for (const r of named) {
			if (byId.has(r.id)) continue;
			byId.set(r.id, {
				id: r.id,
				givenName: r.givenName,
				surname: r.surname,
				matchedName: [r.nameGiven, r.nameSurname].filter(Boolean).join(' ')
			});
		}
		return [...byId.values()];
	}
}
