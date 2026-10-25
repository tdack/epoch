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
import {
	BIRTH_EVENT_TYPES,
	DEATH_EVENT_TYPES,
	EVERYONE_SHOWN_CUTOFF
} from '../domain/living-state';
import type { ViewerScope } from '../services/tree-access';
import { chunkIds } from './param-chunks';

/**
 * A list of event types as SQL literals. They are inline rather than bound because every visibility
 * fragment would then carry six more parameters, and the chunked id lists already sit near D1's
 * 100-parameter cap. Each is checked to be a bare tag, so a value that is not one cannot reach the SQL.
 */
export function literalList(types: readonly string[]): SQL {
	for (const t of types) {
		if (!/^[A-Z]{3,5}$/.test(t)) throw new Error(`not an event type: ${JSON.stringify(t)}`);
	}
	return sql.raw(types.map((t) => `'${t}'`).join(', '));
}

/**
 * An alias or column name spliced in as an identifier, checked so no caller can splice more than a
 * name. `sql.raw` alone would accept anything; these are literals today, and the check keeps them so.
 */
export function ident(name: string): SQL {
	if (!/^[a-z][a-z0-9_]*$/.test(name))
		throw new Error(`not an identifier: ${JSON.stringify(name)}`);
	return sql.raw(name);
}

const DEATH_TYPES_SQL = literalList(DEATH_EVENT_TYPES);
const BIRTH_TYPES_SQL = literalList(BIRTH_EVENT_TYPES);

type Viewer = Pick<ViewerScope, 'cutoff' | 'creatorId'>;

/**
 * A person row is visible: not forced private, and either forced public, created by this viewer, or
 * shown not to be living. The creator test comes first so a contributor's own people cost no event
 * lookups.
 */
