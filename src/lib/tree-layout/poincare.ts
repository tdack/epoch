/**
 * The Ball view: a unit ball with calendar time for height. A stub for now: it draws the same people as every view
 * (`selectFocusSubgraph`) in a row per generation, so the page, the switcher and the canvas can be
 * wired before the real layout lands. Pure: the WebGL scene turns these positions into meshes.
 */

import { buildIndex, type GraphIndex } from './graph-index.js';
import { selectFocusSubgraph } from './select.js';
import type {
	Band,
	FocusViewOptions,
	RelationshipGraph,
	RelationshipGraphPerson
} from './types.js';

/** Distance between neighbours in a row, and between rows, in scene units. */
const SLOT_UNITS = 2;
const ROW_UNITS = 6;

interface PoincarePerson {
	id: string;
	/** Rows relative to the focus: negative above, positive below. */
	generation: number;
	band: Band;
	/** Scene units. */
	x: number;
	y: number;
	z: number;
	person: RelationshipGraphPerson;
}

export interface PoincareLayout {
	focusPersonId: string;
	people: PoincarePerson[];
	/** The partners of each drawn union, for the focus line's walk. */
	unions: Array<{ id: string; partnerIds: string[] }>;
	/** The lines up to parents, for the focus line's walk. */
	childLinks: Array<{ childId: string; parentIds: string[] }>;
}

const EMPTY_POINCARE_LAYOUT: PoincareLayout = {
	focusPersonId: '',
	people: [],
	unions: [],
	childLinks: []
};

/**
 * Lay out Ball around `focusPersonId`. Returns the empty layout when the person is not in the
 * graph.
 */
export function layoutPoincare(
	graph: RelationshipGraph,
	focusPersonId: string | null | undefined,
	options: FocusViewOptions = {},
	index: GraphIndex = buildIndex(graph)
): PoincareLayout {
	if (!focusPersonId) return EMPTY_POINCARE_LAYOUT;
	const selection = selectFocusSubgraph(graph, focusPersonId, options, index);
	if (!selection) return EMPTY_POINCARE_LAYOUT;

	const seenInRow = new Map<number, number>();
	const people = selection.people.map((p) => {
		const column = seenInRow.get(p.generation) ?? 0;
		seenInRow.set(p.generation, column + 1);
		return {
			id: p.id,
			generation: p.generation,
			band: p.band,
			x: column * SLOT_UNITS,
			y: p.generation * ROW_UNITS,
			z: 0,
			person: index.personById.get(p.id)!
		};
	});
	return { focusPersonId, people, unions: [], childLinks: [] };
}
