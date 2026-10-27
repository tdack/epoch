/**
 * Research gaps read off a pedigree (reports plan, stage 8): how full each generation is, and the
 * brick walls, the ancestors whose parents are not recorded. Pure, over the chart's own slots, so it
 * shows only what the chart would show the same viewer.
 */

import type { ChartPerson, PedigreeDto } from './charts';

export interface GenerationCompleteness {
	/** 1 for the person; the person's parents are 2. */
	generation: number;
	/** Slots in this generation: 2 to the power of (generation − 1). */
	possible: number;
	/** Slots filled, a person who appears twice counted twice. */
	found: number;
	/** Different people found, which is less than `found` where the pedigree folds back. */
	distinct: number;
}

export interface BrickWall {
	person: ChartPerson;
	/** The person's Ahnentafel number: 1 for the subject, 2 and 3 for their parents. */
	number: number;
	generation: number;
	/** 1 when one parent is recorded and the other is not, 2 when neither is. */
	missingParents: 1 | 2;
}

const generationOf = (index: number) => Math.floor(Math.log2(index + 1)) + 1;

export function completeness(pedigree: PedigreeDto): GenerationCompleteness[] {
	return Array.from({ length: pedigree.generations }, (_, g) => {
		const start = 2 ** g - 1;
		const row = pedigree.slots.slice(start, start * 2 + 1).filter((p) => p !== null);
		return {
			generation: g + 1,
			possible: 2 ** g,
			found: row.length,
			distinct: new Set(row.map((p) => p.id)).size
		};
	});
}

/**
 * Below the top generation drawn, where whether parents exist is known. A placeholder is skipped:
 * its parents may be recorded and hidden, and saying "missing" would be a guess about a private
 * person. A person who fills several slots is listed once, at their lowest number.
 */
export function brickWalls(pedigree: PedigreeDto): BrickWall[] {
	const seen = new Set<string>();
	const walls: BrickWall[] = [];
	pedigree.slots.forEach((person, index) => {
		const generation = generationOf(index);
		if (!person || person.isPrivate || generation >= pedigree.generations || seen.has(person.id))
			return;
		seen.add(person.id);
		const missing = Number(!pedigree.slots[2 * index + 1]) + Number(!pedigree.slots[2 * index + 2]);
		if (missing > 0)
			walls.push({ person, number: index + 1, generation, missingParents: missing as 1 | 2 });
	});
	return walls;
}
