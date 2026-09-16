import { describe, it, expect } from 'vitest';
import { buildFamilyTreeHierarchy, normalizeFamilies } from '#lib/components/tree/tree-layout.js';

describe('buildFamilyTreeHierarchy', () => {
  it('handles empty input gracefully', () => {
    const result = buildFamilyTreeHierarchy([], []);
    expect(result.nodes).toEqual([]);
    expect(result.links).toEqual([]);
  });

  it('connects both husband and wife to marriage union, and children to marriage union', () => {
    const individuals = [
      { id: 'I1', givenName: 'John', surname: 'Doe', sex: 'M' as const },
      { id: 'I2', givenName: 'Jane', surname: 'Smith', sex: 'F' as const },
      { id: 'I3', givenName: 'Jimmy', surname: 'Doe', sex: 'M' as const, famc: ['F1'] }
    ];

    const families = [
      {
        id: 'F1',
        husbandId: 'I1',
        wifeId: 'I2',
        children: [{ childId: 'I3', pedigree: 'birth' }],
        events: [{ type: 'MARR', dateRaw: '1980', place: 'Edinburgh' }]
      }
    ];

    const result = buildFamilyTreeHierarchy(individuals, families);

    // Should include person nodes for I1, I2, I3
    const i1Node = result.nodes.find((n) => n.data.id === 'I1');
    const i2Node = result.nodes.find((n) => n.data.id === 'I2');
    const i3Node = result.nodes.find((n) => n.data.id === 'I3');

    expect(i1Node).toBeDefined();
    expect(i2Node).toBeDefined();
    expect(i3Node).toBeDefined();

    // Should have union node for F1
    const f1Union = result.unionNodes.find((u) => u.id === 'F1');
    expect(f1Union).toBeDefined();
    expect(f1Union?.husbandId).toBe('I1');
    expect(f1Union?.wifeId).toBe('I2');

    // Both spouses should be side-by-side on the same generation (similar y)
    expect(i1Node!.y).toEqual(i2Node!.y);
    // The child should be on a lower generation (greater y)
    expect(i3Node!.y).toBeGreaterThan(i1Node!.y);

    // Links should include marriage links and descendant links
    // Check that there is a link from union to child I3
    const childLink = result.links.find(
      (l) => l.type === 'child' && l.target.x === i3Node!.x && l.target.y === i3Node!.y
    );
    expect(childLink).toBeDefined();

    // Check that there is a marriage link between I1 and I2 or from spouses to union
    const marriageLinks = result.links.filter((l) => l.type === 'marriage');
    expect(marriageLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('lays out sibling branches without horizontal collisions on the same generation level', () => {
    // Two sibling families at root level, each with children and spouses
    const individuals = [
      // Family 1
      { id: 'P1', givenName: 'Brother', surname: 'One', sex: 'M' as const },
      { id: 'P2', givenName: 'Wife', surname: 'One', sex: 'F' as const },
      { id: 'C1', givenName: 'Child1', surname: 'One', sex: 'M' as const, famc: ['F1'] },
      { id: 'C2', givenName: 'Child2', surname: 'One', sex: 'F' as const, famc: ['F1'] },

      // Family 2
      { id: 'P3', givenName: 'Brother', surname: 'Two', sex: 'M' as const },
      { id: 'P4', givenName: 'Wife', surname: 'Two', sex: 'F' as const },
      { id: 'C3', givenName: 'Child3', surname: 'Two', sex: 'M' as const, famc: ['F2'] },
      { id: 'C4', givenName: 'Child4', surname: 'Two', sex: 'F' as const, famc: ['F2'] }
    ];

    const families = [
      {
        id: 'F1',
        husbandId: 'P1',
        wifeId: 'P2',
        children: [{ childId: 'C1', pedigree: 'birth' }, { childId: 'C2', pedigree: 'birth' }]
      },
      {
        id: 'F2',
        husbandId: 'P3',
        wifeId: 'P4',
        children: [{ childId: 'C3', pedigree: 'birth' }, { childId: 'C4', pedigree: 'birth' }]
      }
    ];

    const result = buildFamilyTreeHierarchy(individuals, families);

    // Group nodes by Y coordinate (generation level)
    const nodesByY = new Map<number, Array<{ x: number; id: string }>>();
    for (const node of result.nodes) {
      const list = nodesByY.get(node.y) || [];
      list.push({ x: node.x, id: node.data.id });
      nodesByY.set(node.y, list);
    }

    // Verify for each generation level that no two nodes overlap (centers >= 220px apart)
    for (const [y, nodesAtLevel] of nodesByY.entries()) {
      nodesAtLevel.sort((a, b) => a.x - b.x);
      for (let i = 0; i < nodesAtLevel.length - 1; i++) {
        const left = nodesAtLevel[i];
        const right = nodesAtLevel[i + 1];
        const distance = right.x - left.x;
        expect(distance).toBeGreaterThanOrEqual(220);
      }
    }
  });

  it('supports single-parent families with only one parent and children', () => {
    const individuals = [
      { id: 'M1', givenName: 'Single', surname: 'Mother', sex: 'F' as const },
      { id: 'C1', givenName: 'Kid', surname: 'One', sex: 'M' as const, famc: ['F_SINGLE'] }
    ];

    const families = [
      {
        id: 'F_SINGLE',
        husbandId: null,
        wifeId: 'M1',
        children: [{ childId: 'C1', pedigree: 'birth' }]
      }
    ];

    const result = buildFamilyTreeHierarchy(individuals, families);

    const motherNode = result.nodes.find((n) => n.data.id === 'M1');
    const kidNode = result.nodes.find((n) => n.data.id === 'C1');
    const unionNode = result.unionNodes.find((u) => u.id === 'F_SINGLE');

    expect(motherNode).toBeDefined();
    expect(kidNode).toBeDefined();
    expect(unionNode).toBeDefined();

    expect(unionNode?.husbandId).toBeNull();
    expect(unionNode?.wifeId).toBe('M1');

    // Child is placed below mother
    expect(kidNode!.y).toBeGreaterThan(motherNode!.y);

    // Child link connects to union
    const childLink = result.links.find((l) => l.type === 'child' && l.target.x === kidNode!.x);
    expect(childLink).toBeDefined();
  });

  it('supports blended families where a parent has multiple distinct family units', () => {
    const individuals = [
      { id: 'FATH', givenName: 'Robert', surname: 'Smith', sex: 'M' as const },
      { id: 'W1', givenName: 'First', surname: 'Wife', sex: 'F' as const },
      { id: 'C1', givenName: 'Child', surname: 'FromFirst', sex: 'M' as const, famc: ['FAM1'] },
      { id: 'W2', givenName: 'Second', surname: 'Wife', sex: 'F' as const },
      { id: 'C2', givenName: 'Child', surname: 'FromSecond', sex: 'F' as const, famc: ['FAM2'] }
    ];

    const families = [
      {
        id: 'FAM1',
        husbandId: 'FATH',
        wifeId: 'W1',
        children: [{ childId: 'C1', pedigree: 'birth' }]
      },
      {
        id: 'FAM2',
        husbandId: 'FATH',
        wifeId: 'W2',
        children: [{ childId: 'C2', pedigree: 'birth' }]
      }
    ];

    const result = buildFamilyTreeHierarchy(individuals, families);

    expect(result.nodes.length).toBe(5);
    expect(result.unionNodes.length).toBe(2);

    const c1Node = result.nodes.find((n) => n.data.id === 'C1');
    const c2Node = result.nodes.find((n) => n.data.id === 'C2');

    expect(c1Node).toBeDefined();
    expect(c2Node).toBeDefined();

    // Verify children do not horizontally collide
    if (c1Node!.y === c2Node!.y) {
      expect(Math.abs(c1Node!.x - c2Node!.x)).toBeGreaterThanOrEqual(220);
    }
  });

  it('normalizes redundant and duplicate couple families as well as single-parent subsets', () => {
    const rawFamilies = [
      // Duplicate couple families for H1 & W1
      {
        id: 'FAM_DUP_1',
        husbandId: 'H1',
        wifeId: 'W1',
        children: [{ childId: 'C1', pedigree: 'birth' }],
        events: [{ type: 'MARR', dateRaw: '1970', place: 'Edinburgh' }]
      },
      {
        id: 'FAM_DUP_2',
        husbandId: 'H1',
        wifeId: 'W1',
        children: [{ childId: 'C2', pedigree: 'birth' }],
        events: []
      },
      // Redundant single-parent family containing C1 who is already under H1 & W1
      {
        id: 'FAM_SINGLE_REDUNDANT',
        husbandId: 'H1',
        wifeId: null,
        children: [{ childId: 'C1', pedigree: 'birth' }]
      },
      // Valid separate single parent family with C3
      {
        id: 'FAM_SINGLE_VALID',
        husbandId: null,
        wifeId: 'W1',
        children: [{ childId: 'C3', pedigree: 'birth' }]
      }
    ];

    const normalized = normalizeFamilies(rawFamilies);

    // Couple duplicate families should be merged into one
    const mergedCouple = normalized.filter((f) => f.husbandId === 'H1' && f.wifeId === 'W1');
    expect(mergedCouple.length).toBe(1);
    expect(mergedCouple[0].children?.map((c) => c.childId).sort()).toEqual(['C1', 'C2']);
    expect(mergedCouple[0].events?.length).toBe(1);

    // Redundant single-parent family for C1 should be omitted
    const redundantSingle = normalized.find((f) => f.id === 'FAM_SINGLE_REDUNDANT');
    expect(redundantSingle).toBeUndefined();

    // Valid single-parent family for C3 should be preserved
    const validSingle = normalized.find((f) => f.id === 'FAM_SINGLE_VALID');
    expect(validSingle).toBeDefined();
    expect(validSingle?.children?.[0].childId).toBe('C3');
  });
});
