import { describe, expect, it } from 'vitest';
import type { FactDto } from '#lib/shared/person-page.js';
import { factLabelOf, groupFacts, groupLabelOf, memberSubTypeOf } from './fact-groups';

function fact(
	id: string,
	type: string,
	sortStart: string | null,
	overrides: Partial<FactDto> = {}
): FactDto {
	return {
		id,
		type,
		label: type,
		sortStart,
		classification: null,
		conflict: null,
		...overrides
	} as FactDto;
}

const shape = (facts: FactDto[], include?: (fact: FactDto) => boolean) =>
	groupFacts(facts, include).map((g) => [g.label, g.members.map((m) => m.fact.id)]);

describe('groupFacts', () => {
	it('groups by kind in first-seen order, newest first, undated last', () => {
		const facts = [
			fact('r1', 'RESI', '1900-01-01'),
			fact('o1', 'OCCU', null),
			fact('r2', 'RESI', null),
			fact('r3', 'RESI', '1920-01-01')
		];
		expect(shape(facts)).toEqual([
			['RESI', ['r3', 'r1', 'r2']],
			['OCCU', ['o1']]
		]);
	});

	it('puts the later of two same-date facts first', () => {
		const facts = [fact('a', 'RESI', '1900-01-01'), fact('b', 'RESI', '1900-01-01')];
		expect(shape(facts)).toEqual([['RESI', ['b', 'a']]]);
	});

	it('keeps each fact’s index into the full list when some are left out', () => {
		const facts = [fact('birth', 'BIRT', '1900-01-01'), fact('r1', 'RESI', null)];
		const [group] = groupFacts(facts, (f) => f.type === 'RESI');
		expect(group!.members[0]!.index).toBe(1);
		expect(groupFacts(facts, (f) => f.type === 'RESI')).toHaveLength(1);
	});

	it('marks a group conflicting when any member is', () => {
		const facts = [
			fact('b1', 'BIRT', '1900-01-01'),
			fact('b2', 'BIRT', '1901-01-01', {
				conflict: { kind: 'conflict', otherIds: ['b1'] } as never
			})
		];
		expect(groupFacts(facts)[0]!.isConflicting).toBe(true);
	});

	it('keeps custom events with different sub-types apart, and names them by it', () => {
		const anniversary = fact('e1', 'EVEN', null, {
			label: 'Other event',
			classification: 'Anniversary'
		});
		const facts = [anniversary, fact('e2', 'EVEN', null, { classification: 'Graduation' })];
		expect(groupFacts(facts)).toHaveLength(2);
		expect(groupLabelOf(anniversary)).toBe('Other event (Anniversary)');
	});

	it('keeps a sub-typed birth with the other births, naming the sub-type on the fact itself', () => {
		const registered = fact('b1', 'BIRT', null, { label: 'Birth', classification: 'Registered' });
		const plain = fact('b2', 'BIRT', null, { label: 'Birth' });
		expect(shape([registered, plain])).toEqual([['Birth', ['b2', 'b1']]]);
		expect(factLabelOf(registered)).toBe('Birth (Registered)');
		expect(memberSubTypeOf(registered)).toBe('Registered');
		expect(memberSubTypeOf(fact('e1', 'EVEN', null, { classification: 'Anniversary' }))).toBeNull();
		expect(
			factLabelOf(fact('o1', 'OCCU', null, { label: 'Occupation', classification: 'occupation' }))
		).toBe('Occupation');
	});
});
