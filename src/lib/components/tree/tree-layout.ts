import * as d3 from 'd3';

export interface RawPerson {
  id: string;
  givenName: string | null;
  surname: string | null;
  sex: 'M' | 'F' | 'U' | null;
  events?: Array<{
    type: string;
    dateRaw: string | null;
    dateSort: string | null;
    place: string | null;
    description: string | null;
  }>;
  media?: Array<{
    id: string;
    r2ObjectKey: string;
    title: string | null;
    mimeType: string;
  }>;
  famc?: string[];
  fams?: string[];
}

export interface RawFamily {
  id: string;
  husbandId: string | null;
  wifeId: string | null;
  children?: Array<{ childId: string; pedigree: string | null }>;
  events?: Array<{
    type: string;
    dateRaw: string | null;
    place: string | null;
  }>;
}

export interface HierarchyNodeData {
  id: string;
  name: string;
  dates: string;
  sex?: 'M' | 'F' | 'U';
  photoUrl?: string;
  spouseName?: string;
  children?: HierarchyNodeData[];
  raw?: RawPerson;
}

export interface UnionNodeData {
  id: string;
  husbandId: string | null;
  wifeId: string | null;
  marriageDate?: string;
  marriagePlace?: string;
}

export interface TreeLayoutResult {
  nodes: Array<{
    x: number;
    y: number;
    data: HierarchyNodeData;
  }>;
  unionNodes: Array<{
    id: string;
    x: number;
    y: number;
    husbandId: string | null;
    wifeId: string | null;
    marriageDate?: string;
    marriagePlace?: string;
  }>;
  links: Array<{
    id?: string;
    type: 'marriage' | 'child' | 'parent';
    source: { x: number; y: number };
    target: { x: number; y: number };
  }>;
}

function formatDates(events?: RawPerson['events']): string {
  if (!events || events.length === 0) return '';
  const birth = events.find((e) => e.type === 'BIRT')?.dateRaw;
  const death = events.find((e) => e.type === 'DEAT')?.dateRaw;

  if (birth && death) return `${birth} – ${death}`;
  if (birth) return `b. ${birth}`;
  if (death) return `d. ${death}`;
  return '';
}

interface FamilyGroup {
  id: string;
  husband: RawPerson | null;
  wife: RawPerson | null;
  children: RawPerson[];
  marriageDate?: string;
  marriagePlace?: string;
}

// Normalized family representation
export function normalizeFamilies(families: RawFamily[]): RawFamily[] {
  const pairMap = new Map<string, RawFamily[]>();
  const singleOrNoSpouse: RawFamily[] = [];

  for (const fam of families) {
    const h = fam.husbandId || null;
    const w = fam.wifeId || null;
    if (h && w) {
      const key = `${h}__${w}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(fam);
    } else if (h || w) {
      const key = h ? `H_${h}` : `W_${w}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(fam);
    } else {
      singleOrNoSpouse.push(fam);
    }
  }

  const mergedFamilies: RawFamily[] = [];

  for (const [, famList] of pairMap.entries()) {
    if (famList.length === 1) {
      mergedFamilies.push(famList[0]);
    } else {
      famList.sort(
        (a, b) =>
          ((b.children?.length || 0) + (b.events?.length || 0)) -
          ((a.children?.length || 0) + (a.events?.length || 0))
      );
      const primary = famList[0];
      const mergedChildrenMap = new Map<string, string | null>();
      const mergedEvents: any[] = [];
      const seenEventKeys = new Set<string>();

      for (const fam of famList) {
        for (const ch of fam.children || []) {
          if (!mergedChildrenMap.has(ch.childId)) {
            mergedChildrenMap.set(ch.childId, ch.pedigree);
          }
        }
        for (const ev of fam.events || []) {
          const evKey = `${ev.type}_${ev.dateRaw}_${ev.place}`;
          if (!seenEventKeys.has(evKey)) {
            seenEventKeys.add(evKey);
            mergedEvents.push(ev);
          }
        }
      }

      mergedFamilies.push({
        id: primary.id,
        husbandId: primary.husbandId,
        wifeId: primary.wifeId,
        children: Array.from(mergedChildrenMap.entries()).map(([childId, pedigree]) => ({
          childId,
          pedigree
        })),
        events: mergedEvents
      });
    }
  }

  mergedFamilies.push(...singleOrNoSpouse);

  const twoParentFamilies = mergedFamilies.filter((f) => f.husbandId && f.wifeId);
  const filteredFamilies = mergedFamilies.filter((fam) => {
    if (fam.husbandId && fam.wifeId) return true;
    if (!fam.husbandId && !fam.wifeId) return (fam.children?.length || 0) > 0;

    const parentId = fam.husbandId || fam.wifeId;
    const children = fam.children || [];
    if (children.length === 0) return false;

    const allChildrenInTwoParent = children.every((ch) => {
      return twoParentFamilies.some(
        (tpf) =>
          (tpf.husbandId === parentId || tpf.wifeId === parentId) &&
          (tpf.children || []).some((c) => c.childId === ch.childId)
      );
    });

    return !allChildrenInTwoParent;
  });

  return filteredFamilies;
}

