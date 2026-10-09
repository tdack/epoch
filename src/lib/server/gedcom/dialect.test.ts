import { describe, expect, it } from 'vitest';
import { toGedcom551Lines, toGedcom7Lines } from './dialect';

describe('toGedcom7Lines', () => {
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

	it('doubles a leading @ in text, and leaves pointers and escaped text alone', () => {
		expect(
			toGedcom7Lines([
				'1 NOTE @handle on the forum',
				'2 CONT @@already escaped',
				'1 FAMC @F1@',
				'1 SNOTE @N1@',
				'0 @N1@ SNOTE text'
			])
		).toEqual([
			'1 NOTE @@handle on the forum',
			'2 CONT @@already escaped',
			'1 FAMC @F1@',
			'1 SNOTE @N1@',
			'0 @N1@ SNOTE text'
		]);
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
