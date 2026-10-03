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
export function andVisible(
	alias: string,
	scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>
): SQL {
	return scope.isRestricted ? sql` and ${isVisibleSql(alias, scope)}` : sql``;
}

/** Which of these people exist in the tree and the viewer may see: a private person is exactly as absent as a missing one. */
export async function visibleAmong(
	db: DbClient,
	treeId: string,
	personIds: readonly string[],
	scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>
): Promise<Set<string>> {
	if (personIds.length === 0) return new Set();
	const ids = sql.join(
		personIds.map((id) => sql`${id}`),
		sql`, `
	);
	const rows = await db.all<{ id: string }>(
		sql`select i.id as id from individuals i where i.tree_id = ${treeId} and i.id in (${ids})${andVisible('i', scope)}`
	);
	return new Set(rows.map((r) => r.id));
}

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

/** The header counts a restricted viewer may see: visible people, and partnerships whose every partner is visible (as in the list). */
export async function visibleCounts(
	db: DbClient,
	treeId: string,
	scope: Scope
): Promise<{ people: number; unions: number }> {
	const row = await db.all<{ people: number; unions: number }>(sql`
		select
			(select count(*) from individuals i where i.tree_id = ${treeId}${andVisible('i', scope)}) as people,
			(select count(*) from unions u where u.tree_id = ${treeId} and not exists (
				select 1 from union_partners up join individuals p on p.id = up.person_id where up.union_id = u.id and not ${isVisibleSql('p', scope)})) as unions`);
	return { people: row[0]!.people, unions: row[0]!.unions };
}

/** The first visible person in creation order: the default focus, which must not be a private person. */
export async function firstVisiblePersonId(
	db: DbClient,
	treeId: string,
	scope: Scope
): Promise<string | null> {
	const rows = await db.all<{ id: string }>(
		sql`select i.id as id from individuals i where i.tree_id = ${treeId}${andVisible('i', scope)} order by i.rowid limit 1`
	);
	return rows[0]?.id ?? null;
}

/**
 * A citation row (aliased `alias`) whose subject the viewer may see: the SQL form of
 * `hiddenSubjectKeys` in `domain/privacy-mask.ts`, held to the same answers by a test. A name,
 * fact or parent link is its person's (or both of the link's people); a partnership, and the facts
 * of one, need every partner visible (ADR-015, ADR-028).
 *
 * The visible people are one uncorrelated subquery that SQLite evaluates once and reuses, not the
 * person predicate repeated inside each branch: nested that way a source's or repository's test
 * exceeded SQLite's expression depth (100), and it is cheaper this way as well.
 */
export function isCitationVisibleOf(alias: string, scope: Viewer, treeId: string): SQL {
	const people = sql`(select ip.id from individuals ip where ip.tree_id = ${treeId} and ${isVisibleSql('ip', scope)})`;
	return citationVisibleWith(alias, people);
}

/** The citation test over a given set of visible people: inline for one citation, `vp` inside a note's test. */
function citationVisibleWith(alias: string, people: SQL): SQL {
	const c = sql.raw(alias);
	const unionOk = (column: SQL) =>
		sql`not exists (select 1 from union_partners up where up.union_id = ${column} and up.person_id not in ${people})`;
	return sql`(case ${c}.subject_kind
		when 'person' then ${c}.subject_id in ${people}
		when 'name' then exists (select 1 from person_names n where n.id = ${c}.subject_id and n.person_id in ${people})
		when 'event' then exists (select 1 from events e where e.id = ${c}.subject_id and (
			(e.entity_type = 'INDIVIDUAL' and e.entity_id in ${people})
			or (e.entity_type = 'FAMILY' and ${unionOk(sql`e.entity_id`)})))
		when 'union' then exists (select 1 from unions u where u.id = ${c}.subject_id) and ${unionOk(sql`${c}.subject_id`)}
		else exists (select 1 from parent_child l where l.id = ${c}.subject_id
			and l.parent_id in ${people} and l.child_id in ${people}
			and (l.union_id is null or ${unionOk(sql`l.union_id`)}))
	end)`;
}

/**
 * `with vp(id) as (...)` for a statement that tests sources or repositories: the people the viewer
 * may see, computed once. Empty for a viewer who sees everyone. It goes at the very start of the
 * statement, because the person test nested inside the source test inside the repository test is
 * deeper than the 100 levels of expression D1 allows, and one definition used by name is not.
 */
export function withVisiblePeople(treeId: string, scope: Scope): SQL {
	if (!scope.isRestricted) return sql``;
	return sql`with vp(id) as (select ip.id from individuals ip where ip.tree_id = ${treeId} and ${isVisibleSql('ip', scope)}) `;
}

/**
 * The ids of the sources that cite something the viewer may see, as one compound select (five
 * terms, the most D1 allows): a branch per kind of subject. Needs `withVisiblePeople` before it.
 */
