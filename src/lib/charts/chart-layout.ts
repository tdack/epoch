/**
 * Where the cards of a pedigree or a descendant chart go. Pure and plain data, so it runs in the
 * browser and in Vitest. Charts grow left to right: the person at the left, each generation one
 * column further right. Coordinates are the top-left of a card.
 */

import type { ChartPerson, DescendantNode } from '../shared/charts';

export const CARD = { width: 188, height: 48, columnGap: 36, rowGap: 10 } as const;

export interface PlacedCard {
	key: string;
	person: ChartPerson;
	partners?: ChartPerson[];
	x: number;
	y: number;
}

export interface Edge {
	from: string;
	to: string;
}

export interface ChartLayout {
	cards: PlacedCard[];
	edges: Edge[];
	width: number;
	height: number;
}

const columnX = (generation: number) => generation * (CARD.width + CARD.columnGap);

/** Heap-ordered slots on a grid 2^(n-1) rows tall: a person is centred on the rows their own ancestors span. */
export function layoutPedigree(slots: ReadonlyArray<ChartPerson | null>, generations: number): ChartLayout {
	const rowHeight = CARD.height + CARD.rowGap;
	const leafRows = 2 ** (generations - 1);
	const cards: PlacedCard[] = [];
	const edges: Edge[] = [];
	slots.forEach((person, i) => {
		if (!person) return;
		const generation = Math.floor(Math.log2(i + 1));
		const indexInGeneration = i + 1 - 2 ** generation;
		const span = leafRows / 2 ** generation;
		cards.push({ key: `s${i}`, person, x: columnX(generation), y: (indexInGeneration * span + span / 2) * rowHeight - CARD.height / 2 });
		if (i > 0) {
			const child = Math.floor((i - 1) / 2);
			if (slots[child]) edges.push({ from: `s${child}`, to: `s${i}` });
		}
	});
	return { cards, edges, width: columnX(generations - 1) + CARD.width, height: leafRows * rowHeight };
}

/** Leaves take consecutive rows; a parent is centred on its first and last child. */
export function layoutDescendants(root: DescendantNode): ChartLayout {
	const rowHeight = CARD.height + CARD.rowGap;
	const cards: PlacedCard[] = [];
	const edges: Edge[] = [];
	let nextRow = 0;
	let deepest = 0;
	let counter = 0;

	function place(node: DescendantNode, depth: number): { key: string; row: number } {
		const key = `d${counter++}`;
		deepest = Math.max(deepest, depth);
		const placed = node.children.map((child) => place(child, depth + 1));
		const row = placed.length > 0 ? (placed[0]!.row + placed[placed.length - 1]!.row) / 2 : nextRow++;
		cards.push({ key, person: node.person, partners: node.partners, x: columnX(depth), y: row * rowHeight });
		for (const child of placed) edges.push({ from: key, to: child.key });
		return { key, row };
	}
	place(root, 0);
	return { cards, edges, width: columnX(deepest) + CARD.width, height: Math.max(nextRow, 1) * rowHeight };
}
