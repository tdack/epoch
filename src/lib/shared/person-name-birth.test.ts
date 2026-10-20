import { describe, expect, it } from 'vitest';
import { namesWithBirth } from './person-name';

describe('namesWithBirth', () => {
	const name = (p: { n: string }) => p.n;

	it('adds birth month and year only to shared names', () => {
		const people = [
			{ n: 'David Little', birthDate: '12 MAR 1812' },
			{ n: 'David Little', birthDate: 'ABT 1840' },
			{ n: 'Ann Lee', birthDate: '1 JAN 1900' }
		];
		expect(namesWithBirth(people, name)).toEqual([
			'David Little (b. MAR 1812)',
			'David Little (b. 1840)',
			'Ann Lee'
		]);
	});

	it('leaves namesakes with no readable birth bare', () => {
		const people = [{ n: 'Sam', birthDate: null }, { n: 'Sam' }];
		expect(namesWithBirth(people, name)).toEqual(['Sam', 'Sam']);
	});
});
