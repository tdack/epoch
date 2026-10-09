/**
 * The whole tree as a window: every person the viewer may see, up to {@link MAX_WHOLE_TREE_PEOPLE}.
 * This is the one bounded exception to "nothing loads a whole tree" (ADR-035): a viewer asks for
 * it by name, and the cap keeps one request from reading a tree of any size.
 *
 * It is the focus window's machinery pointed at everyone instead of at a neighbourhood: the same
 * `WindowState` and `loadNeighbourhood`, so the privacy mask is applied exactly as it is there and
 * a private person is only ever a placeholder or absent. People are loaded a page at a time in
 * insertion order, and loading stops as soon as the viewer can see more than the cap.
 *
 * `isTruncated` says the viewer could see more people than were returned. It is computed from
 * people the viewer may see only: a tree of 2,999 visible and five private people is not truncated,
 * because saying so would tell a restricted viewer that someone they cannot see exists.
 */

import type { RelationshipGraph } from '../../shared/relationship-graph';
import type { GraphWindowRepository } from '../repositories/graph-window-repository';
import { loadNeighbourhood, WindowState, type WindowPrivacy } from './focus-window';

/** The most people one whole-tree read returns. */
const MAX_WHOLE_TREE_PEOPLE = 3000;

/** People loaded per round; a few queries each, so a full tree is a few dozen round trips. */
const PAGE_PEOPLE = 250;

export interface WholeTreeWindow {
	graph: RelationshipGraph;
	/** The people the graph holds completely: the ones to draw. */
	personIds: string[];
	/** The viewer could see more people than the cap allowed. */
	isTruncated: boolean;
}

export async function loadWholeTreeWindow(
	repo: GraphWindowRepository,
	treeId: string,
	privacy?: WindowPrivacy,
	cap = MAX_WHOLE_TREE_PEOPLE
): Promise<WholeTreeWindow> {
	const state = new WindowState(privacy);
	const rankOf = new Map<string, number>();
	let after = 0;
	let isExhausted = false;
	let visible: string[] = [];

	while (!isExhausted && visible.length <= cap) {
		const page = await repo.personIdsAfter(treeId, after, PAGE_PEOPLE);
		if (page.length < PAGE_PEOPLE) isExhausted = true;
		if (page.length === 0) break;
		after = page[page.length - 1].rid;
		page.forEach((p, i) => rankOf.set(p.id, rankOf.size + i));
		await loadNeighbourhood(
			state,
			repo,
			treeId,
			page.map((p) => p.id)
		);
		// What the viewer can see so far: people the masked graph still holds, completely loaded.
		visible = state
			.graph()
			.people.filter((p) => state.complete.has(p.id))
			.map((p) => p.id);
	}

	const inOrder = visible.sort((a, b) => rankOf.get(a)! - rankOf.get(b)!);
	const isTruncated = inOrder.length > cap;
	const kept = new Set(inOrder.slice(0, cap));
	// Anyone beyond the cap was loaded whole but is not drawn; as a neighbour they stay named only.
	for (const id of [...state.complete]) if (!kept.has(id)) state.complete.delete(id);
	return { graph: state.graph(), personIds: [...kept], isTruncated };
}
