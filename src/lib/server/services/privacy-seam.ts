/**
 * The one place a Phase 4 privacy filter attaches to everything a search or a list returns.
 * Phase 4 has not landed, so nothing is private and this passes everything through; the point is
 * that search, lists and the people in recents and favourites all route through it, so a policy
 * written later changes here rather than in five services.
 *
 * **Limit of this seam:** it runs after SQL has chosen the page, so a Phase 4 filter written here can
 * mask or drop rows but cannot correct `hasMore`, how full a page is, or a surname's count. The real
 * filter has to move into the queries (a visibility predicate beside `tree_id`); this seam is where
 * DTOs are shaped for the viewer, not where the page is decided.
 *
 * What the filter will have to cover that a DTO's `isPrivate` does not (phase-4 "indirect
 * inference"): the `matches` text on a search result (a private person's married name or a place
 * is a leak even when the row is masked), the total and `hasMore` of a search, the counts on the
 * surname list and the partnership list's partner names, and the ordering itself.
 */

import type { AuthenticatedContext } from '../domain/identity';
import type { PrivacyFlag } from '../../shared/privacy';

export function filterForViewer<T extends PrivacyFlag>(items: readonly T[], _viewer: AuthenticatedContext): T[] {
	return [...items];
}
