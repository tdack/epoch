import { createHistoryCoalescer, type HistoryKind } from './tree-url.js';

/** One address change: `query` has no leading `?`, and may be empty for the bare path. */
interface Navigation {
	query: string;
	kind?: HistoryKind;
	isReplace?: boolean;
}

/**
 * Address changes for the tree page. `go` is the page's `goto` wrapper; it receives `?query`, or ''
 * for the bare path, and owns the `reset: false` option so scroll and focus stay put.
 */
export function createTreeNavigation(go: (href: string, isReplace: boolean) => Promise<void>) {
	const historyCoalescer = createHistoryCoalescer();
	/** The address a navigation is heading for, shown before the load commits it. */
	let pendingSearch = $state<string | null>(null);
	let isNavigating = false;
	let queuedNavigation: Navigation | null = null;

	function commit({ query, kind, isReplace }: Navigation) {
		isNavigating = true;
		void go(
			query ? `?${query}` : '',
			isReplace ?? (kind ? historyCoalescer.shouldReplace(kind) : false)
		).finally(() => {
			isNavigating = false;
			const next = queuedNavigation;
			queuedNavigation = null;
			if (next) commit(next);
			else pendingSearch = null;
		});
	}

	return {
		get pendingSearch() {
			return pendingSearch;
		},
		/**
		 * The address only changes once the new graph has loaded, so a second click straight after the
		 * first would read the old view. Show the new view at once and let the load catch up. Only one
		 * navigation runs at a time: a second would cancel the first, and "replace the last entry"
		 * would then overwrite the entry the first should have pushed. Of several queued, the last wins.
		 */
		push(navigation: Navigation) {
			pendingSearch = navigation.query ? `?${navigation.query}` : '';
			if (isNavigating) queuedNavigation = navigation;
			else commit(navigation);
		}
	};
}