/**
 * Builds a hierarchical tree layout from relational individuals and families.
 * Renders marriages as side-by-side couples with a central union connector,
 * and descends child links directly from the parents' marriage union.
 */
export function buildFamilyTreeHierarchy(
  individuals: RawPerson[],
  families: RawFamily[],
  rootPersonId?: string
): TreeLayoutResult {
  if (!individuals || individuals.length === 0) {
    return { nodes: [], unionNodes: [], links: [] };
  }

  const normalizedFamList = normalizeFamilies(families);

  const indMap = new Map<string, RawPerson>();
  for (const ind of individuals) {
    indMap.set(ind.id, ind);
  }

  // Update ind.fams / ind.famc references according to normalized families
  for (const ind of individuals) {
    ind.fams = normalizedFamList
      .filter((f) => f.husbandId === ind.id || f.wifeId === ind.id)
      .map((f) => f.id);
    ind.famc = normalizedFamList
      .filter((f) => f.children && f.children.some((c) => c.childId === ind.id))
      .map((f) => f.id);
  }

  const famMap = new Map<string, RawFamily>();
  for (const fam of normalizedFamList) {
    famMap.set(fam.id, fam);
  }

  // Parse structured family groups
  const familyGroups = new Map<string, FamilyGroup>();
  for (const fam of normalizedFamList) {
    const marrEvent = fam.events?.find((e) => e.type === 'MARR');
    const groupChildren: RawPerson[] = [];
    if (fam.children) {
      for (const ch of fam.children) {
        const cInd = indMap.get(ch.childId);
        if (cInd) groupChildren.push(cInd);
      }
    }

    familyGroups.set(fam.id, {
      id: fam.id,
      husband: fam.husbandId ? indMap.get(fam.husbandId) || null : null,
      wife: fam.wifeId ? indMap.get(fam.wifeId) || null : null,
      children: groupChildren,
      marriageDate: marrEvent?.dateRaw || undefined,
      marriagePlace: marrEvent?.place || undefined
    });
  }

  // 1. Assign generations (Y levels) using topological relaxation
  const personGen = new Map<string, number>();

  // Find individuals with no parents as root generation candidates
  for (const ind of individuals) {
    if (!ind.famc || ind.famc.length === 0) {
      personGen.set(ind.id, 0);
    }
  }

  // Fallback if circular or all have famc
  if (personGen.size === 0 && individuals.length > 0) {
    personGen.set(individuals[0].id, 0);
  }

  // Propagate generations downward (parent -> child is +1) and across marriages (spouses same level)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;

    // Spouses should share the same generation
    for (const fam of normalizedFamList) {
      if (fam.husbandId && fam.wifeId) {
        const gH = personGen.get(fam.husbandId);
        const gW = personGen.get(fam.wifeId);
        if (gH !== undefined && gW === undefined) {
          personGen.set(fam.wifeId, gH);
          changed = true;
        } else if (gW !== undefined && gH === undefined) {
          personGen.set(fam.husbandId, gW);
          changed = true;
        } else if (gH !== undefined && gW !== undefined && gH !== gW) {
          const maxG = Math.max(gH, gW);
          if (gH < maxG) {
            personGen.set(fam.husbandId, maxG);
            changed = true;
          }
          if (gW < maxG) {
            personGen.set(fam.wifeId, maxG);
            changed = true;
          }
        }
      }

      // Children are +1 generation above their parents
      const parentGens: number[] = [];
      if (fam.husbandId && personGen.has(fam.husbandId)) {
        parentGens.push(personGen.get(fam.husbandId)!);
      }
      if (fam.wifeId && personGen.has(fam.wifeId)) {
        parentGens.push(personGen.get(fam.wifeId)!);
      }

      if (parentGens.length > 0 && fam.children) {
        const targetGen = Math.max(...parentGens) + 1;
        for (const ch of fam.children) {
          const curGen = personGen.get(ch.childId);
          if (curGen === undefined || curGen < targetGen) {
            personGen.set(ch.childId, targetGen);
            changed = true;
          }
        }
      }
    }
  }

  // Any remaining unassigned individuals get generation 0
  for (const ind of individuals) {
    if (!personGen.has(ind.id)) {
      personGen.set(ind.id, 0);
    }
  }

  // Normalize min generation to 0
  let minGen = Infinity;
  for (const gen of personGen.values()) {
    if (gen < minGen) minGen = gen;
  }
  if (minGen !== 0 && minGen !== Infinity) {
    for (const [id, gen] of personGen.entries()) {
      personGen.set(id, gen - minGen);
    }
  }

  // 2. Hierarchical component layout
  const processedPersons = new Set<string>();
  const processedFamilies = new Set<string>();

  interface PlacedPerson {
    x: number;
    y: number;
    data: HierarchyNodeData;
  }

  interface PlacedUnion {
    id: string;
    x: number;
    y: number;
    husbandId: string | null;
    wifeId: string | null;
    marriageDate?: string;
    marriagePlace?: string;
  }

  const placedPersons = new Map<string, PlacedPerson>();
  const placedUnions = new Map<string, PlacedUnion>();
  const links: TreeLayoutResult['links'] = [];

  const NODE_WIDTH = 220;
  const SPOUSE_SPACING = 290; // Distance between centers of spouses (nodes are 210px wide)
  const NODE_GAP = 60;
  const GEN_HEIGHT = 160;

  // Track the rightmost occupied X coordinate at each generation level
  // to guarantee collision-free placement across all subtrees and branches
  const maxOccupiedX = new Map<number, number>();

  function getLevelMaxX(gen: number): number {
    return maxOccupiedX.get(gen) ?? -Infinity;
  }

  function updateLevelMaxX(gen: number, rightX: number) {
    const cur = maxOccupiedX.get(gen) ?? -Infinity;
    if (rightX > cur) {
      maxOccupiedX.set(gen, rightX);
    }
  }

  function toNodeData(person: RawPerson): HierarchyNodeData {
    const fullName = [person.givenName, person.surname].filter(Boolean).join(' ') || person.id;
    const dates = formatDates(person.events);
    const firstImage = person.media?.find((m) => m.mimeType.startsWith('image/'));
    const photoUrl = firstImage ? `/api/media/${firstImage.r2ObjectKey}` : undefined;

    let spouseName: string | undefined;
    if (person.fams && person.fams.length > 0) {
      for (const fId of person.fams) {
        const f = famMap.get(fId);
        if (!f) continue;
        const spId = f.husbandId === person.id ? f.wifeId : f.husbandId;
        if (spId && indMap.has(spId)) {
          const sp = indMap.get(spId)!;
          spouseName = [sp.givenName, sp.surname].filter(Boolean).join(' ');
          break;
        }
      }
    }

    return {
      id: person.id,
      name: fullName,
      dates,
      sex: (person.sex as any) || 'U',
      spouseName,
      photoUrl,
      raw: person
    };
  }

  interface SubtreeBounds {
    minX: number;
    maxX: number;
    levels: Map<number, { minX: number; maxX: number }>;
  }

  interface IntermediateLayout {
    persons: Array<{ id: string; x: number; y: number; gen: number; data: HierarchyNodeData }>;
    unions: Array<{
      id: string;
      x: number;
      y: number;
      gen: number;
      husbandId: string | null;
      wifeId: string | null;
      marriageDate?: string;
      marriagePlace?: string;
    }>;
    links: TreeLayoutResult['links'];
    unionX: number;
    bounds: SubtreeBounds;
  }

  function computeBounds(layout: {
    persons: Array<{ x: number; gen: number }>;
    unions: Array<{ x: number; gen: number }>;
  }): SubtreeBounds {
    let minX = Infinity;
    let maxX = -Infinity;
    const levels = new Map<number, { minX: number; maxX: number }>();

    for (const p of layout.persons) {
      const left = p.x - NODE_WIDTH / 2;
      const right = p.x + NODE_WIDTH / 2;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;

      const lvl = levels.get(p.gen) || { minX: Infinity, maxX: -Infinity };
      if (left < lvl.minX) lvl.minX = left;
      if (right > lvl.maxX) lvl.maxX = right;
      levels.set(p.gen, lvl);
    }

    for (const u of layout.unions) {
      const left = u.x - 20;
      const right = u.x + 20;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;

      const lvl = levels.get(u.gen) || { minX: Infinity, maxX: -Infinity };
      if (left < lvl.minX) lvl.minX = left;
      if (right > lvl.maxX) lvl.maxX = right;
      levels.set(u.gen, lvl);
    }

    return { minX, maxX, levels };
  }

  function shiftIntermediateLayout(layout: IntermediateLayout, dx: number) {
    if (dx === 0) return;
    for (const p of layout.persons) {
      p.x += dx;
    }
    for (const u of layout.unions) {
      u.x += dx;
    }
    for (const l of layout.links) {
      l.source.x += dx;
      l.target.x += dx;
    }
    layout.unionX += dx;
    layout.bounds.minX += dx;
    layout.bounds.maxX += dx;
    for (const lvl of layout.bounds.levels.values()) {
      lvl.minX += dx;
      lvl.maxX += dx;
    }
  }

  // Build intermediate subtree layout relative to reference 0
  function buildFamilySubtree(famId: string): IntermediateLayout | null {
    if (processedFamilies.has(famId)) return null;
    processedFamilies.add(famId);

    const fam = familyGroups.get(famId);
    if (!fam) return null;

    const gen = fam.husband
      ? personGen.get(fam.husband.id) ?? 0
      : fam.wife
      ? personGen.get(fam.wife.id) ?? 0
      : 0;

    const y = gen * GEN_HEIGHT;

    const layout: IntermediateLayout = {
      persons: [],
      unions: [],
      links: [],
      unionX: 0,
      bounds: { minX: 0, maxX: 0, levels: new Map() }
    };

    let husbandX = 0;
    let wifeX = 0;
    let unionX = 0;

    if (fam.husband && fam.wife) {
      husbandX = -SPOUSE_SPACING / 2;
      wifeX = SPOUSE_SPACING / 2;
      unionX = 0;

      layout.persons.push({
        id: fam.husband.id,
        x: husbandX,
        y,
        gen,
        data: toNodeData(fam.husband)
      });
      processedPersons.add(fam.husband.id);

      layout.persons.push({
        id: fam.wife.id,
        x: wifeX,
        y,
        gen,
        data: toNodeData(fam.wife)
      });
      processedPersons.add(fam.wife.id);

      layout.links.push({
        id: `marr-${fam.id}`,
        type: 'marriage',
        source: { x: husbandX, y },
        target: { x: wifeX, y }
      });
    } else if (fam.husband) {
      husbandX = 0;
      unionX = 0;
      layout.persons.push({
        id: fam.husband.id,
        x: husbandX,
        y,
        gen,
        data: toNodeData(fam.husband)
      });
      processedPersons.add(fam.husband.id);
    } else if (fam.wife) {
      wifeX = 0;
      unionX = 0;
      layout.persons.push({
        id: fam.wife.id,
        x: wifeX,
        y,
        gen,
        data: toNodeData(fam.wife)
      });
      processedPersons.add(fam.wife.id);
    }

    layout.unions.push({
      id: fam.id,
      x: unionX,
      y,
      gen,
      husbandId: fam.husband ? fam.husband.id : null,
      wifeId: fam.wife ? fam.wife.id : null,
      marriageDate: fam.marriageDate,
      marriagePlace: fam.marriagePlace
    });

    layout.unionX = unionX;

    // Check if any spouse has another unprocessed family with children (e.g. blended families)
    const spouses = [fam.husband, fam.wife].filter(Boolean) as RawPerson[];
    for (const spouse of spouses) {
      const spouseFams = (spouse.fams || []).filter((fId) => !processedFamilies.has(fId));
      for (const sFamId of spouseFams) {
        const sFam = familyGroups.get(sFamId);
        // If sFam has another spouse (e.g. another wife/husband), let it be processed as its own family unit
        if (!sFam || sFam.children.length === 0 || (sFam.husband && sFam.wife)) continue;

        processedFamilies.add(sFamId);
        const sX = spouse.id === fam.husband?.id ? husbandX : wifeX;

        layout.unions.push({
          id: sFam.id,
          x: sX,
          y,
          gen,
          husbandId: sFam.husband ? sFam.husband.id : null,
          wifeId: sFam.wife ? sFam.wife.id : null,
          marriageDate: sFam.marriageDate,
          marriagePlace: sFam.marriagePlace
        });

        const unvisitedSpouseChildren = sFam.children.filter((c) => !processedPersons.has(c.id));
        if (unvisitedSpouseChildren.length > 0) {
          const sChildLayouts: Array<{
            child: RawPerson;
            layout?: IntermediateLayout;
            standaloneX?: number;
            standaloneY?: number;
            gen: number;
            width: number;
          }> = [];

          for (const child of unvisitedSpouseChildren) {
            const childGen = personGen.get(child.id) ?? (gen + 1);
            const childFams = (child.fams || []).filter((fId) => !processedFamilies.has(fId));

            if (childFams.length > 0) {
              const sub = buildFamilySubtree(childFams[0]);
              if (sub) {
                const width = sub.bounds.maxX - sub.bounds.minX;
                sChildLayouts.push({ child, layout: sub, gen: childGen, width });
                continue;
              }
            }

            processedPersons.add(child.id);
            sChildLayouts.push({
              child,
              gen: childGen,
              width: NODE_WIDTH
            });
          }

          let curLeft = 0;
          for (let i = 0; i < sChildLayouts.length; i++) {
            const item = sChildLayouts[i];
            if (item.layout) {
              const dx = curLeft - item.layout.bounds.minX;
              shiftIntermediateLayout(item.layout, dx);
              curLeft = item.layout.bounds.maxX + NODE_GAP;
            } else {
              const cx = curLeft + NODE_WIDTH / 2;
              const cy = item.gen * GEN_HEIGHT;
              item.standaloneX = cx;
              item.standaloneY = cy;
              curLeft += NODE_WIDTH + NODE_GAP;
            }
          }

          const totalSpan = curLeft - NODE_GAP;
          const offset = sX - totalSpan / 2;

          for (const item of sChildLayouts) {
            if (item.layout) {
              shiftIntermediateLayout(item.layout, offset);

              for (const p of item.layout.persons) layout.persons.push(p);
              for (const u of item.layout.unions) layout.unions.push(u);
              for (const l of item.layout.links) layout.links.push(l);

              const childNode = item.layout.persons.find((p) => p.id === item.child.id);
              const targetX = childNode ? childNode.x : item.layout.unionX;
              const targetY = childNode ? childNode.y : item.gen * GEN_HEIGHT;

              layout.links.push({
                id: `child-${sFam.id}-${item.child.id}`,
                type: 'child',
                source: { x: sX, y },
                target: { x: targetX, y: targetY }
              });
            } else if (item.standaloneX !== undefined && item.standaloneY !== undefined) {
              const finalX = item.standaloneX + offset;
              const finalY = item.standaloneY;

              layout.persons.push({
                id: item.child.id,
                x: finalX,
                y: finalY,
                gen: item.gen,
                data: toNodeData(item.child)
              });

              layout.links.push({
                id: `child-${sFam.id}-${item.child.id}`,
                type: 'child',
                source: { x: sX, y },
                target: { x: finalX, y: finalY }
              });
            }
          }
        }
      }
    }

    const unvisitedChildren = fam.children.filter((c) => !processedPersons.has(c.id));

    if (unvisitedChildren.length > 0) {
      const childLayouts: Array<{
        child: RawPerson;
        layout?: IntermediateLayout;
        standaloneX?: number;
        standaloneY?: number;
        gen: number;
        width: number;
      }> = [];

      for (const child of unvisitedChildren) {
        const childGen = personGen.get(child.id) ?? (gen + 1);
        const childFams = (child.fams || []).filter((fId) => !processedFamilies.has(fId));

        if (childFams.length > 0) {
          const sub = buildFamilySubtree(childFams[0]);
          if (sub) {
            const width = sub.bounds.maxX - sub.bounds.minX;
            childLayouts.push({ child, layout: sub, gen: childGen, width });
            continue;
          }
        }

        // Standalone child without unprocessed families
        processedPersons.add(child.id);
        childLayouts.push({
          child,
          gen: childGen,
          width: NODE_WIDTH
        });
      }

      // Arrange child subtrees side by side with gap
      let currentChildLeft = 0;
      for (let i = 0; i < childLayouts.length; i++) {
        const item = childLayouts[i];
        if (item.layout) {
          // Align subtree so its bounds.minX matches currentChildLeft
          const dx = currentChildLeft - item.layout.bounds.minX;
          shiftIntermediateLayout(item.layout, dx);
          currentChildLeft = item.layout.bounds.maxX + NODE_GAP;
        } else {
          // Standalone child placed at currentChildLeft + NODE_WIDTH / 2
          const cx = currentChildLeft + NODE_WIDTH / 2;
          const cy = item.gen * GEN_HEIGHT;
          item.standaloneX = cx;
          item.standaloneY = cy;
          currentChildLeft += NODE_WIDTH + NODE_GAP;
        }
      }

      const totalChildrenSpan = currentChildLeft - NODE_GAP;
      // Center children block around unionX (which is currently 0)
      const childrenOffset = unionX - totalChildrenSpan / 2;

      for (const item of childLayouts) {
        if (item.layout) {
          shiftIntermediateLayout(item.layout, childrenOffset);

          // Merge into layout
          for (const p of item.layout.persons) layout.persons.push(p);
          for (const u of item.layout.unions) layout.unions.push(u);
          for (const l of item.layout.links) layout.links.push(l);

          const childNode = item.layout.persons.find((p) => p.id === item.child.id);
          const targetX = childNode ? childNode.x : item.layout.unionX;
          const targetY = childNode ? childNode.y : item.gen * GEN_HEIGHT;

          layout.links.push({
            id: `child-${fam.id}-${item.child.id}`,
            type: 'child',
            source: { x: unionX, y },
            target: { x: targetX, y: targetY }
          });
        } else if (item.standaloneX !== undefined && item.standaloneY !== undefined) {
          const finalX = item.standaloneX + childrenOffset;
          const finalY = item.standaloneY;

          layout.persons.push({
            id: item.child.id,
            x: finalX,
            y: finalY,
            gen: item.gen,
            data: toNodeData(item.child)
          });

          layout.links.push({
            id: `child-${fam.id}-${item.child.id}`,
            type: 'child',
            source: { x: unionX, y },
            target: { x: finalX, y: finalY }
          });
        }
      }
    }

    layout.bounds = computeBounds(layout);
    return layout;
  }

  function placeIntermediateLayout(layout: IntermediateLayout) {
    // Determine minimum shift required across all generations spanned by this subtree
    let requiredShift = 0;
    for (const [g, lvl] of layout.bounds.levels.entries()) {
      const maxOccupied = getLevelMaxX(g);
      if (maxOccupied !== -Infinity) {
        const needed = (maxOccupied + NODE_GAP) - lvl.minX;
        if (needed > requiredShift) {
          requiredShift = needed;
        }
      }
    }

    // Apply shift to layout
    shiftIntermediateLayout(layout, requiredShift);

    // Commit to global maps and update level occupied intervals
    for (const p of layout.persons) {
      placedPersons.set(p.id, {
        x: p.x,
        y: p.y,
        data: p.data
      });
      updateLevelMaxX(p.gen, p.x + NODE_WIDTH / 2);
    }

    for (const u of layout.unions) {
      placedUnions.set(u.id, {
        id: u.id,
        x: u.x,
        y: u.y,
        husbandId: u.husbandId,
        wifeId: u.wifeId,
        marriageDate: u.marriageDate,
        marriagePlace: u.marriagePlace
      });
      updateLevelMaxX(u.gen, u.x + 20);
    }

    for (const l of layout.links) {
      links.push(l);
    }
  }

  // Root families first
  const rootFamilies: string[] = [];
  for (const fam of normalizedFamList) {
    const h = fam.husbandId ? indMap.get(fam.husbandId) : null;
    const w = fam.wifeId ? indMap.get(fam.wifeId) : null;
    const hHasParents = h?.famc && h.famc.length > 0;
    const wHasParents = w?.famc && w.famc.length > 0;

    if (!hHasParents && !wHasParents) {
      rootFamilies.push(fam.id);
    }
  }

  // Sort root families so lowest generation comes first
  rootFamilies.sort((a, b) => {
    const famA = familyGroups.get(a);
    const famB = familyGroups.get(b);
    const genA = famA?.husband ? personGen.get(famA.husband.id) ?? 0 : 0;
    const genB = famB?.husband ? personGen.get(famB.husband.id) ?? 0 : 0;
    return genA - genB;
  });

  for (const famId of rootFamilies) {
    if (!processedFamilies.has(famId)) {
      const subtree = buildFamilySubtree(famId);
      if (subtree) {
        placeIntermediateLayout(subtree);
      }
    }
  }

  // Remaining families (cycles or disconnected branches)
  for (const fam of normalizedFamList) {
    if (!processedFamilies.has(fam.id)) {
      const subtree = buildFamilySubtree(fam.id);
      if (subtree) {
        placeIntermediateLayout(subtree);
      }
    }
  }

  // Standalone individuals with collision-free placement
  for (const ind of individuals) {
    if (!processedPersons.has(ind.id)) {
      const gen = personGen.get(ind.id) ?? 0;
      const prevMax = getLevelMaxX(gen);
      const startX = prevMax === -Infinity ? 0 : prevMax + NODE_GAP;
      const x = startX + NODE_WIDTH / 2;
      const y = gen * GEN_HEIGHT;

      placedPersons.set(ind.id, {
        x,
        y,
        data: toNodeData(ind)
      });
      processedPersons.add(ind.id);
      updateLevelMaxX(gen, x + NODE_WIDTH / 2);
    }
  }

  // A person placed as a spouse in an earlier-processed subtree never gets a
  // child link from their own parents' union — add any that are missing.
  for (const ind of individuals) {
    if (!ind.famc || ind.famc.length === 0) continue;
    const target = placedPersons.get(ind.id);
    if (!target) continue;
    for (const famcId of ind.famc) {
      const union = placedUnions.get(famcId);
      if (!union) continue;
      const linkId = `child-${famcId}-${ind.id}`;
      if (links.some((l) => l.id === linkId)) continue;
      links.push({
        id: linkId,
        type: 'child',
        source: { x: union.x, y: union.y },
        target: { x: target.x, y: target.y }
      });
    }
  }

  // Re-center all placed elements so minimum X is at a comfortable left margin
  let globalMinX = Infinity;
  for (const p of placedPersons.values()) {
    if (p.x - NODE_WIDTH / 2 < globalMinX) globalMinX = p.x - NODE_WIDTH / 2;
  }
  for (const u of placedUnions.values()) {
    if (u.x - 20 < globalMinX) globalMinX = u.x - 20;
  }

  const MARGIN_LEFT = 100;
  const globalOffset = globalMinX !== Infinity ? MARGIN_LEFT - globalMinX : 0;

  if (globalOffset !== 0) {
    for (const p of placedPersons.values()) {
      p.x += globalOffset;
    }
    for (const u of placedUnions.values()) {
      u.x += globalOffset;
    }
    for (const l of links) {
      l.source.x += globalOffset;
      l.target.x += globalOffset;
    }
  }

  const nodes = Array.from(placedPersons.values());
  const unionNodes = Array.from(placedUnions.values());

  return {
    nodes,
    unionNodes,
    links
  };
}
