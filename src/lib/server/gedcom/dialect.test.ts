import { describe, expect, it } from 'vitest';
import { toGedcom551Lines, toGedcom7Lines } from './dialect';

describe('toGedcom7Lines', () => {
	it('leaves a line with an absurd level alone rather than throw', () => {
		expect(toGedcom7Lines(['1 BIRT', '99999999999 FOO x'])).toEqual([
			'1 BIRT',
			'99999999999 FOO x'
		]);
	});

	it('folds CONC into the line it continues, or the CONT before it', () => {
		expect(
			toGedcom7Lines([
				'1 NOTE Begun',
				'2 CONC  and continued',
				'2 CONT next line',
				'2 CONC  continued too',
				'2 SOUR @S1@'
			])
		).toEqual(['1 NOTE Begun and continued', '2 CONT next line continued too', '2 SOUR @S1@']);
	});

	it('converts a DATE and writes the PHRASE under it', () => {
		expect(toGedcom7Lines(['1 BIRT', '2 DATE 30 JAN 1648/49', '2 PLAC Here'])).toEqual([
			'1 BIRT',
			'2 DATE 30 JAN 1649',
			'3 PHRASE 30 JAN 1648/49',
			'2 PLAC Here'
		]);
		expect(toGedcom7Lines(['2 DATE Spring 1900'])).toEqual(['2 DATE', '3 PHRASE Spring 1900']);
	});

	it('writes the 5.5.1 structures 7.0 renamed in their 7.0 form', () => {
		expect(
			toGedcom7Lines([
				'0 @M1@ OBJE',
				'1 FILE faces/a.jpg',
				'2 FORM jpeg',
				'3 TYPE photo',
				'1 FILE scans/b.pdf',
				'2 FORM PDF',
				'3 TYPE certificate',
				'0 @I1@ INDI',
				'1 ASSO @I2@',
				'2 RELA Godfather',
				'1 FAMC @F1@',
				'2 STAT challenged',
				'1 RESN privacy'
			])
		).toEqual([
			'0 @M1@ OBJE',
			'1 FILE faces/a.jpg',
			'2 FORM image/jpeg',
			'3 MEDI PHOTO',
			'1 FILE scans/b.pdf',
			'2 FORM application/pdf',
			'3 MEDI OTHER',
			'4 PHRASE certificate',
			'0 @I1@ INDI',
			'1 ASSO @I2@',
			'2 ROLE OTHER',
			'3 PHRASE Godfather',
			'1 FAMC @F1@',
			'2 STAT CHALLENGED',
			'1 RESN PRIVACY'
		]);
	});

	it("leaves a 7.0 file's structures as they are", () => {
		const lines = ['1 FILE a.png', '2 FORM image/png', '3 MEDI PHOTO', '2 TYPE Award'];
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});

	it('leaves other lines as they were', () => {
		const lines = ['0 @I1@ INDI', '1 NAME Ann /Ash/', '2 CONT', '1 _CUSTOM  spaced'];
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});
});

describe('toGedcom551Lines', () => {
	it('writes a 7.0 calendar as its 5.5.1 escape', () => {
		expect(toGedcom551Lines(['2 DATE JULIAN 1 JAN 1700', '2 PLAC JULIAN'])).toEqual([
			'2 DATE @#DJULIAN@ 1 JAN 1700',
			'2 PLAC JULIAN'
		]);
	});
});
