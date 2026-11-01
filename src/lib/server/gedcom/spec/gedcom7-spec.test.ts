import { describe, expect, it } from 'vitest';
import { GEDCOM7_SPEC_RELEASE } from './gedcom7-spec';
import {
	calendarOf,
	enumValues,
	isEnumValue,
	rootOf,
	structureByUri,
	substructureOf
} from './lookup';

const V7 = 'https://gedcom.io/terms/v7/';

describe('GEDCOM 7 spec table', () => {
	it('is pinned to a 7.0.x release tag', () => {
		expect(GEDCOM7_SPEC_RELEASE.tag).toMatch(/^v7\.0\.\d+$/);
		expect(GEDCOM7_SPEC_RELEASE.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	it('allows INDI NAME zero or more times', () => {
		expect(substructureOf(`${V7}record-INDI`, 'NAME')).toEqual({
			uri: `${V7}INDI-NAME`,
			min: 0,
			max: null
		});
	});

	it('requires HEAD.GEDC exactly once and GEDC.VERS exactly once', () => {
		expect(substructureOf(`${V7}HEAD`, 'GEDC')).toMatchObject({ min: 1, max: 1 });
		expect(substructureOf(`${V7}GEDC`, 'VERS')).toMatchObject({ min: 1, max: 1 });
	});

	it('rejects a tag the spec does not allow in that context', () => {
		expect(substructureOf(`${V7}record-INDI`, 'HUSB')).toBeUndefined();
		expect(substructureOf(`${V7}record-INDI`, 'constructor')).toBeUndefined();
		expect(substructureOf(`${V7}no-such-structure`, 'NAME')).toBeUndefined();
	});

	it('resolves the same tag to different structure types by context', () => {
		expect(substructureOf(`${V7}record-FAM`, 'HUSB')?.uri).toBe(`${V7}FAM-HUSB`);
		expect(substructureOf(`${V7}HEAD`, 'DATE')?.uri).toBe(`${V7}HEAD-DATE`);
	});

	it('lists the SEX enumeration values', () => {
		const sex = structureByUri(`${V7}SEX`);
		expect(sex?.payload).toEqual({ kind: 'enum', enumSet: `${V7}enumset-SEX` });
		expect([...(enumValues(`${V7}enumset-SEX`) ?? [])].sort()).toEqual(['F', 'M', 'U', 'X']);
		expect(isEnumValue(`${V7}enumset-SEX`, 'Q')).toBe(false);
	});

	it('lists the RESN values as a list-valued enumeration', () => {
		expect(structureByUri(`${V7}RESN`)?.payload).toEqual({
			kind: 'listEnum',
			enumSet: `${V7}enumset-RESN`
		});
		expect([...(enumValues(`${V7}enumset-RESN`) ?? [])].sort()).toEqual([
			'CONFIDENTIAL',
			'LOCKED',
			'PRIVACY'
		]);
	});

	it('describes payload types', () => {
		expect(structureByUri(`${V7}record-INDI`)?.payload).toEqual({ kind: 'none' });
		expect(structureByUri(`${V7}BIRT`)?.payload).toEqual({ kind: 'yOrNull' });
		expect(structureByUri(`${V7}FAMC`)?.payload).toEqual({
			kind: 'pointer',
			target: `${V7}record-FAM`
		});
		expect(structureByUri(`${V7}AGE`)?.payload).toEqual({ kind: 'age' });
	});

	it('knows the level-0 structures', () => {
		expect(rootOf('HEAD')).toMatchObject({ uri: `${V7}HEAD`, min: 1, max: 1 });
		expect(rootOf('TRLR')).toMatchObject({ min: 1, max: 1 });
		expect(rootOf('INDI')).toMatchObject({ uri: `${V7}record-INDI`, min: 0, max: null });
		expect(rootOf('CONT')).toBeUndefined();
	});

	it('lists calendar months', () => {
		expect(calendarOf('GREGORIAN')?.months).toHaveLength(12);
		expect(calendarOf('HEBREW')?.months).toContain('ADS');
	});
});
