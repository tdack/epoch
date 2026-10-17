import { describe, expect, it } from 'vitest';
import type { FactDto, PartnershipDto } from '#lib/shared/person-page.js';
import type { GraphUnionEvent } from '#lib/shared/relationship-graph.js';
import { lifeTimeline, type LifeEntry } from './life-timeline';

function fact(id: string, sortStart: string | null, kind: FactDto['kind'] = 'event'): FactDto {
	return { id, kind, sortStart } as FactDto;
}

function union(unionId: string, events: Array<Partial<GraphUnionEvent>>): PartnershipDto {
	return {
		unionId,
		partners: [],
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
	entries.map((e) => (e.kind === 'fact' ? e.fact.id : e.event.id));

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
