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

type Viewer = Pick<ViewerScope, 'cutoff' | 'creatorId'>;

/**
 * A person row is visible: not forced private, and either forced public, created by this viewer, or
 * shown not to be living. The creator test comes first so a contributor's own people cost no event
 * lookups.
 */
function isVisibleSql(alias: string, { cutoff, creatorId }: Viewer): SQL {
	const person = sql.raw(alias);
	// `is`, not `=`: a person with no author has a null `created_by`, and `null = x` is null, which
	// turns `false or <birth test>` into null where the viewer's form gives false. `not` of that null
	// is null too, so a partnership with a private partner would pass the all-partners-visible test.
	const isOwn = creatorId === null ? sql`` : sql`${person}.created_by is ${creatorId} or `;
	return sql`(${person}.privacy = 'public' or (${person}.privacy = 'auto' and (${isOwn}
		exists (select 1 from events de where de.entity_type = 'INDIVIDUAL' and de.entity_id = ${person}.id and de.type in (${list(DEATH_EVENT_TYPES)}))
		or (select max(coalesce(be.date_sort_end, '9999-12-31')) from events be where be.entity_type = 'INDIVIDUAL' and be.entity_id = ${person}.id and be.type in (${list(BIRTH_EVENT_TYPES)})) < ${cutoff}
	)))`;
}

/** The bare predicate, for a caller that composes it inside its own subquery. */
export function isVisibleOf(alias: string, scope: Viewer): SQL {
	return isVisibleSql(alias, scope);
}

/**
 * ` and <visible>` to append to a where clause on `individuals` aliased `alias`; empty when the
 * viewer sees everyone. `alias` is a literal from the calling query, never user input.
 */
export function andVisible(alias: string, scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>): SQL {
	return scope.isRestricted ? sql` and ${isVisibleSql(alias, scope)}` : sql``;
}

/** Which of these people exist in the tree and the viewer may see: a private person is exactly as absent as a missing one. */
export async function visibleAmong(db: DbClient, treeId: string, personIds: readonly string[], scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>): Promise<Set<string>> {
	if (personIds.length === 0) return new Set();
	const ids = sql.join(personIds.map((id) => sql`${id}`), sql`, `);
	const rows = await db.all<{ id: string }>(sql`select i.id as id from individuals i where i.tree_id = ${treeId} and i.id in (${ids})${andVisible('i', scope)}`);
	return new Set(rows.map((r) => r.id));
}

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

/** The header counts a restricted viewer may see: visible people, and partnerships whose every partner is visible (as in the list). */
export async function visibleCounts(db: DbClient, treeId: string, scope: Scope): Promise<{ people: number; unions: number }> {
	const row = await db.all<{ people: number; unions: number }>(sql`
		select
			(select count(*) from individuals i where i.tree_id = ${treeId}${andVisible('i', scope)}) as people,
			(select count(*) from unions u where u.tree_id = ${treeId} and not exists (
				select 1 from union_partners up join individuals p on p.id = up.person_id where up.union_id = u.id and not ${isVisibleSql('p', scope)})) as unions`);
	return { people: row[0]!.people, unions: row[0]!.unions };
}

/** The first visible person in creation order: the default focus, which must not be a private person. */
export async function firstVisiblePersonId(db: DbClient, treeId: string, scope: Scope): Promise<string | null> {
	const rows = await db.all<{ id: string }>(sql`select i.id as id from individuals i where i.tree_id = ${treeId}${andVisible('i', scope)} order by i.rowid limit 1`);
	return rows[0]?.id ?? null;
}
