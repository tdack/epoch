/**
 * Who is in a sub-tree rooted at one person (docs/proposal-subtrees.md), as a SQL predicate in the
 * style of `visibility.ts`: it sits beside `tree_id` and is ANDed with `andVisible`, so totals,
 * `hasMore`, page fill and ordering are all computed in scope, never by filtering a finished page.
 *
 * Members are the root, every child of a member through `parent_child` of any type whose status is
 * not 'disputed', and every partner of any of those. The recursion runs over descent only: a
 * partner is added once, after it, so a partner's own parents and kin are not pulled in.
 *
 * `UNION`, not `UNION ALL`, so a cycle in bad data ends (a row already seen is not new). Membership
 * is computed rather than stored (a stored table would be rebuilt by every parent link, partnership
 * and person change); one recursive read over `idx_parent_child_parent` and the union-partner
 * indexes costs a scoped read of a tree this size one extra lookup per member.
 *
 * Two planner nudges, both checked by the plan test: `cross join` fixes the join order so each
 * member is looked up in the index (left alone, SQLite scans the whole partner table and builds an
 * automatic index), and the unary plus on `tree_id` keeps `idx_parent_child_tree` from beating
 * `idx_parent_child_parent`, which would read every link of the tree at each step.
 *
 * It binds the tree id and the root id, once each. The tree id is checked on the links only; the
 * caller's own `tree_id` test on the outer row covers everything else, so a root that belongs to
 * another tree selects no one here.
 */

import { sql, type SQL } from 'drizzle-orm';
import { ident } from './visibility';

/** ` and <alias>.id in (<members>)` for a row of `individuals` aliased `alias`. */
export function inSubtree(alias: string, treeId: string, rootPersonId: string): SQL {
	return sql` and ${ident(alias)}.id in (${subtreeMembersSql(treeId, rootPersonId)})`;
}

/** The members' ids as a self-contained select, for a caller that composes it itself. */
function subtreeMembersSql(treeId: string, rootPersonId: string): SQL {
	return sql`with recursive line(id) as (
			select ${rootPersonId}
			union
			select pc.child_id from line l cross join parent_child pc on pc.parent_id = l.id
				where +pc.tree_id = ${treeId} and pc.status != 'disputed'
		)
		select id from line
		union
		select mate.person_id from line l
			cross join union_partners own on own.person_id = l.id
			cross join union_partners mate on mate.union_id = own.union_id`;
}
