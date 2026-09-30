import { describe, expect, it } from 'vitest';
import { makeGraph } from '../tree-layout/test-support';
import { relativesOf } from './relatives';

describe('relativesOf', () => {
  // Ann and Ben have Cat and Dan. Ann then partners Eli, and they have Fay. Ben has Gus alone.
  const graph = makeGraph({
    people: ['ann', 'ben', 'cat', 'dan', 'eli', 'fay', 'gus'],
    unions: [
      { id: 'u-ab', partners: ['ann', 'ben'], children: ['cat', 'dan'] },
      { id: 'u-ae', partners: ['ann', 'eli'], children: ['fay'] }
    ],
    direct: [{ parentId: 'ben', childId: 'gus' }]
  });

  it('separates full siblings from half-siblings, including one recorded with no partnership', () => {
    const cat = relativesOf(graph, 'cat').siblings;
    expect(cat.full).toEqual(['dan']);
    expect([...cat.half].sort()).toEqual(['fay', 'gus']);
    expect(relativesOf(graph, 'fay').siblings).toEqual({ full: [], half: ['cat', 'dan'] });
  });

  it('lists parents by family, keeping each parent’s type', () => {
    expect(relativesOf(graph, 'cat').parentFamilies).toEqual([
      { unionId: 'u-ab', parents: [{ personId: 'ann', type: 'biological' }, { personId: 'ben', type: 'biological' }] }
    ]);
    expect(relativesOf(graph, 'gus').parentFamilies).toEqual([{ unionId: null, parents: [{ personId: 'ben', type: 'biological' }] }]);
  });

  it('lists each partnership with the other partners and this person’s children in it', () => {
    const ann = relativesOf(graph, 'ann');
    expect(ann.partnerships.map((p) => [p.unionId, p.partnerIds, p.children.map((c) => c.personId)])).toEqual([
      ['u-ab', ['ben'], ['cat', 'dan']],
      ['u-ae', ['eli'], ['fay']]
    ]);
    expect(relativesOf(graph, 'ben').directChildren.map((c) => c.personId)).toEqual(['gus']);
  });

  it('derives step-relatives from partners’ other children', () => {
    expect(relativesOf(graph, 'eli').stepChildren.map((s) => s.personId).sort()).toEqual(['cat', 'dan']);
    expect(relativesOf(graph, 'cat').stepParents.map((s) => s.personId)).toEqual(['eli']);
  });

  it('gives a person with no recorded relatives empty lists', () => {
    const alone = makeGraph({ people: ['solo'] });
    expect(relativesOf(alone, 'solo')).toEqual({
      parentFamilies: [],
      partnerships: [],
      directChildren: [],
      siblings: { full: [], half: [] },
      stepParents: [],
      stepChildren: []
    });
  });
});
