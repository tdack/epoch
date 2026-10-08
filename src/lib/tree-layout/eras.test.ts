import { describe, expect, it } from 'vitest';
import { estimateEras, type EraBonds, type EraPerson } from './eras';

const family = (dates: Record<string, string | undefined>): [EraPerson[], EraBonds] => [
	[
		{ id: 'gran', generation: -2, birthDate: dates.gran },
		{ id: 'grandad', generation: -2, birthDate: dates.grandad },
		{ id: 'mum', generation: -1, birthDate: dates.mum },
		{ id: 'dad', generation: -1, birthDate: dates.dad },
		{ id: 'me', generation: 0, birthDate: dates.me }
	],
	{
		parentChild: [
			{ parentId: 'gran', childId: 'mum' },
			{ parentId: 'grandad', childId: 'mum' },
			{ parentId: 'mum', childId: 'me' },
			{ parentId: 'dad', childId: 'me' }
		],
		partners: [
			['gran', 'grandad'],
			['mum', 'dad']
		]
	}
];

describe('estimateEras', () => {
	it('reads the midpoint of a range and keeps anchors fixed', () => {
		const [people, bonds] = family({ gran: '1900', mum: 'ABT 1930', me: '1960' });
		const { eras, anchorIds } = estimateEras(people, bonds);
		expect([...anchorIds].sort()).toEqual(['gran', 'me', 'mum']);
		expect(eras.get('gran')).toBeCloseTo(1900.5, 0);
		expect(eras.get('me')).toBeCloseTo(1960.5, 0);
	});

	it('puts an undated partner in the era of the partner who has a date', () => {
		const [people, bonds] = family({ gran: '1900', mum: '1930', me: '1958' });
		const { eras } = estimateEras(people, bonds);
		// Dad has no recorded parents; his child and partner pin him near 1930, not the 1700s.
		expect(Math.abs(eras.get('dad')! - eras.get('mum')!)).toBeLessThan(3);
		expect(Math.abs(eras.get('grandad')! - eras.get('gran')!)).toBeLessThan(3);
	});

	it('estimates from a death date when there is no birth', () => {
		const people: EraPerson[] = [{ id: 'a', generation: 0, deathDate: '1970' }];
		const { eras, anchorIds } = estimateEras(people, { parentChild: [], partners: [] });
		expect(anchorIds.has('a')).toBe(true);
		expect(eras.get('a')).toBeLessThan(1910);
		expect(eras.get('a')).toBeGreaterThan(1880);
	});

	it('keeps a child 15 to 55 years after a parent however the dates pull', () => {
		const people: EraPerson[] = [
			{ id: 'p', generation: -1, birthDate: '1900' },
			{ id: 'x', generation: 0 },
			{ id: 'k', generation: 1, birthDate: '1990' }
		];
		const bonds: EraBonds = {
			parentChild: [
				{ parentId: 'p', childId: 'x' },
				{ parentId: 'x', childId: 'k' }
			],
			partners: []
		};
		const x = estimateEras(people, bonds).eras.get('x')!;
		expect(x - 1900.5).toBeGreaterThanOrEqual(15);
		expect(1990.5 - x).toBeGreaterThanOrEqual(15);
	});

	it('falls back to 28 years a generation when nobody has a date', () => {
		const [people, bonds] = family({});
		const { eras, hasDates } = estimateEras(people, bonds);
		expect(hasDates).toBe(false);
		expect(eras.get('me')! - eras.get('mum')!).toBeCloseTo(28);
		expect(eras.get('mum')! - eras.get('gran')!).toBeCloseTo(28);
	});

	it('never reads a private person’s dates, so nobody’s era depends on them', () => {
		const [people, bonds] = family({ gran: '1900', me: '1960' });
		const withDate = people.map((p) =>
			p.id === 'mum' ? { ...p, birthDate: '1700', isPrivate: true } : p
		);
		const without = people.map((p) => (p.id === 'mum' ? { ...p, isPrivate: true } : p));
		const a = estimateEras(withDate, bonds);
		const b = estimateEras(without, bonds);
		expect(a.anchorIds.has('mum')).toBe(false);
		expect([...a.eras]).toEqual([...b.eras]);
	});

	it('is deterministic', () => {
		const [people, bonds] = family({ gran: '1900', me: '1958' });
		expect([...estimateEras(people, bonds).eras]).toEqual([...estimateEras(people, bonds).eras]);
	});
});
