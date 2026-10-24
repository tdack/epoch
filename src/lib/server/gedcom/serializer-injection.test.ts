/**
 * The serializer must never let a stored value forge a GEDCOM line. Every field that occupies one
 * line folds its terminators (`singleLine`); a tag is refused rather than folded, because `BIRT\n0
 * @X@ INDI` would otherwise read as a new record. A field that may span lines (`fieldLines`) starts
 * a `CONT` on every terminator instead. This sweeps a payload field by field and record key by
 * record key, injecting each terminator the serializer treats as a break into every string leaf and
 * asserting the output stays one line per record.
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

/**
 * Every terminator the serializer must not leave raw inside a line: the GEDCOM terminators (`\r`,
 * `\n`, `\r\n`) and the Unicode line separators, the same set `singleLine` folds and `LINE_BREAK`
 * splits.
 */
const INJECTIONS = [
	'x\ry\nz',
	'x\rz',
	'x\nz',
	'x\r\nz',
	'x\u2028z',
	'x\u2029z',
	'x\vz',
	'x\fz',
	'x\x85z',
	'x\x1cz',
	'x\x1dz',
	'x\x1ez'
];

// The C0 separators (`\x1c`–`\x1e`) are the point of the sweep, so the usual "hidden typo" the
// control-character rule guards against does not apply here.
// eslint-disable-next-line no-control-regex
const EMBEDDED_TERMINATOR = /[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]/;
const isClean = (out: string) => out.split('\r\n').every((line) => !EMBEDDED_TERMINATOR.test(line));
const recordLines = (out: string) => out.split('\r\n').filter((line) => /^0 /.test(line));
const pointerRecords = (out: string) => recordLines(out).filter((line) => /^0 @/.test(line));

const note: ExportNote = {
	pointer: null,
	text: 'note text',
	layout: { NOTE: ['2 NOTE note text'] },
	extra: ['3 _NOTE x']
};
/** A note written as a pointer with a `pointerTag`: the tag is a token, folded if it carries a break. */
const pointedNote: ExportNote = { pointer: '@N2@', pointerTag: 'SNOTE' };
/** A note written as a pointer only, with no text: the branch an inline note never reaches. */
const pointerOnlyNote: ExportNote = { pointer: '@N3@' };
const citation: ExportCitation = {
	pointer: '@S1@',
	description: 'inline description',
	page: 'p 1',
	quality: 2,
	entryDate: '1 JAN 1900',
	text: 'citation text',
	layout: { PAGE: ['3 PAGE p 1'] },
	extra: ['3 _CIT x'],
	notes: [note, pointedNote, pointerOnlyNote]
};
/** A citation with no pointer: it carries its text inline, the branch a pointer never reaches. */
const inlineCitation: ExportCitation = {
	pointer: null,
	description: 'inline description',
	page: 'p 1',
	text: 'citation text',
	extra: ['3 _CIT x'],
	notes: [note]
};
/** A citation with no pointer and no description: a bare `SOUR` line. */
const bareCitation: ExportCitation = { pointer: null, extra: ['3 _CIT x'] };

/**
 * Every fact detail, so the sweep reaches the lines they are written as. The address layout is a
 * file's own lines, which the serializer checks against the address before writing them.
 */
const eventDetails = {
	classification: 'Civil',
	address: 'addr',
	addressLayout: ['2 ADDR addr', '3 CITY city'],
	agency: 'agency',
	phone: 'p1\np2',
	email: 'e@example.org',
	fax: 'f',
	web: 'w',
	latitude: 'N1',
	longitude: 'E1',
	placeExtra: ['3 FORM form', '3 MAP', '4 LATI N2'],
	religion: 'r'
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
						noteLinks: [note],
						...eventDetails
					}
				],
				citations: [citation, inlineCitation, bareCitation],
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
						noteLinks: [note],
						...eventDetails
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

/** A string leaf to replace. */
interface ValueTarget {
	kind: 'value';
	path: Path;
}
/** A map key to rename, where the key itself is data (an interpolated pointer). */
interface KeyTarget {
	kind: 'key';
	at: Path;
	key: string;
}
type Target = ValueTarget | KeyTarget;

