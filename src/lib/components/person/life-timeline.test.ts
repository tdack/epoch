import { describe, expect, it } from 'vitest';
import type { FactDto, PartnershipDto } from '#lib/shared/person-page.js';
import type { GraphUnionEvent } from '#lib/shared/relationship-graph.js';
import type { PersonSummaryDto } from '#lib/shared/person-page.js';
import { childWord, lifeTimeline, type LifeEntry } from './life-timeline';

function fact(id: string, sortStart: string | null, kind: FactDto['kind'] = 'event'): FactDto {
	return { id, kind, sortStart } as FactDto;
}

function union(unionId: string, events: Array<Partial<GraphUnionEvent>>): PartnershipDto {
	return {
		unionId,
		partners: [],
		children: [],
		events: events.map((e, i) => ({
			id: `${unionId}-${i}`,
			type: 'MARR',
			dateText: null,
			place: null,
			...e
		}))
	} as unknown as PartnershipDto;
}

const ids = (entries: LifeEntry[]) =>
	entries.map((e) =>
		e.kind === 'fact' ? e.fact.id : e.kind === 'union' ? e.event.id : e.child.id
	);

const kid = (id: string, birthSort: string | null, extra: Partial<PersonSummaryDto> = {}) => ({
	person: {
		id,
		birthSort,
		birthDate: birthSort,
		isPrivate: false,
		sex: 'U',
		...extra
	} as PersonSummaryDto,
	types: []
});

describe('lifeTimeline', () => {
	it('places partnership events among the person’s own by date, undated last', () => {
		const facts = [fact('birth', '1910-08-05'), fact('death', '1970-04-03'), fact('undated', null)];
		const partnerships = [
			union('u1', [{ dateSort: '1935-06-01' }, { id: 'div', dateSort: null, dateText: null }])
		];
		expect(ids(lifeTimeline(facts, partnerships))).toEqual([
			'birth',
			'u1-0',
			'death',
			'undated',
			'div'
		]);
	});

	it('leaves attributes out and keeps each event’s index into the facts', () => {
		const entries = lifeTimeline(
			[fact('occupation', null, 'attribute'), fact('birth', '1900-01-01')],
			[]
		);
		expect(entries).toEqual([
			{ kind: 'fact', fact: expect.objectContaining({ id: 'birth' }), index: 1 }
		]);
	});

	it('parses a union event’s text when it has no stored sort key', () => {
		const facts = [fact('birth', '1900-01-01'), fact('death', '1980-01-01')];
		const partnerships = [union('u1', [{ dateText: '12 MAR 1925', dateSort: undefined }])];
		expect(ids(lifeTimeline(facts, partnerships))).toEqual(['birth', 'u1-0', 'death']);
	});

	it('orders events from several partnerships together, and a tie keeps the own event first', () => {
		const facts = [fact('birth', '1900-01-01'), fact('census', '1930-01-01')];
		const partnerships = [
			union('second', [{ dateSort: '1940-01-01' }]),
			union('first', [{ dateSort: '1930-01-01' }])
		];
		expect(ids(lifeTimeline(facts, partnerships))).toEqual([
			'birth',
			'census',
			'first-0',
			'second-0'
		]);
	});
});

describe('children in the life timeline', () => {
	it('places each recorded birth once, after a same-day partnership event', () => {
		const partnerships = [
			{ ...union('u1', [{ dateSort: '1935-06-01' }]), children: [kid('ann', '1935-06-01')] }
		];
		const facts = [fact('birth', '1910-08-05'), fact('death', '1970-04-03')];
		expect(
			ids(lifeTimeline(facts, partnerships, [kid('ann', '1935-06-01'), kid('bob', '1940-01-01')]))
		).toEqual(['birth', 'u1-0', 'ann', 'bob', 'death']);
	});

	it('leaves out a hidden child and one with no recorded birth', () => {
		const hidden = kid('hid', null, { isPrivate: true, birthDate: null });
		const unborn = kid('nob', '1940-01-01', { birthDate: null });
		expect(ids(lifeTimeline([], [], [hidden, unborn]))).toEqual([]);
	});

	it('names what the child is to the person', () => {
		const p = (sex: PersonSummaryDto['sex']) => ({ sex }) as PersonSummaryDto;
		expect(childWord(p('M'), ['biological'])).toBe('son');
		expect(childWord(p('F'), [])).toBe('daughter');
		expect(childWord(p('U'), ['adoptive'])).toBe('adopted child');
		expect(childWord(p('F'), ['foster'])).toBe('foster daughter');
		expect(childWord(p('M'), ['adoptive', 'biological'])).toBe('son');
		expect(childWord(p('M'), ['guardian'])).toBe('ward');
	});
});
