import { describe, expect, it } from 'vitest';
import {
	DESCENDANT_NUMBERINGS,
	DESCENDANT_NUMBERING_LABELS,
	descendantNumber,
	type DescendantNumbering
} from './descendant-numbers';

const { DABOVILLE, HENRY } = DESCENDANT_NUMBERINGS;

type Case = {
	name: string;
	path: number[];
	numbering: DescendantNumbering;
	expected: string;
};

const CASES: Case[] = [
	{ name: 'root', path: [], numbering: DABOVILLE, expected: '1' },
	{ name: 'root', path: [], numbering: HENRY, expected: '1' },
	{ name: 'first child', path: [1], numbering: DABOVILLE, expected: '1.1' },
	{ name: 'first child', path: [1], numbering: HENRY, expected: '11' },
	{ name: 'second child', path: [2], numbering: DABOVILLE, expected: '1.2' },
	{ name: 'second child', path: [2], numbering: HENRY, expected: '12' },
	{ name: 'grandchild', path: [2, 1], numbering: DABOVILLE, expected: '1.2.1' },
	{ name: 'grandchild', path: [2, 1], numbering: HENRY, expected: '121' },
	{ name: 'ninth child', path: [9], numbering: DABOVILLE, expected: '1.9' },
	{ name: 'ninth child', path: [9], numbering: HENRY, expected: '19' },
	{ name: 'tenth child', path: [10], numbering: DABOVILLE, expected: '1.10' },
	{ name: 'tenth child', path: [10], numbering: HENRY, expected: '1(10)' },
	{ name: 'twelfth child', path: [12], numbering: DABOVILLE, expected: '1.12' },
	{ name: 'twelfth child', path: [12], numbering: HENRY, expected: '1(12)' },
	{ name: 'tenth child of second child', path: [2, 10], numbering: DABOVILLE, expected: '1.2.10' },
	{ name: 'tenth child of second child', path: [2, 10], numbering: HENRY, expected: '12(10)' },
	{ name: 'first child of tenth child', path: [2, 10, 1], numbering: HENRY, expected: '12(10)1' },
	{ name: 'deep path', path: [1, 2, 3, 4], numbering: DABOVILLE, expected: '1.1.2.3.4' },
	{ name: 'deep path', path: [1, 2, 3, 4], numbering: HENRY, expected: '11234' },
	{
		name: 'deep path with two-digit indexes',
		path: [2, 10, 3, 12],
		numbering: DABOVILLE,
		expected: '1.2.10.3.12'
	},
	{
		name: 'deep path with two-digit indexes',
		path: [2, 10, 3, 12],
		numbering: HENRY,
		expected: '12(10)3(12)'
	}
];

describe('descendantNumber', () => {
	it.each(CASES)('$name in $numbering is $expected', ({ path, numbering, expected }) => {
		expect(descendantNumber(path, numbering)).toBe(expected);
	});

	it.each([0, -1, 1.5])('rejects child index %s', (index) => {
		expect(() => descendantNumber([2, index], DABOVILLE)).toThrow(RangeError);
		expect(() => descendantNumber([2, index], HENRY)).toThrow(RangeError);
	});
});

describe('DESCENDANT_NUMBERING_LABELS', () => {
	it.each([
		[DABOVILLE, "d'Aboville (1.2.1)"],
		[HENRY, 'Henry (121)']
	])('labels %s', (numbering, label) => {
		expect(DESCENDANT_NUMBERING_LABELS[numbering]).toBe(label);
	});
});
