import { describe, expect, it } from 'vitest';
import type { ChartPerson, PedigreeDto } from './charts';
import { brickWalls, completeness } from './pedigree-stats';

const p = (id: string, isPrivate = false): ChartPerson => ({
	id,
	name: id,
	isPrivate,
	birth: null,
	death: null
});
const pedigree = (slots: Array<ChartPerson | null>, generations: number): PedigreeDto => ({
	person: slots[0]!,
	generations,
	slots,
	hasMoreAbove: false
});

describe('completeness', () => {
	it('counts each generation against the slots it could fill, and folds repeats', () => {
		const shared = p('gg');
		// me; mum, dad; mum's parents (gg, null), dad's parents (gg, x)
		const stats = completeness(
			pedigree([p('me'), p('mum'), p('dad'), shared, null, shared, p('x')], 3)
		);
		expect(stats).toEqual([
			{ generation: 1, possible: 1, found: 1, distinct: 1 },
			{ generation: 2, possible: 2, found: 2, distinct: 2 },
			{ generation: 3, possible: 4, found: 3, distinct: 2 }
		]);
	});
});

describe('brickWalls', () => {
	it('finds people with one or both parents missing, below the top generation only', () => {
		const walls = brickWalls(pedigree([p('me'), p('mum'), null, p('a'), null, null, null], 3));
		expect(walls.map((w) => [w.person.id, w.number, w.missingParents])).toEqual([
			['me', 1, 1],
			['mum', 2, 1]
		]);
	});
	it('says nothing about a private person, and lists a repeated person once', () => {
		const shared = p('s');
		const walls = brickWalls(pedigree([p('me'), shared, shared, null, null, null, null], 3));
		expect(walls.map((w) => [w.person.id, w.number])).toEqual([['s', 2]]);
		expect(brickWalls(pedigree([p('me'), p('h', true), p('d')], 2))).toEqual([]);
		expect(brickWalls(pedigree([p('me'), p('h', true), null, null, null, null, null], 3))).toEqual([
			expect.objectContaining({ number: 1, missingParents: 1 })
		]);
	});
});