function isVisibleSql(alias: string, { cutoff, creatorId }: Viewer): SQL {
	const person = ident(alias);
	// The public tree shows every person not marked private; see `EVERYONE_SHOWN_CUTOFF`.
	if (cutoff === EVERYONE_SHOWN_CUTOFF) return sql`(${person}.privacy != 'private')`;
	// `is`, not `=`: a person with no author has a null `created_by`, and `null = x` is null, which
	// turns `false or <birth test>` into null where the viewer's form gives false. `not` of that null
	// is null too, so a partnership with a private partner would pass the all-partners-visible test.
	const isOwn = creatorId === null ? sql`` : sql`${person}.created_by is ${creatorId} or `;
	return sql`(${person}.privacy = 'public' or (${person}.privacy = 'auto' and (${isOwn}
		exists (select 1 from events de where de.entity_type = 'INDIVIDUAL' and de.entity_id = ${person}.id and de.type in (${DEATH_TYPES_SQL}))
		or (select max(coalesce(be.date_sort_end, '9999-12-31')) from events be where be.entity_type = 'INDIVIDUAL' and be.entity_id = ${person}.id and be.type in (${BIRTH_TYPES_SQL})) < ${cutoff}
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

/**
 * Which of these people exist in the tree and the viewer may see: a private person is exactly as
 * absent as a missing one. Ids are chunked under D1's bound-parameter cap; the tree id and the
 * restricted-scope cutoff and creator add three more, which the chunk size leaves room for.
 */
export async function visibleAmong(
	db: DbClient,
	treeId: string,
	personIds: readonly string[],
	scope: Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>
): Promise<Set<string>> {
	const visible = new Set<string>();
	for (const part of chunkIds([...new Set(personIds)])) {
		const ids = sql.join(
			part.map((id) => sql`${id}`),
			sql`, `
		);
		const rows = await db.all<{ id: string }>(
			sql`select i.id as id from individuals i where i.tree_id = ${treeId} and i.id in (${ids})${andVisible('i', scope)}`
		);
		for (const row of rows) visible.add(row.id);
	}
	return visible;
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
	const c = ident(alias);
	const people = sql`(select ip.id from individuals ip where ip.tree_id = ${treeId} and ${isVisibleSql('ip', scope)})`;
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
 *
 * Given `sourceId`, a column of the outer row, each branch reads only that source's citations by
 * `idx_citation_source` instead of every citation of the tree. Correlated, it binds no ids, so the
 * five branches stay under D1's parameter cap; it is for a query whose sources are already a few.
 */
function visibleCitedSourceIds(treeId: string, sourceId?: SQL): SQL {
	const people = sql`(select id from vp)`;
	const unionOk = (column: SQL) =>
		sql`not exists (select 1 from union_partners up where up.union_id = ${column} and up.person_id not in ${people})`;
	// `+` keeps the tree and kind tests off `idx_citation_tree` and `idx_citation_subject`, which the
	// planner otherwise prefers, probing the citations of every visible person instead.
	const from = sourceId
		? sql`from citations vc where vc.source_id = ${sourceId} and +vc.tree_id = ${treeId}`
		: sql`from citations vc where vc.tree_id = ${treeId} and vc.source_id is not null`;
	const kind = sourceId ? sql`+vc.subject_kind` : sql`vc.subject_kind`;
	return sql`
		select vc.source_id as id ${from} and ${kind} = 'person' and vc.subject_id in ${people}
		union select vc.source_id ${from} and ${kind} = 'name'
			and vc.subject_id in (select n.id from person_names n where n.person_id in ${people})
		union select vc.source_id ${from} and ${kind} = 'event' and vc.subject_id in (
			select e.id from events e where e.tree_id = ${treeId} and (
				(e.entity_type = 'INDIVIDUAL' and e.entity_id in ${people})
				or (e.entity_type = 'FAMILY' and ${unionOk(sql`e.entity_id`)})))
		union select vc.source_id ${from} and ${kind} = 'union' and vc.subject_id in (
			select u.id from unions u where u.tree_id = ${treeId} and ${unionOk(sql`u.id`)})
		union select vc.source_id ${from} and ${kind} = 'parent_child' and vc.subject_id in (
			select l.id from parent_child l where l.tree_id = ${treeId}
				and l.parent_id in ${people} and l.child_id in ${people}
				and (l.union_id is null or ${unionOk(sql`l.union_id`)}))`;
}

/**
 * ` and <visible>` for a source row (aliased `alias`): it supports a citation the viewer can see,
 * or they made it. Empty for a viewer who sees everyone. The statement must start with
 * `withVisiblePeople`.
 *
 * `isBounded` is for a query whose sources are already a few ids (one source, a chunk): each is
 * then tested against its own citations. A list that pages over the tree leaves it off, since the
 * correlated test would run once per source of the tree.
 */
export function andSourceVisible(
	alias: string,
	scope: Scope,
	treeId: string,
	isBounded = false
): SQL {
	if (!scope.isRestricted) return sql``;
	const s = ident(alias);
	const isOwn = scope.creatorId === null ? sql`` : sql`${s}.created_by is ${scope.creatorId} or `;
	const cited = visibleCitedSourceIds(treeId, isBounded ? sql`${s}.id` : undefined);
	return sql` and (${isOwn}${s}.id in (${cited}))`;
}

/**
 * Which of these sources the viewer may see: the SQL form of the source rule in `maskRows`, so a
 * file hung off a source is exactly as visible as the source (ADR-028). Ids are chunked under D1's
 * bound-parameter cap.
 */
export async function visibleSourcesAmong(
	db: DbClient,
	treeId: string,
	sourceIds: readonly string[],
	scope: Scope
): Promise<Set<string>> {
	const visible = new Set<string>();
	for (const part of chunkIds([...new Set(sourceIds)])) {
		const ids = sql.join(
			part.map((id) => sql`${id}`),
			sql`, `
		);
		const rows = await db.all<{ id: string }>(
			sql`${withVisiblePeople(treeId, scope)}select s.id as id from sources s where s.tree_id = ${treeId} and s.id in (${ids})${andSourceVisible('s', scope, treeId, true)}`
		);
		for (const row of rows) visible.add(row.id);
	}
	return visible;
}

/** The same for a repository row: one of their visible sources is kept there, or they made it. */
export function andRepositoryVisible(alias: string, scope: Scope, treeId: string): SQL {
	if (!scope.isRestricted) return sql``;
	const r = ident(alias);
	const isOwn = scope.creatorId === null ? sql`` : sql`${r}.created_by is ${scope.creatorId} or `;
	const ownSources =
		scope.creatorId === null
			? sql``
			: sql` or vl.source_id in (select os.id from sources os where os.tree_id = ${treeId} and os.created_by = ${scope.creatorId})`;
	return sql` and (${isOwn}${r}.id in (select vl.repository_id from source_repositories vl where vl.repository_id is not null and (vl.source_id in (${visibleCitedSourceIds(treeId)})${ownSources})))`;
}

/**
 * `with vp(id) as (...), ... ` for a statement that tests notes (ADR-029): the records a viewer may
 * see, each computed once as a named set, so the test of a note is a flat choice among them instead
 * of the person test nested inside the citation test inside the source test, which is deeper than
 * the 100 levels of expression D1 allows. Empty for a viewer who sees everyone. It goes at the very
 * start of the statement.
 *
 * Each set is the SQL form of one step of `visibleEvidence` in `domain/privacy-mask.ts`: people
 * (`vp`), partnerships with a private partner (`hu`), and then the names, facts and links of
 * visible people (`vn`, `ve`, `vl`), the citations of those (`vc`), and the sources and repositories
 * they support or the viewer made (`vs`, `vr`). A test holds the two to the same answers.
 *
 * Given `noteId`, the shared notes (`vo`) are only that one, read by `idx_note_attachment_note`
 * rather than every attachment of the tree. Only `vo` is narrowed: the earlier sets are what an
 * attachment is tested against, and `hu` hides, so narrowing it would show what it should not.
 */
export function withVisibleNoteScope(treeId: string, scope: Scope, noteId?: string): SQL {
	if (!scope.isRestricted) return sql``;
	const people = sql`(select id from vp)`;
	const isOwn = (row: string) =>
		scope.creatorId === null ? sql`` : sql`${ident(row)}.created_by is ${scope.creatorId} or `;
	const oneNote = (column: string) =>
		noteId === undefined ? sql`` : sql` and ${sql.raw(column)} = ${noteId}`;
	// Led by the tree's unions: `union_partners` has no tree index, so its own tree_id would still read every tree.
	return sql`with vp(id) as (select ip.id from individuals ip where ip.tree_id = ${treeId} and ${isVisibleSql('ip', scope)}),
		hu(id) as (select up.union_id from unions hun join union_partners up on up.union_id = hun.id where hun.tree_id = ${treeId} and up.person_id not in ${people}),
		vn(id) as (select n.id from person_names n where n.person_id in ${people}),
		ve(id) as (select e.id from events e where e.tree_id = ${treeId} and (
			(e.entity_type = 'INDIVIDUAL' and e.entity_id in ${people})
			or (e.entity_type = 'FAMILY' and e.entity_id not in (select id from hu)))),
		vl(id) as (select l.id from parent_child l where l.tree_id = ${treeId}
			and l.parent_id in ${people} and l.child_id in ${people}
			and (l.union_id is null or l.union_id not in (select id from hu))),
		vc(id) as (select c.id from citations c where c.tree_id = ${treeId} and (
			(c.subject_kind = 'person' and c.subject_id in ${people})
			or (c.subject_kind = 'name' and c.subject_id in (select id from vn))
			or (c.subject_kind = 'event' and c.subject_id in (select id from ve))
			or (c.subject_kind = 'union' and c.subject_id in (select u.id from unions u where u.tree_id = ${treeId}) and c.subject_id not in (select id from hu))
			or (c.subject_kind = 'parent_child' and c.subject_id in (select id from vl)))),
		vs(id) as (select s.id from sources s where s.tree_id = ${treeId} and (${isOwn('s')}s.id in (select vsc.source_id from citations vsc where vsc.tree_id = ${treeId} and vsc.source_id is not null and vsc.id in (select id from vc)))),
		vr(id) as (select r.id from repositories r where r.tree_id = ${treeId} and (${isOwn('r')}r.id in (select vl2.repository_id from source_repositories vl2 where vl2.repository_id is not null and vl2.source_id in (select id from vs)))),
		vo(id) as (select n.id from notes n where n.tree_id = ${treeId}${oneNote('n.id')} and (${isOwn('n')}n.id in (select na.note_id from note_attachments na where na.tree_id = ${treeId} and na.note_id is not null${oneNote('na.note_id')} and ${isNoteAttachmentVisibleOf('na', treeId)}))) `;
}

/**
 * ` and <visible>` for a note attachment row (aliased `alias`): its subject is one the viewer may
 * see. The SQL form of the attachment filter in `visibleEvidence`, held to the same answers by a
 * test. A note on a citation is as visible as the citation, and a note on a source or a repository
 * as visible as that record is to this viewer. The statement must start with `withVisibleNoteScope`.
 */
function isNoteAttachmentVisibleOf(alias: string, treeId: string): SQL {
	const a = ident(alias);
	return sql`(case ${a}.subject_kind
		when 'person' then ${a}.subject_id in (select id from vp)
		when 'name' then ${a}.subject_id in (select id from vn)
		when 'event' then ${a}.subject_id in (select id from ve)
		when 'union' then ${a}.subject_id in (select u.id from unions u where u.tree_id = ${treeId}) and ${a}.subject_id not in (select id from hu)
		when 'parent_child' then ${a}.subject_id in (select id from vl)
		when 'citation' then ${a}.subject_id in (select id from vc)
		when 'source' then ${a}.subject_id in (select id from vs)
		when 'repository' then ${a}.subject_id in (select id from vr)
		else 0
	end)`;
}

/** ` and <visible>` for an attachment row; empty for a viewer who sees everyone. */
export function andNoteAttachmentVisible(alias: string, scope: Scope, treeId: string): SQL {
	return scope.isRestricted ? sql` and ${isNoteAttachmentVisibleOf(alias, treeId)}` : sql``;
}

/**
 * ` and <visible>` for a shared note row (aliased `alias`): a visible attachment uses it, or the
 * viewer made it; otherwise it is as absent as a private person (ADR-029). Empty for a viewer who
 * sees everyone. The statement must start with `withVisibleNoteScope`.
 */
export function andNoteVisible(alias: string, scope: Scope): SQL {
	return scope.isRestricted ? sql` and ${ident(alias)}.id in (select id from vo)` : sql``;
}

/**
 * ` and <visible>` for a research task row (aliased `alias`): it is about no record, or about one
 * the viewer may see (ADR-029). A record that is not there at all hides nothing, as in the row
 * filter. Empty for a viewer who sees everyone.
 *
 * A person, a fact and a partnership are tested by looking up that one record and its people, task
 * by task, because a list of tasks is short and the visible sets of a whole tree are not: through
 * the named sets the same list read about a hundred and twenty thousand rows for twenty-six tasks.
 * A source and a shared note are visible through the sets (`withVisibleNoteScope`, which the
 * statement must start with); those are read only when a task about one is met.
 */
export function andTaskVisible(alias: string, scope: Scope, treeId: string): SQL {
	if (!scope.isRestricted) return sql``;
	const t = ident(alias);
	const hiddenPerson = (id: SQL) =>
		sql`exists (select 1 from individuals hp where hp.id = ${id} and not ${isVisibleSql('hp', scope)})`;
	const hiddenPartner = (unionId: SQL) =>
		sql`exists (select 1 from union_partners hup join individuals hpp on hpp.id = hup.person_id where hup.union_id = ${unionId} and not ${isVisibleSql('hpp', scope)})`;
	return sql` and (${t}.subject_kind is null or (case ${t}.subject_kind
		when 'person' then not ${hiddenPerson(sql`${t}.subject_id`)}
		when 'union' then not ${hiddenPartner(sql`${t}.subject_id`)}
		when 'event' then not exists (select 1 from events he where he.id = ${t}.subject_id and he.tree_id = ${treeId} and (
			(he.entity_type = 'INDIVIDUAL' and ${hiddenPerson(sql`he.entity_id`)})
			or (he.entity_type = 'FAMILY' and ${hiddenPartner(sql`he.entity_id`)})))
		when 'source' then ${t}.subject_id in (select id from vs)
		when 'note' then ${t}.subject_id in (select id from vo)
		else 0
	end))`;
}
