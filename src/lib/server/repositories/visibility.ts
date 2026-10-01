/**
 * The privacy rule of `domain/living-state.ts` as a SQL predicate (ADR-015), for the reads that
 * page or count in SQL. Putting it beside `tree_id` means totals, `hasMore`, page fill, surname
 * counts and ordering are all computed over what the viewer may see, which a filter applied to a
 * finished page cannot do. A test holds this and the pure function to the same answers.
 *
 * It is empty for a viewer who sees everyone, so an owner's, manager's or editor's query is the one
 * measured before privacy existed. For a restricted viewer it is two correlated lookups on
 * `idx_event_entity`, about 4.5 index rows per person (query-plans.md).
 */

import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { BIRTH_EVENT_TYPES, DEATH_EVENT_TYPES } from '../domain/living-state';
import type { ViewerScope } from '../services/tree-access';

const list = (types: readonly string[]) => sql.raw(types.map((t) => `'${t}'`).join(', '));

/** A person row is visible: not forced private, and either forced public or shown not to be living. */
function isVisibleSql(alias: string, cutoff: string): SQL {
	const person = sql.raw(alias);
	return sql`(${person}.privacy = 'public' or (${person}.privacy = 'auto' and (
		exists (select 1 from events de where de.entity_type = 'INDIVIDUAL' and de.entity_id = ${person}.id and de.type in (${list(DEATH_EVENT_TYPES)}))
		or (select max(coalesce(be.date_sort_end, '9999-12-31')) from events be where be.entity_type = 'INDIVIDUAL' and be.entity_id = ${person}.id and be.type in (${list(BIRTH_EVENT_TYPES)})) < ${cutoff}
	)))`;
}

/** The bare predicate, for a caller that composes it inside its own subquery. */
export function isVisibleOf(alias: string, scope: Pick<ViewerScope, 'cutoff'>): SQL {
	return isVisibleSql(alias, scope.cutoff);
}

/**
 * ` and <visible>` to append to a where clause on `individuals` aliased `alias`; empty when the
 * viewer sees everyone. `alias` is a literal from the calling query, never user input.
 */
export function andVisible(alias: string, scope: Pick<ViewerScope, 'isRestricted' | 'cutoff'>): SQL {
	return scope.isRestricted ? sql` and ${isVisibleSql(alias, scope.cutoff)}` : sql``;
}

/** Which of these people exist in the tree and the viewer may see: a private person is exactly as absent as a missing one. */
export async function visibleAmong(db: DbClient, treeId: string, personIds: readonly string[], scope: Pick<ViewerScope, 'isRestricted' | 'cutoff'>): Promise<Set<string>> {
	if (personIds.length === 0) return new Set();
	const ids = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
	const rows = await db.all<{ id: string }>(sql`select i.id as id from individuals i where i.tree_id = ${treeId} and i.id in (${ids})${andVisible('i', scope)}`);
	return new Set(rows.map((r) => r.id));
}
