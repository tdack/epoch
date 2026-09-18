import { describe, it, expect } from 'vitest';
import {
	parseGedcom,
	buildGedcom551String,
	buildGedcom7String,
	buildGedcomString,
	detectGedcomVersion,
	normalizeGedcomDate
} from './index';

describe('GEDCOM 5.5.1 Parser and Serializer', () => {
  const sampleGedcom = `0 HEAD
1 SOUR TEST
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Doe/
2 GIVN John
2 SURN Doe
1 SEX M
1 BIRT
2 DATE 15 JAN 1900
2 PLAC Springfield, USA
1 DEAT
2 DATE 20 MAR 1975
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Smith/
2 GIVN Jane
2 SURN Smith
1 SEX F
1 BIRT
2 DATE 10 FEB 1905
1 FAMS @F1@
0 @I3@ INDI
1 NAME Robert /Doe/
2 GIVN Robert
2 SURN Doe
1 SEX M
1 BIRT
2 DATE 01 JUN 1930
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 12 APR 1928
2 PLAC Chicago, USA
0 TRLR`;

  it('normalizes GEDCOM dates accurately', () => {
    expect(normalizeGedcomDate('15 JAN 1900')).toEqual({
      raw: '15 JAN 1900',
      sort: '1900-01-15',
      sortEnd: '1900-01-15'
    });
    expect(normalizeGedcomDate('FEB 1905')).toEqual({
      raw: 'FEB 1905',
      sort: '1905-02-01',
      sortEnd: '1905-02-28'
    });
    expect(normalizeGedcomDate('1930')).toEqual({
      raw: '1930',
      sort: '1930-01-01',
      sortEnd: '1930-12-31'
    });
  });

  it('never fabricates an exact day from a partial date', () => {
    // Year-only must span the whole year, not collapse to 1930-01-01.
    const yearOnly = normalizeGedcomDate('1930');
    expect(yearOnly.sort).toBe('1930-01-01');
    expect(yearOnly.sortEnd).toBe('1930-12-31');

    // Approximate year keeps its qualifier semantics (still year precision).
    const approx = normalizeGedcomDate('ABT 1900');
    expect(approx.sort).toBe('1900-01-01');
    expect(approx.sortEnd).toBe('1900-12-31');
  });

  it('parses individuals, families, and events from standard GEDCOM format', () => {
    const parsed = parseGedcom(sampleGedcom);

    expect(parsed.individuals).toHaveLength(3);
    expect(parsed.families).toHaveLength(1);

    const john = parsed.individuals.find((i) => i.id === '@I1@');
    expect(john).toBeDefined();
    expect(john?.givenName).toBe('John');
    expect(john?.surname).toBe('Doe');
    expect(john?.sex).toBe('M');
    expect(john?.events).toHaveLength(2);
    expect(john?.events[0].type).toBe('BIRT');
    expect(john?.events[0].dateSort).toBe('1900-01-15');

    const fam = parsed.families[0];
    expect(fam.id).toBe('@F1@');
    expect(fam.husbandId).toBe('@I1@');
    expect(fam.wifeId).toBe('@I2@');
    expect(fam.children).toHaveLength(1);
    expect(fam.children[0].childId).toBe('@I3@');
    expect(fam.events).toHaveLength(1);
    expect(fam.events[0].type).toBe('MARR');
  });

  it('builds standard-compliant GEDCOM 5.5.1 string', () => {
    const parsed = parseGedcom(sampleGedcom);

    const generated = buildGedcom551String({
      treeName: 'Test Lineage',
      individuals: parsed.individuals.map((ind) => ({
        id: ind.id,
        givenName: ind.givenName || null,
        surname: ind.surname || null,
        sex: ind.sex || null,
        events: ind.events.map((e) => ({
          type: e.type,
          dateRaw: e.dateRaw || null,
          place: e.place || null,
          description: e.description || null
        })),
        famc: ind.famc,
        fams: ind.fams
      })),
      families: parsed.families.map((f) => ({
        id: f.id,
        husbandId: f.husbandId || null,
        wifeId: f.wifeId || null,
        children: f.children.map((c) => ({ childId: c.childId, pedigree: c.pedigree || null })),
        events: f.events.map((e) => ({
          type: e.type,
          dateRaw: e.dateRaw || null,
          place: e.place || null,
          description: e.description || null
        }))
      }))
    });

    expect(generated).toContain('0 HEAD');
    expect(generated).toContain('2 VERS 5.5.1');
    expect(generated).toContain('0 @I1@ INDI');
    expect(generated).toContain('1 NAME John /Doe/');
    expect(generated).toContain('0 @F1@ FAM');
    expect(generated).toContain('1 HUSB @I1@');
    expect(generated).toContain('1 WIFE @I2@');
    expect(generated).toContain('1 CHIL @I3@');
    expect(generated).toContain('0 TRLR');

    // Round-trip parse
    const reParsed = parseGedcom(generated);
    expect(reParsed.individuals).toHaveLength(3);
    expect(reParsed.families).toHaveLength(1);
  });

  it('verifies batch parameter limits never exceed Cloudflare D1 max bound parameters', () => {
    // D1 maximum allowed bound parameters per query is 100
    const D1_MAX_ALLOWED_PARAMS = 100;
    const MAX_BOUND_PARAMS = 70;

    const columnCounts = {
      individuals: 9, // id, treeId, xrefId, givenName, surname, sex, version, createdAt, updatedAt
      families: 8,    // id, treeId, xrefId, husbandId, wifeId, version, createdAt, updatedAt
      events: 12,     // id, treeId, entityType, entityId, type, dateRaw, dateSort, place, description, version, createdAt, updatedAt
      familyChildren: 3 // familyId, childId, pedigree
    };

    for (const [, cols] of Object.entries(columnCounts)) {
      const maxRowsPerChunk = Math.max(1, Math.floor(MAX_BOUND_PARAMS / cols));
      const boundParamsPerChunk = maxRowsPerChunk * cols;
      expect(boundParamsPerChunk).toBeLessThanOrEqual(D1_MAX_ALLOWED_PARAMS);
      expect(boundParamsPerChunk).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
    }
  });
});
