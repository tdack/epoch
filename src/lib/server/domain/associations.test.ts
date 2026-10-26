import { describe, expect, it } from 'vitest';
import { associationsIn } from './associations';

describe('associationsIn', () => {
	it('reads a 5.5.1 person-level association and its RELA', () => {
		expect(associationsIn(['1 ASSO @I5@', '2 RELA friend'])).toEqual([
			{ pointer: '@I5@', role: 'friend' }
		]);
	});

	it("reads every association in a fact's kept lines, webtrees' _ASSO included", () => {
		expect(
			associationsIn([
				'2 ASSO @I1@',
				'3 RELA godfather',
				'2 _ASSO @I2@',
				'3 RELA godmother',
				'3 NOTE kept, not a role',
				'2 _CUSTOM other'
			])
		).toEqual([
			{ pointer: '@I1@', role: 'godfather' },
			{ pointer: '@I2@', role: 'godmother' }
		]);
	});

	it("reads GEDCOM 7's ROLE, preferring its PHRASE", () => {
		expect(
			associationsIn([
				'1 ASSO @I1@',
				'2 ROLE WITN',
				'1 ASSO @I2@',
				'2 ROLE OTHER',
				'3 PHRASE Informant'
			])
		).toEqual([
			{ pointer: '@I1@', role: 'witness' },
			{ pointer: '@I2@', role: 'Informant' }
		]);
	});

	it('has no role when the file gives none, and skips what points at nobody', () => {
		expect(associationsIn(['1 ASSO @I1@', '1 ASSO @VOID@', '1 ASSO @@I2@', '1 ASSO text'])).toEqual(
			[{ pointer: '@I1@', role: null }]
		);
		expect(associationsIn(['1 CHAN', '2 DATE 1 JAN 2000'])).toEqual([]);
	});
});
