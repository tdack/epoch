/**
 * Escaping model text at build time. Only the model's own text is escaped (a leading `@` doubled so
 * it cannot read back as a pointer); a pointer, a tag, a `DATE` and a line kept verbatim from an
 * imported file are left exactly as they are. The former dialect-level post-pass over every line
 * could not tell those apart.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/d1';
import { getTreeExportData, importGedcomToDb } from '../testing/gedcom';
import { escapedSingleLine, escapeText, fieldLines } from './evidence-lines';
import { parseGedcom } from './parser';
import { buildGedcom551String, buildGedcom7String, type GedcomExportPayload } from './serializer';

describe('escapeText', () => {
	it('doubles a leading @, even one already doubled', () => {
		expect(escapeText('@handle')).toBe('@@handle');
		expect(escapeText('@@foo')).toBe('@@@foo');
	});

	it('leaves text that does not start with @ alone, and drops a banned code point', () => {
		expect(escapeText('plain')).toBe('plain');
		expect(escapeText('a@b')).toBe('a@b');
		expect(escapeText('a\x01b')).toBe('ab');
	});

	it('folds terminators, then escapes, for a single-line field', () => {
		expect(escapedSingleLine('@a\nb')).toBe('@@a b');
	});
});

describe('textLines escapes every line, including each CONT', () => {
	it('escapes the first line and every CONT', () => {
		expect(fieldLines(1, 'NOTE', '@a\n@b')).toEqual(['1 NOTE @@a', '2 CONT @@b']);
	});

	it('replays the file’s own lines byte-identically when they still say the text', () => {
		expect(fieldLines(1, 'NOTE', '@handle', ['1 NOTE @@handle'])).toEqual(['1 NOTE @@handle']);
	});

	it('escapes a lone leading @ in the replayed layout, leaving the split alone', () => {
		expect(fieldLines(1, 'NOTE', '@a\n@b', ['1 NOTE @a', '2 CONT @b'])).toEqual([
			'1 NOTE @@a',
			'2 CONT @@b'
		]);
	});
});

describe('DATE payloads are the date dialect’s and are never escaped', () => {
	const withDate = (dateRaw: string): GedcomExportPayload => ({
		individuals: [
			{
				id: '@I1@',
				givenName: 'A',
				surname: 'B',
				sex: 'F',
				events: [{ type: 'BIRT', dateRaw, place: null, description: null }]
			}
		],
		families: []
	});

	it('writes a 5.5.1 calendar escape unchanged', () => {
		const out = buildGedcom551String(withDate('@#DFRENCH R@'));
		expect(out).toContain('2 DATE @#DFRENCH R@');
		expect(out).not.toContain('@@#DFRENCH R@');
	});

	it('converts a 5.5.1 calendar escape to its 7.0 form, not to escaped text', () => {
		expect(buildGedcom7String(withDate('@#DJULIAN@ 1 JAN 1700'))).toContain(
			'2 DATE JULIAN 1 JAN 1700'
		);
	});
});

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const lines = (text: string) => text.split('\r\n');

async function roundTrip(raw: string, format: typeof buildGedcom551String, label: string) {
	const treeId = crypto.randomUUID();
	await importGedcomToDb(t.d1, treeId, raw, label);
	return format(await getTreeExportData(t.d1, treeId));
}

describe('@-leading text round-trips in both directions', () => {
	const ged551 = [
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 NOTE @handle on the forum',
		'0 TRLR'
	].join('\r\n');
	const ged7 = ged551
		.replace('2 VERS 5.5.1', '2 VERS 7.0')
		.replace('NOTE @handle', 'NOTE @@handle');

	it('5.5.1 → 7.0 escapes, and reads back as the same text', async () => {
		const out = await roundTrip(ged551, buildGedcom7String, 'Up');
		expect(out).toContain('1 NOTE @@handle on the forum');
		expect(parseGedcom(out).individuals[0].notes?.[0]?.text).toBe('@handle on the forum');
	});

	it('7.0 → 5.5.1 keeps one escaped leading @ and reads back as the same text', async () => {
		const out = await roundTrip(ged7, buildGedcom551String, 'Down');
		expect(out).toContain('1 NOTE @@handle on the forum');
		expect(parseGedcom(out).individuals[0].notes?.[0]?.text).toBe('@handle on the forum');
	});
});

describe('a kept line is never escaped: it goes back exactly as the file wrote it', () => {
	const raw = [
		'0 HEAD',
		'1 GEDC',
		'2 VERS 5.5.1',
		'0 @I1@ INDI',
		'1 NAME Ann /Ash/',
		'1 _CUSTOM @handle',
		'0 TRLR'
	].join('\r\n');

	it('writes the unmodelled line unchanged in both dialects', async () => {
		for (const format of [buildGedcom551String, buildGedcom7String]) {
			expect(lines(await roundTrip(raw, format, 'Kept'))).toContain('1 _CUSTOM @handle');
		}
	});
});
