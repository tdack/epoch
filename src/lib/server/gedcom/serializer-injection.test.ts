/**
 * The serializer must never let a stored value forge a GEDCOM line. Every field that occupies one
 * line folds its terminators (`singleLine`); a tag is refused rather than folded, because `BIRT\n0
 * @X@ INDI` would otherwise read as a new record. This sweeps a payload field by field, injecting a
 * terminator into each and asserting the output stays one line per record.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import EVIDENCE from './fixtures/evidence.ged?raw';
import { parseGedcom } from './parser';
import {
	buildGedcom551String,
	buildGedcom7String,
	type ExportCitation,
	type ExportNote,
	type GedcomExportPayload
} from './serializer';

/** A terminator that splits into a bare second line if it ever reaches the output. */
const INJECTIONS = ['x\ry\nz', 'x\rz', 'x\nz'];

const EMBEDDED_TERMINATOR = /[\r\n\u2028\u2029]/;
const isClean = (out: string) => out.split('\r\n').every((line) => !EMBEDDED_TERMINATOR.test(line));
const recordLines = (out: string) => out.split('\r\n').filter((line) => /^0 /.test(line));

const note: ExportNote = {
	pointer: null,
	text: 'note text',
	layout: { NOTE: ['2 NOTE note text'] },
	extra: ['3 _NOTE x']
};
const citation: ExportCitation = {
	pointer: '@S1@',
	description: 'inline description',
	page: 'p 1',
	quality: 2,
	entryDate: '1 JAN 1900',
	text: 'citation text',
	layout: { PAGE: ['3 PAGE p 1'] },
	extra: ['3 _CIT x'],
	notes: [note]
};

/** A payload that uses every field the serializer interpolates, so a sweep touches them all. */
function fixture(): GedcomExportPayload & { treeName: string } {
	return {
		treeName: 'Test Tree',
		individuals: [
			{
				id: '@I1@',
				givenName: 'Ann',
				surname: 'Ash',
				sex: 'F',
				privacy: 'private',
				names: [
					{
						type: 'birth',
						gedcomType: null,
						givenName: 'Ann',
						surname: 'Ash',
						prefix: 'Dr',
						suffix: 'Jr',
						nickname: 'Annie',
						surnamePrefix: 'van',
						dateText: '1900',
						unionXref: '@F1@',
						extra: ['2 _NM extra'],
						citations: [citation],
						notes: [note]
					},
					{ type: 'other', gedcomType: 'nickname', givenName: 'A', surname: 'B' }
				],
				events: [
					{
						type: 'BIRT',
						dateRaw: '1 JAN 1900',
						place: 'York',
						description: 'a legacy description',
						value: 'Carpenter',
						cause: 'old age',
						age: '80y',
						notes: 'a fact note',
						gedcomExtra: ['2 _EV x'],
						citations: [citation],
						noteLinks: [note]
					}
				],
				citations: [citation],
				notes: [note],
				famc: ['@F1@'],
				fams: ['@F1@']
			}
		],
		families: [
			{
				id: '@F1@',
				husbandId: '@I1@',
				wifeId: '@I2@',
				children: [
					{
						childId: '@I1@',
						pedigree: 'adopted',
						parentPedigrees: { '@I2@': 'foster' },
						citations: [citation],
						notes: [note]
					}
				],
				aliases: ['@F2@'],
				events: [
					{
						type: 'MARR',
						dateRaw: '1925',
						place: 'York',
						description: 'a family note',
						gedcomExtra: ['2 _FE y'],
						citations: [citation],
						noteLinks: [note]
					}
				],
				citations: [citation],
				notes: [note]
			}
		],
		sources: [
			{
				xref: '@S1@',
				title: 'Title',
				author: 'Author',
				publication: 'Pub',
				abbreviation: 'Abbr',
				text: 'Text',
				extra: ['1 _SRC x'],
				notes: [note],
				repositories: [{ pointer: '@R1@', callNumber: '123', extra: ['3 _CALN x'] }]
			}
		],
		repositories: [{ xref: '@R1@', name: 'Repo', address: '1 High St', extra: ['1 _REPO x'] }],
		notes: [
			{
				xref: '@N1@',
				tag: 'SNOTE',
				text: 'Shared',
				mime: 'text/plain',
				language: 'en',
				extra: ['1 _NOTE x']
			}
		],
		preserved: [
			{ xref: '@I1@', lines: ['1 FAMC @F1@', '2 _KEPT x'] },
			{ xref: null, lines: ['0 @M1@ OBJE', '1 FILE a.png'] }
		]
	};
}

