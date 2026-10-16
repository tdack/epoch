import { describe, expect, it } from 'vitest';
import { treeRows } from '../../testing/rows';
import { mergeSeeds, seedOf, selectScope } from '../write-scope';
import { followUpSeed, seedWithFollowUp } from './follow-up';

/** u1 is a and b's; u2 is a second partnership of the same pair; c is their child, d a stranger. */
const whole = treeRows({
	people: ['a', 'b', 'c', 'd'].map((id) => ({ id, birth: '1900' })),
	unions: [
		{ id: 'u1', partners: ['a', 'b'] },
		{ id: 'u2', partners: ['a', 'b'] },
		{ id: 'u3', partners: ['d'] }
	],
	links: [{ parentId: 'a', childId: 'c', unionId: 'u1' }]
});

const ids = (rows: { unions: Array<{ id: string }> }) => rows.unions.map((u) => u.id);

describe('followUpSeed', () => {
	it('is null for a seed that does not opt in, so its round trips are unchanged', () => {
		const seed = seedOf({ unions: ['u1'] });
		expect(followUpSeed(selectScope(whole, seed), seed)).toBeNull();
	});

	it('names the partners of the partnerships found, whose partnerships are the twins', () => {
		const seed = seedOf({ unions: ['u1'], shouldFollowFamily: true });
		const first = selectScope(whole, seed);
		expect(ids(first)).toEqual(['u1']);
		const extra = followUpSeed(first, seed)!;
		expect([...extra.people].sort()).toEqual(['a', 'b']);
		expect(ids(selectScope(whole, mergeSeeds(seed, extra)))).toEqual(['u1', 'u2']);
	});

	it('names the parents of a seeded child', () => {
		const seed = seedOf({ people: ['c'], shouldFollowFamily: true });
		expect([...followUpSeed(selectScope(whole, seed), seed)!.people]).toEqual(['a']);
	});

	it('is null when it adds nobody the seed did not already name', () => {
		const seed = seedOf({ people: ['d'], shouldFollowFamily: true });
		expect(followUpSeed(selectScope(whole, seed), seed)).toBeNull();
		const missing = seedOf({ unions: ['nope'], shouldFollowFamily: true });
		expect(seedWithFollowUp(selectScope(whole, missing), missing)).toBeNull();
	});

	it('survives a merge', () => {
		expect(mergeSeeds(seedOf({}), seedOf({ shouldFollowFamily: true })).shouldFollowFamily).toBe(
			true
		);
		expect(mergeSeeds(seedOf({}), seedOf({})).shouldFollowFamily).toBeUndefined();
	});
});
