import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../domain/errors';
import { decodeAnsel } from './ansel';
import { decodeGedcomFile } from './decode';
import { packGedzip } from './gedzip';
import { detectGedcomVersion, parseGedcom } from './parser';

/** A minimal file in the given charset whose one person is named `name`. */
const file = (charset: string | null, version = '5.5') =>
	[
		'0 HEAD',
		'1 GEDC',
		`2 VERS ${version}`,
		'2 FORM LINEAGE-LINKED',
		...(charset ? [`1 CHAR ${charset}`] : []),
		'0 @I1@ INDI',
		'1 NAME '
	].join('\r\n');

const bytes = (...parts: (string | number[])[]) =>
	new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...strToU8(p)] : p)));

const nameOf = (text: string) => parseGedcom(text).individuals[0].names[0].givenName;

describe('decodeGedcomFile', () => {
	it('reads ANSEL, moving each diacritic after its letter', () => {
		// "José Müller": E2 is the acute, E8 the diaeresis, each before the letter it marks.
		const text = decodeGedcomFile(
			bytes(file('ANSEL'), 'Jos', [0xe2], 'e /M', [0xe8], 'uller/\r\n0 TRLR\r\n')
		);
		expect(nameOf(text)).toBe('José');
		expect(text).toContain('/Müller/');
	});

	it('reads ANSEL spacing letters, such as Ø and ł', () => {
		expect(decodeAnsel(new Uint8Array([0xa2, 0x73, 0x62, 0x79, 0x20, 0xb1, 0x6f]))).toBe('Øsby ło');
	});

	it('reads ANSI as Windows-1252, curly quotes and all', () => {
		const text = decodeGedcomFile(
			bytes(file('ANSI'), 'Ren', [0xe9], ' ', [0x93], 'Bud', [0x94], '\r\n')
		);
		expect(nameOf(text)).toBe('René “Bud”');
	});

	it('reads UTF-16 with and without a byte-order mark', () => {
		const utf16le = (s: string) =>
			new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
		const source = `${file('UNICODE')}Zoë /Ng/\r\n`;
		const plain = utf16le(source);
		expect(nameOf(decodeGedcomFile(plain))).toBe('Zoë');
		expect(nameOf(decodeGedcomFile(new Uint8Array([0xff, 0xfe, ...plain])))).toBe('Zoë');
		const bigEndian = plain.map((_, i) => plain[i % 2 === 0 ? i + 1 : i - 1]);
		expect(nameOf(decodeGedcomFile(new Uint8Array([0xfe, 0xff, ...bigEndian])))).toBe('Zoë');
	});

	it('reads UTF-8 with a byte-order mark, as a 7.0 file may have', () => {
		const text = decodeGedcomFile(bytes([0xef, 0xbb, 0xbf], file(null, '7.0'), 'Zoë /Ng/\r\n'));
		expect(detectGedcomVersion(text)).toBe('7.0');
		expect(nameOf(text)).toBe('Zoë');
	});

	it('falls back to Windows-1252 when a file that says ASCII or nothing is not UTF-8', () => {
		expect(nameOf(decodeGedcomFile(bytes(file('ASCII'), 'Ren', [0xe9], '\r\n')))).toBe('René');
		expect(nameOf(decodeGedcomFile(bytes(file(null), 'Ren', [0xe9], '\r\n')))).toBe('René');
	});

	it('unpacks a GEDZip archive, and refuses one with no gedcom.ged', () => {
		const archive = packGedzip(`${file(null, '7.0')}Zoë /Ng/\r\n0 TRLR\r\n`);
		expect(nameOf(decodeGedcomFile(archive))).toBe('Zoë');
		const empty = zipSync({ 'other.txt': strToU8('x') });
		expect(() => decodeGedcomFile(empty)).toThrow(ValidationError);
	});
});

describe('detectGedcomVersion', () => {
	it('tells 5.5, 5.5.1 and 7.0 apart', () => {
		expect(detectGedcomVersion(file(null, '5.5'))).toBe('5.5');
		expect(detectGedcomVersion(file(null, '5.5.1'))).toBe('5.5.1');
		expect(detectGedcomVersion(file(null, '7.0'))).toBe('7.0');
		expect(detectGedcomVersion(file(null, '7.0.14'))).toBe('7.0');
	});
});