type Path = Array<string | number>;

/** Every string leaf in the payload, as a path, so a sweep can visit each field. */
function stringPaths(value: unknown, prefix: Path = []): Path[] {
	if (typeof value === 'string') return [prefix];
	if (Array.isArray(value)) return value.flatMap((v, i) => stringPaths(v, [...prefix, i]));
	if (value && typeof value === 'object')
		return Object.entries(value).flatMap(([k, v]) => stringPaths(v, [...prefix, k]));
	return [];
}

/** A deep copy with the string at `path` replaced. */
function withInjected<T>(base: T, path: Path, value: string): T {
	const clone = structuredClone(base);
	let cursor = clone as Record<string | number, unknown>;
	for (let i = 0; i < path.length - 1; i++)
		cursor = cursor[path[i]] as Record<string | number, unknown>;
	cursor[path[path.length - 1]] = value;
	return clone;
}

/** An event's `type` is a tag, not text: the serializer refuses it rather than folding it. */
const isEventTypePath = (path: Path) => path.includes('events') && path.at(-1) === 'type';
/** Preserved entries are whole lines, not single-line fields; a corrupt root header is not a field. */
const isPreservedPath = (path: Path) => path[0] === 'preserved';

const base = fixture();
const baseCount = recordLines(buildGedcom551String(base)).length;

describe('no payload field can forge a GEDCOM line', () => {
	it('serializes the untouched fixture cleanly in both formats', () => {
		for (const out of [buildGedcom551String(base), buildGedcom7String(base)]) {
			expect(isClean(out)).toBe(true);
		}
	});

	it.each(stringPaths(base).map((path) => [path]))(
		'folds or refuses a terminator injected at %j',
		(path) => {
			for (const injectedValue of INJECTIONS) {
				const mutated = withInjected(base, path, injectedValue);
				if (isEventTypePath(path)) {
					expect(() => buildGedcom551String(mutated)).toThrow(ValidationError);
					expect(() => buildGedcom7String(mutated)).toThrow(ValidationError);
					continue;
				}
				for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
					expect(isClean(out)).toBe(true);
					if (!isPreservedPath(path)) expect(recordLines(out)).toHaveLength(baseCount);
				}
			}
		}
	);

	it('stays clean when every text field carries a terminator at once', () => {
		let mutated = fixture();
		for (const path of stringPaths(mutated)) {
			if (isEventTypePath(path) || isPreservedPath(path)) continue;
			mutated = withInjected(mutated, path, 'x\ry\nz');
		}
		for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
			expect(isClean(out)).toBe(true);
			expect(recordLines(out)).toHaveLength(baseCount);
		}
	});
});

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

describe('a file with a lone CR round-trips', () => {
	it('parses a CR-only file exactly as the LF one', () => {
		expect(parseGedcom(EVIDENCE.replace(/\n/g, '\r'))).toEqual(parseGedcom(EVIDENCE));
	});

	it('imports and exports a CR-only file to the same bytes as the LF one', async () => {
		const lf = crypto.randomUUID();
		const cr = crypto.randomUUID();
		await importGedcomToDb(t.d1, lf, EVIDENCE, 'CR');
		await importGedcomToDb(t.d1, cr, EVIDENCE.replace(/\n/g, '\r'), 'CR');
		for (const format of [buildGedcom551String, buildGedcom7String]) {
			const fromLf = format(await getTreeExportData(t.d1, lf));
			const fromCr = format(await getTreeExportData(t.d1, cr));
			expect(isClean(fromCr)).toBe(true);
			expect(fromCr).toEqual(fromLf);
		}
	});
});