/** A target as a human-readable path, for the test name. */
const label = (target: Target) =>
	target.kind === 'key' ? `key ${target.key} of ${target.at.join('.')}` : target.path.join('.');

/** Every string leaf in the payload, as a path, so a sweep can visit each field. */
function valueTargets(value: unknown, prefix: Path = []): ValueTarget[] {
	if (typeof value === 'string') return [{ kind: 'value', path: prefix }];
	if (Array.isArray(value)) return value.flatMap((v, i) => valueTargets(v, [...prefix, i]));
	if (value && typeof value === 'object')
		return Object.entries(value).flatMap(([k, v]) => valueTargets(v, [...prefix, k]));
	return [];
}

/** A map whose keys are all pointers and whose values are all strings: its keys are interpolated. */
const isPointerMap = (entries: Array<[string, unknown]>) =>
	entries.length > 0 && entries.every(([k, v]) => /^@[^@\s]+@$/.test(k) && typeof v === 'string');

/** Every key of a pointer map (`parentPedigrees`), which code writes as an interpolated pointer. */
function keyTargets(value: unknown, prefix: Path = []): KeyTarget[] {
	if (Array.isArray(value)) return value.flatMap((v, i) => keyTargets(v, [...prefix, i]));
	if (!value || typeof value !== 'object') return [];
	const entries = Object.entries(value);
	return entries.flatMap(([k, v]) => [
		...keyTargets(v, [...prefix, k]),
		...(isPointerMap(entries) ? [{ kind: 'key' as const, at: prefix, key: k }] : [])
	]);
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

/** A deep copy with the key `key` renamed to `value` in the object at `at`. */
function withRenamedKey<T>(base: T, at: Path, key: string, value: string): T {
	const clone = structuredClone(base);
	let cursor = clone as Record<string | number, unknown>;
	for (const step of at) cursor = cursor[step] as Record<string | number, unknown>;
	const entries = Object.entries(cursor);
	for (const existing of Object.keys(cursor)) delete cursor[existing];
	for (const [k, v] of entries) cursor[k === key ? value : k] = v;
	return clone;
}

/** The payload with `target` replaced by `value`. */
const inject = <T>(base: T, target: Target, value: string): T =>
	target.kind === 'key'
		? withRenamedKey(base, target.at, target.key, value)
		: withInjected(base, target.path, value);

/** An event's `type` is a tag, not text: the serializer refuses it rather than folding it. */
const isEventTypePath = (target: Target) =>
	target.kind === 'value' && target.path.includes('events') && target.path.at(-1) === 'type';
/** Preserved entries are whole lines, not single-line fields; a corrupt root header is not a field. */
const isPreservedPath = (target: Target) =>
	(target.kind === 'key' ? target.at : target.path)[0] === 'preserved';

const base = fixture();
const targets: Target[] = [...valueTargets(base), ...keyTargets(base)];
const baseCount = recordLines(buildGedcom551String(base)).length;
const basePointerCount = pointerRecords(buildGedcom551String(base)).length;

describe('no payload field can forge a GEDCOM line', () => {
	it.each(['classification', 'agency', 'phone', 'address', 'religion'] as const)(
		'keeps a record from being forged through %s',
		(field) => {
			const event = base.individuals[0]!.events![0]!;
			const mutated = {
				...base,
				individuals: [{ ...base.individuals[0]!, events: [{ ...event, [field]: 'x\n0 @X@ INDI' }] }]
			};
			for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
				expect(recordLines(out)).toHaveLength(baseCount);
				expect(out.split('\r\n')).not.toContain('0 @X@ INDI');
			}
		}
	);

	it('serializes the untouched fixture cleanly in both formats', () => {
		for (const out of [buildGedcom551String(base), buildGedcom7String(base)]) {
			expect(isClean(out)).toBe(true);
		}
	});

	it.each(targets.map((target) => [label(target), target] as [string, Target]))(
		'folds or refuses a terminator injected at %s',
		(_label, target) => {
			for (const injectedValue of INJECTIONS) {
				const mutated = inject(base, target, injectedValue);
				if (isEventTypePath(target)) {
					expect(() => buildGedcom551String(mutated)).toThrow(ValidationError);
					expect(() => buildGedcom7String(mutated)).toThrow(ValidationError);
					continue;
				}
				for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
					expect(isClean(out)).toBe(true);
					if (!isPreservedPath(target)) {
						expect(recordLines(out)).toHaveLength(baseCount);
						// Never an *extra* `0 @…@` record. Folding a pointer can cost its `@` (the
						// record stays, its xref changes), so the count may fall, never rise.
						expect(pointerRecords(out).length).toBeLessThanOrEqual(basePointerCount);
					}
				}
			}
		}
	);

	it('stays clean when every text field carries terminators at once', () => {
		let mutated = fixture();
		for (const target of [...valueTargets(mutated), ...keyTargets(mutated)]) {
			if (isEventTypePath(target) || isPreservedPath(target)) continue;
			mutated = inject(mutated, target, 'x\ry\n\u2028z');
		}
		for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
			expect(isClean(out)).toBe(true);
			expect(recordLines(out)).toHaveLength(baseCount);
			expect(pointerRecords(out).length).toBeLessThanOrEqual(basePointerCount);
		}
	});

	it.each<[string, { placeExtra?: string[]; addressLayout?: string[]; dateExtra?: string[] }]>([
		['placeExtra', { placeExtra: ['3 FORM form', '0 @X@ INDI', '1 DEAT', '2 FONE f'] }],
		['dateExtra', { dateExtra: ['3 TIME 10:30', '0 @X@ INDI', '1 DEAT', '2 FONE f'] }],
		['addressLayout', { addressLayout: ['2 ADDR addr', '1 DEAT', '0 @X@ INDI', '3 CITY city'] }]
	])('keeps a stored %s line from rising above its structure', (_field, detail) => {
		const event = base.individuals[0]!.events![0]!;
		const mutated = {
			...base,
			individuals: [{ ...base.individuals[0]!, events: [{ ...event, ...detail }] }]
		};
		for (const out of [buildGedcom551String(mutated), buildGedcom7String(mutated)]) {
			const outLines = out.split('\r\n');
			expect(recordLines(out)).toHaveLength(baseCount);
			expect(outLines).not.toContain('0 @X@ INDI');
			expect(outLines).not.toContain('1 DEAT');
			expect(outLines).not.toContain('2 FONE f');
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

describe('a stray segment is normalized on export, not dropped', () => {
	it('writes a non-GEDCOM line as the preceding line’s CONT', async () => {
		// `buildGedcomTree` keeps a line that is not `level tag` as the previous line's text; the
		// exporter must write that text back as a `CONT` rather than drop it or forge a record.
		const treeId = crypto.randomUUID();
		const stray = 'a stray line with no level';
		const raw = [
			'0 HEAD',
			'1 GEDC',
			'2 VERS 5.5.1',
			'0 @I1@ INDI',
			'1 NAME Ann /Ash/',
			'1 NOTE first',
			stray,
			'0 TRLR'
		].join('\r\n');
		await importGedcomToDb(t.d1, treeId, raw, 'Stray');
		for (const format of [buildGedcom551String, buildGedcom7String]) {
			const lines = format(await getTreeExportData(t.d1, treeId)).split('\r\n');
			expect(lines).toContain('1 NOTE first');
			expect(lines).toContain(`2 CONT ${stray}`);
		}
	});
});

describe('a Unicode line separator normalizes on export', () => {
	it('splits a separator inside imported text into a CONT, as a CR does', async () => {
		const treeId = crypto.randomUUID();
		const raw = [
			'0 HEAD',
			'1 GEDC',
			'2 VERS 5.5.1',
			'0 @I1@ INDI',
			'1 NAME Ann /Ash/',
			'1 NOTE first\u2028second',
			'0 TRLR'
		].join('\r\n');
		await importGedcomToDb(t.d1, treeId, raw, 'Separator');
		for (const format of [buildGedcom551String, buildGedcom7String]) {
			const out = format(await getTreeExportData(t.d1, treeId));
			expect(isClean(out)).toBe(true);
			expect(out.split('\r\n')).toContain('2 CONT second');
		}
	});
});
