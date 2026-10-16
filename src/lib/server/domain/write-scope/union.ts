import { seedOf } from '../write-scope';
import type { ScopeTable } from './types';

/**
 * Seeds for partnerships and parent-child links (ADR-055).
 *
 * Left whole-tree, on purpose:
 * - `merge_unions`: rare, and it moves events, citations and files between partnerships.
 *
 * The kinds below name only the people and partnerships in the command. The closure brings each
 * person's names (what `relinkNames` rewrites), events, files and links, every partner, their
 * partnerships, and everything attached, so no kind needs an extra record named. The one
 * exception is `assert_parent_child`: the cycle check in `validateParentChildAssertion` walks every
 * link, so it reads `parent_child` whole. Those links' far ends are not loaded, which is safe
 * because the check reads only the link rows.
 */
/**
 * `update_union`, `end_union` and `destroy_union` name only a partnership, and the labeller numbers
 * it among the partnerships of the same pair ("2nd of 2"). Those twins are partnerships of its
 * partners, which no seed can name, so these opt into the follow-up load (`follow-up.ts`).
 */
export const UNION_SCOPES: ScopeTable = {
	update_union: (c) => seedOf({ unions: [c.unionId], shouldFollowFamily: true }),
	end_union: (c) => seedOf({ unions: [c.unionId], shouldFollowFamily: true }),
	destroy_union: (c) => seedOf({ unions: [c.unionId], shouldFollowFamily: true }),
	create_union: (c) => seedOf({ people: c.personIds }),
	add_partner_to_union: (c) => seedOf({ unions: [c.unionId], people: [c.personId] }),
	remove_partner_from_union: (c) => seedOf({ unions: [c.unionId], people: [c.personId] }),
	assert_parent_child: (c) =>
		seedOf({
			people: [c.parentId, c.childId],
			unions: [c.unionId],
			wholeTables: ['parentChild']
		}),
	remove_parent_child: (c) => seedOf({ people: [c.parentId, c.childId] }),
	change_parent_child_type: (c) => seedOf({ people: [c.parentId, c.childId] })
};
