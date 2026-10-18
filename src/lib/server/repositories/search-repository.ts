/**
 * Read-side search over one tree. Ranking happens in SQL, before LIMIT: a capped candidate set
 * ranked afterwards would drop the exact match for a short query like "a".
 *
 * Every stored name is a candidate, and so is the person's own given name and surname (the display
 * name), because a person created before S6 has no name row and a stale row must not hide the name
 * the page shows. A person's rank is their best candidate's, so a person is listed once, by the
 * name that explains the hit.
 *
 * The tree scope is a plain `tree_id = ?`, not the `+tree_id` of the id-list reads in ADR-011: the
 * other filter here is a `LIKE`, which cannot drive an index, so the tree index is what bounds the
 * work to one tree (see query-plans.md).
 */

import { sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { dateBound, foldQuery } from '../../shared/search';
import type { ViewerScope } from '../services/tree-access';
import { andInLens } from './subtree-membership';
import { andVisible, isVisibleOf } from './visibility';

type Scope = Pick<ViewerScope, 'isRestricted' | 'cutoff' | 'creatorId'>;

export interface SearchHit {
	personId: string;
	/** The name row that matched best; null when the person's own name fields did (or no words were given). */
	nameId: string | null;
}

export interface SearchFilters {
	words: string[];
	place: string;
	from: string;
	to: string;
	limit: number;
	offset: number;
}

export interface FactHit {
	factId: string;
	personId: string;
	type: string;
	place: string | null;
	dateRaw: string | null;
	isPartnershipFact: boolean;
}

const escapeLike = (word: string) => word.replace(/[%_\\]/g, (c) => `\\${c}`);
const like = (column: SQL, pattern: string) => sql`${column} like ${pattern} escape '\\'`;

/** Lower-cased "prefix given nickname surname-prefix surname suffix", single-spaced, for matching. */
const NAME_HAY = sql.raw(
	`lower(rtrim(coalesce(n.name_prefix || ' ', '') || coalesce(n.given_name || ' ', '') || coalesce(n.nickname || ' ', '') || coalesce(n.surname_prefix || ' ', '') || coalesce(n.surname || ' ', '') || coalesce(n.name_suffix, '')))`
);
const OWN_HAY = sql.raw(
	`lower(rtrim(coalesce(i.given_name || ' ', '') || coalesce(i.surname, '')))`
);

/**
 * A fact of the person's own, or of a partnership they are in, that has this place and overlaps
 * these dates. Place and dates must hold on the same fact: "born in Cork between 1850 and 1860"
 * is not "born in Cork" and "died in 1855". An undated fact (both bounds null) never overlaps:
 * null on one side means unbounded there (`BEF 1900`), not unknown.
 */
function factCondition(place: string, from: string, to: string): SQL {
	const parts: SQL[] = [];
	if (place) parts.push(like(sql.raw('e.place'), `%${escapeLike(place.toLowerCase())}%`));
	const start = dateBound(from, 'start');
	const end = dateBound(to, 'end');
	if (start || end) {
		parts.push(sql`(e.date_sort is not null or e.date_sort_end is not null)`);
		if (start) parts.push(sql`(e.date_sort_end is null or e.date_sort_end >= ${start})`);
		if (end) parts.push(sql`(e.date_sort is null or e.date_sort <= ${end})`);
	}
	return sql.join(parts, sql` and `);
}

/**
 * A partnership's own facts (a marriage date and place) are facts about every partner, so a restricted
 * viewer may match on them only when every partner is visible (ADR-015); otherwise a search for the
 * year of a private couple's wedding would find the visible one and name the date.
 */
function allPartnersVisible(unionColumn: SQL, scope: Scope): SQL {
	return scope.isRestricted
		? sql` and not exists (select 1 from union_partners other join individuals p on p.id = other.person_id where other.union_id = ${unionColumn} and not ${isVisibleOf('p', scope)})`
		: sql``;
}

/** The index tokenizes by trigram, which cannot match fewer than three characters. */
const isIndexable = (word: string) => [...foldQuery(word)].length >= 3;

/**
 * The MATCH for name_fts. The tree is a column of the index and is named in the match, because a
 * filter applied after the match reads every tree's hits for the word first (436 rows for "ann" in
 * the small tree, against 27; query-plans.md). Each word is its own column filter, so all of them
 * must appear in one name. Phrases are quoted, so a word's punctuation cannot be read as syntax.
 */
function nameMatch(treeId: string, words: string[]): string {
	const phrase = (text: string) => `"${text.replace(/"/g, '""')}"`;
	return [
		`tree_id : ${phrase(treeId)}`,
		...words.map((w) => `name : ${phrase(foldQuery(w))}`)
	].join(' AND ');
}

const hasFactFilter = (f: SearchFilters) =>
	Boolean(f.place || dateBound(f.from, 'start') || dateBound(f.to, 'end'));

/** The stored forms an XREF typed as `I4`, `i4` or `@I4@` could take. */
export function xrefCandidates(text: string): string[] {
	const bare = text.trim().replace(/^@|@$/g, '');
	if (!/^[\w.:-]{1,40}$/.test(bare)) return [];
	// The index is case-sensitive and so are XREFs, but nobody types "i4" meaning anything else.
	return [...new Set([bare, bare.toUpperCase()].flatMap((c) => [c, `@${c}@`]))];
}

export class SearchRepository {
	constructor(private db: DbClient) {}

	xrefSql(
		treeId: string,
		candidates: string[],
		scope: Scope,
		lensRootId: string | null = null
	): SQL {
		// Named, because SQLite picks the tree index when both can serve and then reads the whole tree.
		return sql`select i.id as id from individuals i indexed by idx_ind_xref where i.tree_id = ${treeId} and i.xref_id in (${sql.join(
			candidates.map((c) => sql`${c}`),
			sql`, `
		)})${andVisible('i', scope)}${andInLens('i', treeId, lensRootId)} order by i.rowid`;
	}

	/** People whose XREF is exactly this, with or without the `@`s (the importer stores them with). */
	async byXref(
		treeId: string,
		text: string,
		scope: Scope,
		lensRootId: string | null = null
	): Promise<string[]> {
		const candidates = xrefCandidates(text);
		if (candidates.length === 0) return [];
		return (
			await this.db.all<{ id: string }>(this.xrefSql(treeId, candidates, scope, lensRootId))
		).map((r) => r.id);
	}

	async find(
		treeId: string,
		filters: SearchFilters,
		scope: Scope,
		lensRootId: string | null = null
	): Promise<{ hits: SearchHit[]; hasMore: boolean }> {
		const rows = await this.db.all<{ id: string; name_id: string | null }>(
			this.findSql(treeId, filters, scope, lensRootId)
		);
		return {
			hits: rows.slice(0, filters.limit).map((r) => ({ personId: r.id, nameId: r.name_id })),
			hasMore: rows.length > filters.limit
		};
	}

	/** The search statement, unrun: the plan test measures exactly what `find` sends. */
	findSql(
		treeId: string,
		filters: SearchFilters,
		scope: Scope,
		lensRootId: string | null = null
	): SQL {
		// Beside tree_id and the visibility predicate, so the page fills and hasMore are in scope.
		const lens = andInLens('i', treeId, lensRootId);
		const { words, limit, offset } = filters;
		const factFilter = hasFactFilter(filters)
			? sql` and (exists (select 1 from events e where e.entity_type = 'INDIVIDUAL' and e.entity_id = i.id and ${factCondition(filters.place, filters.from, filters.to)})
				or exists (select 1 from union_partners up where up.person_id = i.id and exists (select 1 from events e where e.entity_type = 'FAMILY' and e.entity_id = up.union_id and ${factCondition(filters.place, filters.from, filters.to)})${allPartnersVisible(sql`up.union_id`, scope)}))`
			: sql``;
		// One more than asked for, so the caller can say whether there is another page.
		const page = sql`limit ${limit + 1} offset ${offset}`;
		return words.length === 0
			? sql`
				select i.id as id, null as name_id from individuals i
				where i.tree_id = ${treeId}${factFilter}${andVisible('i', scope)}${lens}
				order by lower(i.surname), lower(i.given_name), i.id ${page}`
			: this.rankedNames(treeId, words, sql`${factFilter}${andVisible('i', scope)}${lens}`, page);
	}

	private rankedNames(treeId: string, words: string[], factFilter: SQL, page: SQL): SQL {
		// The levels score the words as typed, not folded: a folded word would no longer match a stored
		// "müller", and that exact match works today. A name that only the fold finds ranks as "contains".
		const whole = words.join(' ');
		const all = (make: (word: string) => SQL) => sql.join(words.map(make), sql` and `);
		// A word the index can match (three code points, the trigram minimum) is matched there, folded,
		// and every such word must be in the same name. The rest are checked with LIKE on the name, as
		// before. With no matchable word the index has nothing to offer and the scan of names is kept.
		const indexed = words.filter((w) => isIndexable(w));
		const unindexed = words.filter((w) => !isIndexable(w));
		const candidates =
			indexed.length === 0
				? sql`
					select i.id as person_id, null as name_id, 0 as tie, ${OWN_HAY} as hay
					from individuals i where i.tree_id = ${treeId}
					union all
					select n.person_id, n.id, case when n.is_preferred = 1 then 1 else 2 + min(n."order", 100) end, ${NAME_HAY}
					from person_names n join individuals i on i.id = n.person_id where i.tree_id = ${treeId}`
				: sql`
					select name_fts.person_id as person_id, name_fts.name_id as name_id,
						case when name_fts.name_id is null then 0 when n.is_preferred = 1 then 1 else 2 + min(n."order", 100) end as tie,
						lower(name_fts.name) as hay
					from name_fts left join person_names n on n.id = name_fts.name_id
					where name_fts match ${nameMatch(treeId, indexed)}`;
		const filtered = indexed.length === 0 ? words : unindexed;
		// Levels: exact name, every word is a whole word, name starts with the query, every word
		// starts a word, every word appears anywhere. Whole words outrank a prefix so that "Fox"
		// finds Ann Smith before Smithson Ann. The tie term prefers the name the person is
		// shown by, then the preferred stored name, then the others in their order.
		return sql`
			with cand as (${candidates}), scored as (
				select person_id, name_id,
					case
						when hay = ${whole} then 0
						when ${all((w) => like(sql.raw(`(' ' || hay || ' ')`), `% ${escapeLike(w)} %`))} then 1
						when ${like(sql.raw('hay'), `${escapeLike(whole)}%`)} then 2
						when ${all((w) => like(sql.raw(`(' ' || hay)`), `% ${escapeLike(w)}%`))} then 3
						else 4
					end * 1000 + tie as rank_key
				from cand where ${
					filtered.length === 0
						? sql`1 = 1`
						: sql.join(
								filtered.map((w) => like(sql.raw('hay'), `%${escapeLike(w)}%`)),
								sql` and `
							)
				}
			), best as (
				select person_id, name_id, min(rank_key) as rank_key from scored group by person_id
			)
			select i.id as id, best.name_id as name_id
			from best join individuals i on i.id = best.person_id
			-- The unary + keeps the plan on the primary key. The trigram tree term in the index is a
			-- substring match, so this exact check is what makes the tree scope safe.
			where +i.tree_id = ${treeId}${factFilter}
			order by best.rank_key, lower(i.surname), lower(i.given_name), i.id ${page}`;
	}

	/** The facts that made these people match the place and date filter, for saying why. */
	async factsMatching(
		personIds: string[],
		place: string,
		from: string,
		to: string,
		scope: Scope
	): Promise<FactHit[]> {
		if (
			personIds.length === 0 ||
			!hasFactFilter({ words: [], place, from, to, limit: 0, offset: 0 })
		)
			return [];
		const ids = sql.join(
			personIds.map((id) => sql`${id}`),
			sql`, `
		);
		const condition = factCondition(place, from, to);
		const rows = await this.db.all<{
			fact_id: string;
			person_id: string;
			type: string;
			place: string | null;
			date_raw: string | null;
			is_partnership: number;
		}>(sql`
			select e.id as fact_id, e.entity_id as person_id, e.type, e.place, e.date_raw, 0 as is_partnership
			from events e where e.entity_type = 'INDIVIDUAL' and e.entity_id in (${ids}) and ${condition}
			union all
			select e.id, up.person_id, e.type, e.place, e.date_raw, 1
			from union_partners up join events e on e.entity_type = 'FAMILY' and e.entity_id = up.union_id
			where up.person_id in (${ids}) and ${condition}${allPartnersVisible(sql`up.union_id`, scope)}`);
		return rows.map((r) => ({
			factId: r.fact_id,
			personId: r.person_id,
			type: r.type,
			place: r.place,
			dateRaw: r.date_raw,
			isPartnershipFact: r.is_partnership === 1
		}));
	}
}
