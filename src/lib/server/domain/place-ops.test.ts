import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from './errors';
import { buildPlaceOps, factsAtPlace } from './place-ops';
import { MAX_PLACE_REWRITE_FACTS } from '../../shared/places';
import { treeRows } from '../testing/rows';

const ctx = { now: 2_000_000 };
const rewrite = (fromKey: string, to: string) => ({ kind: 'rewrite_place' as const, placeId: 'record-1', fromKey, to });

const rows = treeRows({
	people: [{ id: 'p1' }, { id: 'p2' }],
	events: [
		{ id: 'e1', entityId: 'p1', type: 'BIRT', place: 'Cork' },
		{ id: 'e2', entityId: 'p2', type: 'BIRT', place: 'cork' },
		{ id: 'e3', entityId: 'p2', type: 'RESI', place: 'Cork' },
		{ id: 'e4', entityId: 'p1', type: 'RESI', place: 'Hull' },
		{ id: 'e5', entityId: 'p1', type: 'OCCU', place: null }
	]
});

describe('rewriting a place', () => {
	it('finds the facts of a place by key, whatever their case', () => {
		expect(factsAtPlace(rows, 'cork').map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
	});

	it('writes the new text on each, and bumps a person once for their vitals', () => {
		const ops = buildPlaceOps(rows, rewrite('cork', 'Cork, Ireland'), ctx);
		expect(ops.filter((o) => o.table === 'events').map((o) => [o.id, (o.after as { place: string }).place, (o.after as { version: number }).version])).toEqual([
			['e1', 'Cork, Ireland', 2],
			['e2', 'Cork, Ireland', 2],
			['e3', 'Cork, Ireland', 2]
		]);
		expect(ops.filter((o) => o.table === 'individuals').map((o) => o.id)).toEqual(['p1', 'p2']);
		for (const op of ops) expect(op.before).not.toBeNull();
	});

	it('leaves a fact that already has the text alone', () => {
		const ops = buildPlaceOps(rows, rewrite('cork', 'Cork'), ctx);
		expect(ops.filter((o) => o.table === 'events').map((o) => o.id)).toEqual(['e2']);
	});

	it('refuses an empty name, a place nobody wrote, and one too big to log in one change', () => {
		expect(() => buildPlaceOps(rows, rewrite('cork', '  '), ctx)).toThrow(ValidationError);
		expect(() => buildPlaceOps(rows, rewrite('atlantis', 'X'), ctx)).toThrow(NotFoundError);
		const many = treeRows({
			people: [{ id: 'p1' }],
			events: Array.from({ length: MAX_PLACE_REWRITE_FACTS + 1 }, (_, i) => ({ id: `e${i}`, entityId: 'p1', type: 'RESI', place: 'Cork' }))
		});
		expect(() => buildPlaceOps(many, rewrite('cork', 'X'), ctx)).toThrow(/at most 500/);
	});
});
