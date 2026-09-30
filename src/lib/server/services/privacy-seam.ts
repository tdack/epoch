/**
 * The one place a Phase 4 privacy filter attaches to everything a search or a list returns.
 * Phase 4 has not landed, so nothing is private and this passes everything through; the point is
 * that search, lists and the people in recents and favourites all route through it, so a policy
 * written later changes here rather than in five services.
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