function visibleCitedSourceIds(treeId: string): SQL {
	const people = sql`(select id from vp)`;
	const unionOk = (column: SQL) =>
		sql`not exists (select 1 from union_partners up where up.union_id = ${column} and up.person_id not in ${people})`;
	const from = sql`from citations vc where vc.tree_id = ${treeId} and vc.source_id is not null`;
	return sql`
		select vc.source_id as id ${from} and vc.subject_kind = 'person' and vc.subject_id in ${people}
		union select vc.source_id ${from} and vc.subject_kind = 'name'
			and vc.subject_id in (select n.id from person_names n where n.person_id in ${people})
		union select vc.source_id ${from} and vc.subject_kind = 'event' and vc.subject_id in (
			select e.id from events e where e.tree_id = ${treeId} and (
				(e.entity_type = 'INDIVIDUAL' and e.entity_id in ${people})
				or (e.entity_type = 'FAMILY' and ${unionOk(sql`e.entity_id`)})))
		union select vc.source_id ${from} and vc.subject_kind = 'union' and vc.subject_id in (
			select u.id from unions u where u.tree_id = ${treeId} and ${unionOk(sql`u.id`)})
		union select vc.source_id ${from} and vc.subject_kind = 'parent_child' and vc.subject_id in (
			select l.id from parent_child l where l.tree_id = ${treeId}
				and l.parent_id in ${people} and l.child_id in ${people}
				and (l.union_id is null or ${unionOk(sql`l.union_id`)}))`;
}

/**
 * ` and <visible>` for a source row (aliased `alias`): it supports a citation the viewer can see,
 * or they made it. Empty for a viewer who sees everyone. The statement must start with
 * `withVisiblePeople`.
 */
export function andSourceVisible(alias: string, scope: Scope, treeId: string): SQL {
	if (!scope.isRestricted) return sql``;
	const s = sql.raw(alias);
	const isOwn = scope.creatorId === null ? sql`` : sql`${s}.created_by is ${scope.creatorId} or `;
	return sql` and (${isOwn}${s}.id in (${visibleCitedSourceIds(treeId)}))`;
}

/** The same for a repository row: one of their visible sources is kept there, or they made it. */
export function andRepositoryVisible(alias: string, scope: Scope, treeId: string): SQL {
	if (!scope.isRestricted) return sql``;
	const r = sql.raw(alias);
	const isOwn = scope.creatorId === null ? sql`` : sql`${r}.created_by is ${scope.creatorId} or `;
	const ownSources =
		scope.creatorId === null
			? sql``
			: sql` or vl.source_id in (select os.id from sources os where os.tree_id = ${treeId} and os.created_by = ${scope.creatorId})`;
	return sql` and (${isOwn}${r}.id in (select vl.repository_id from source_repositories vl where vl.repository_id is not null and (vl.source_id in (${visibleCitedSourceIds(treeId)})${ownSources})))`;
}

/**
 * A note attachment row (aliased `alias`) whose subject the viewer may see: the SQL form of
 * `visibleEvidence` in `domain/privacy-mask.ts`, held to the same answers by a test (ADR-029). The
 * first five kinds are the citation's; a note on a citation is as visible as the citation, and a
 * note on a source or a repository as visible as that record is to this viewer. The statement must
 * start with `withVisiblePeople`.
 */
export function isNoteAttachmentVisibleOf(alias: string, scope: Scope, treeId: string): SQL {
	const a = sql.raw(alias);
	const people = sql`(select id from vp)`;
	const isOwn = (row: string) =>
		scope.creatorId === null ? sql`` : sql`${sql.raw(row)}.created_by is ${scope.creatorId} or `;
	const ownSources =
		scope.creatorId === null
			? sql``
			: sql` or vl.source_id in (select os.id from sources os where os.tree_id = ${treeId} and os.created_by = ${scope.creatorId})`;
	return sql`(case ${a}.subject_kind
		when 'citation' then exists (select 1 from citations vc where vc.id = ${a}.subject_id and ${citationVisibleWith('vc', people)})
		when 'source' then exists (select 1 from sources vs where vs.id = ${a}.subject_id and (${isOwn('vs')}vs.id in (${visibleCitedSourceIds(treeId)})))
		when 'repository' then exists (select 1 from repositories vr where vr.id = ${a}.subject_id and (${isOwn('vr')}vr.id in (select vl.repository_id from source_repositories vl where vl.repository_id is not null and (vl.source_id in (${visibleCitedSourceIds(treeId)})${ownSources}))))
		else ${citationVisibleWith(alias, people)}
	end)`;
}

/** ` and <visible>` for an attachment row; empty for a viewer who sees everyone. */
export function andNoteAttachmentVisible(alias: string, scope: Scope, treeId: string): SQL {
	return scope.isRestricted ? sql` and ${isNoteAttachmentVisibleOf(alias, scope, treeId)}` : sql``;
}

/**
 * ` and <visible>` for a shared note row (aliased `alias`): a visible attachment uses it, or the
 * viewer made it; otherwise it is as absent as a private person (ADR-029). Empty for a viewer who
 * sees everyone. The statement must start with `withVisiblePeople`.
 */
export function andNoteVisible(alias: string, scope: Scope, treeId: string): SQL {
	if (!scope.isRestricted) return sql``;
	const n = sql.raw(alias);
	const isOwn = scope.creatorId === null ? sql`` : sql`${n}.created_by is ${scope.creatorId} or `;
	return sql` and (${isOwn}exists (select 1 from note_attachments na where na.note_id = ${n}.id and ${isNoteAttachmentVisibleOf('na', scope, treeId)}))`;
}
