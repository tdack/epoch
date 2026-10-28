import { describe, expect, it } from 'vitest';
import { DATE_FORMATS } from './date-display';
import {
	dateClause,
	Endnotes,
	listOf,
	narrativeOf,
	type NarrativeFact,
	type NarrativePerson
} from './narrative';

const DMY = DATE_FORMATS.DAY_MONTH_YEAR;

const fact = (type: string, extra: Partial<NarrativeFact> = {}): NarrativeFact => ({
	type,
	label: type,
	dateText: null,
	place: null,
	value: null,
	notes: [],
	...extra
});

const person = (extra: Partial<NarrativePerson> = {}): NarrativePerson => ({
	name: 'Ann Ash',
	givenName: 'Ann',
	parents: [],
	facts: [],
	partnerships: [],
	otherChildren: [],
	...extra
});

const text = (p: NarrativePerson, endnotes = new Endnotes()) =>
	narrativeOf(p, DMY, endnotes).map((s) => s.text);

describe('dateClause', () => {
	it.each([
		['3 MAR 1900', 'on 3 March 1900'],
		['MAR 1900', 'in March 1900'],
		['1900', 'in 1900'],
		['ABT 1900', 'about 1900'],
		['BEF 1900', 'before 1900'],
		['BET 1860 AND 1865', 'between 1860 and 1865'],
		['(during the war)', 'on a date given as “during the war”'],
		['sometime', 'on a date given as “sometime”'],
		[null, '']
	])('%s → %s', (raw, expected) => {
		expect(dateClause(raw, DMY)).toBe(expected);
	});

	it('follows the tree format', () => {
		expect(dateClause('3 MAR 1900', DATE_FORMATS.MONTH_DAY_YEAR)).toBe('on March 3, 1900');
	});
});

describe('listOf', () => {
	it.each([
		[[], ''],
		[['A'], 'A'],
		[['A', 'B'], 'A and B'],
		[['A', 'B', 'C'], 'A, B and C']
	])('%j', (items, expected) => {
		expect(listOf(items)).toBe(expected);
	});
});

describe('narrativeOf', () => {
	it('opens with the birth and the parents, by kind of link', () => {
		expect(
			text(
				person({
					parents: [
						{ name: 'Ben Ash', type: 'biological' },
						{ name: 'Cara Ash', type: 'biological' },
						{ name: 'Dot Lee', type: 'adoptive' }
					],
					facts: [fact('BIRT', { dateText: '3 MAR 1900', place: 'Leeds' })]
				})
			)
		).toEqual([
			'Ann Ash, child of Ben Ash and Cara Ash and adopted child of Dot Lee, was born on 3 March 1900 in Leeds.'
		]);
	});

	it('opens with a baptism when no birth is recorded, and says only the name when neither is', () => {
		expect(text(person({ facts: [fact('BAPM', { dateText: '1900' })] }))).toEqual([
			'Ann Ash was baptised in 1900.'
		]);
		expect(text(person({ parents: [{ name: 'Ben Ash', type: 'unknown' }] }))).toEqual([
			'Ann Ash, child of Ben Ash.'
		]);
	});

	it('gives later facts by given name, with an age at death', () => {
		expect(
			text(
				person({
					facts: [
						fact('BIRT', { dateText: '1900' }),
						fact('OCCU', { value: 'a weaver', dateText: '1921', place: 'Leeds' }),
						fact('RESI', { place: 'York', dateText: 'ABT 1930' }),
						fact('DEAT', { dateText: '1950', place: 'York' }),
						fact('BURI', { place: 'York Cemetery' }),
						fact('_MILT', { label: 'Military service', value: 'Navy', dateText: '1918' })
					]
				})
			)
		).toEqual([
			'Ann Ash was born in 1900.',
			'Ann worked as a weaver in 1921 in Leeds.',
			'Ann lived in York about 1930.',
			'Ann died in 1950 in York, aged 49–50.',
			'Ann was buried in York Cemetery.',
			'Ann: Military service, Navy, 1918.'
		]);
	});

	it('says a second birth is another record, not a second event', () => {
		expect(
			text(
				person({ facts: [fact('BIRT', { dateText: '1900' }), fact('BIRT', { dateText: '1901' })] })
			)
		).toEqual(['Ann Ash was born in 1900.', 'Another record says Ann was born in 1901.']);
	});

	it('says married only when a marriage is recorded', () => {
		const sentences = text(
			person({
				partnerships: [
					{
						partnerName: 'Ben Birch',
						events: [
							fact('MARR', { dateText: '1922', place: 'Leeds' }),
							fact('DIV', { dateText: '1930' })
						],
						children: [
							{ name: 'Cal Birch', number: '1.1', type: 'biological' },
							{ name: 'Dee Birch', number: null, type: 'adoptive' }
						]
					},
					{ partnerName: 'Eli Cole', events: [], children: [] }
				],
				otherChildren: [{ name: 'Fay Ash', number: null, type: 'foster' }]
			})
		);
		expect(sentences).toEqual([
			'Ann married Ben Birch in 1922 in Leeds.',
			'They divorced in 1930.',
			'Their children were Cal Birch (1.1) and Dee Birch (adopted).',
			'Ann had a partnership with Eli Cole.',
			'Ann also had a child with no other parent recorded: Fay Ash (foster child).'
		]);
		expect(sentences.join(' ')).not.toMatch(/married Eli/);
	});

	it('says the bare name only when nothing else is known, since it repeats the heading', () => {
		expect(text(person())).toEqual(['Ann Ash.']);
		expect(
			text(person({ partnerships: [{ partnerName: 'Ben Birch', events: [], children: [] }] }))
		).toEqual(['Ann had a partnership with Ben Birch.']);
	});

	it("names the subject's children when no partner is recorded", () => {
		expect(
			text(
				person({
					partnerships: [
						{
							partnerName: null,
							events: [],
							children: [{ name: 'Cal', number: null, type: 'biological' }]
						}
					]
				})
			).at(-1)
		).toBe('Ann’s child was Cal.');
	});
});

describe('Endnotes', () => {
	it('numbers each citation once across the report, in the order first cited', () => {
		const endnotes = new Endnotes();
		const census = { key: 's1|p2', text: '1881 Census, page 2.' };
		const register = { key: 's2|', text: 'Parish register.' };
		const ann = narrativeOf(
			person({
				facts: [
					fact('BIRT', { dateText: '1900', notes: [register, census] }),
					fact('DEAT', { dateText: '1950', notes: [census] })
				]
			}),
			DMY,
			endnotes
		);
		expect(ann.map((s) => s.notes)).toEqual([[1, 2], [2]]);
		expect(endnotes.list()).toEqual([
			{ number: 1, text: 'Parish register.' },
			{ number: 2, text: '1881 Census, page 2.' }
		]);
	});
});
