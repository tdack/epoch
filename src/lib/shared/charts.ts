/** What the pedigree and descendant charts are drawn from. */

export interface ChartPerson {
	id: string;
	name: string;
	/** A placeholder for someone the viewer may not see: no name, nothing to open. */
	isPrivate: boolean;
	/** The original text of the first birth and death dates, when recorded. */
	birth: string | null;
	death: string | null;
}

/** Generations drawn, the person included; the default and the most a chart will draw. */
export const DEFAULT_CHART_GENERATIONS = 4;
export const MAX_PEDIGREE_GENERATIONS = 8;
export const MAX_DESCENDANT_GENERATIONS = 8;

export interface PedigreeDto {
	person: ChartPerson;
	/** Generations asked for, the person's own included. */
	generations: number;
	/**
	 * The ancestors in heap order: index 0 is the person, then each person's parents at 2i+1 and
	 * 2i+2. A slot is null when nobody is recorded (or visible) there. The same person can fill
	 * more than one slot when a pedigree folds back on itself.
	 */
	slots: Array<ChartPerson | null>;
	/** True when there are more ancestors above the last generation drawn. */
	hasMoreAbove: boolean;
}

export interface DescendantNode {
	person: ChartPerson;
	/** Partners in any partnership of this person, for the card. */
	partners: ChartPerson[];
	children: DescendantNode[];
}

export interface DescendantsDto {
	root: DescendantNode;
	generations: number;
	/** True when there are more descendants below the last generation drawn, or the load hit its size limit. */
	hasMoreBelow: boolean;
}

/** The ways a person's family can be drawn, in the order the style links list them. */
export const CHART_STYLES = [
	{ id: 'pedigree', label: 'Ancestors', path: 'pedigree' },
	{ id: 'fan', label: 'Fan', path: 'fan' },
	{ id: 'descendants', label: 'Descendants', path: 'descendants' },
	{ id: 'hourglass', label: 'Hourglass', path: 'hourglass' }
] as const;
export type ChartStyle = (typeof CHART_STYLES)[number]['id'];

/** Each side of an hourglass: both halves are drawn on one canvas, so each stops sooner. */
export const MAX_HOURGLASS_GENERATIONS = 6;

/**
 * The address of a person's chart in a style. A style that has no such depth (the hourglass has
 * two) takes the same number for both of its halves, so moving between styles keeps the depth.
 */
export function chartAddress(
	treeId: string,
	personId: string,
	style: ChartStyle,
	generations: number
): string {
	const base = `/trees/${encodeURIComponent(treeId)}/people/${encodeURIComponent(personId)}/${style}`;
	return style === 'hourglass'
		? `${base}?up=${generations}&down=${generations}`
		: `${base}?generations=${generations}`;
}
