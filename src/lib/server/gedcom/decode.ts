/**
 * Turn an uploaded file's bytes into GEDCOM text, whatever version and character set wrote it.
 * GEDCOM 7 is always UTF-8. GEDCOM 5.5.1 names its set in `HEAD.CHAR`, and 5.5 files are mostly
 * ANSEL, sometimes ANSI (Windows-1252) or UTF-16 (`UNICODE`). A GEDZip archive is unpacked first.
 *
 * Reading a file with `File.text()` decodes it as UTF-8 regardless, which turns every accented
 * letter in an ANSEL or ANSI file into a replacement character; so the bytes are read here instead.
 */

import { decodeAnsel } from './ansel';
import { isZip, unpackGedzip } from './gedzip';

/** Windows-1252's 0x80–0x9F, where it differs from Latin-1. Implemented here because the Workers runtime does not promise legacy encodings in `TextDecoder`. */
const WINDOWS_1252_HIGH = [
	0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
	0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
	0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178
];

/** UTF-16 code units as a string, in slices so a large file does not overflow the argument limit. */
function fromCodeUnits(units: Uint16Array): string {
	let out = '';
	for (let i = 0; i < units.length; i += 8192) {
		out += String.fromCharCode(...units.subarray(i, i + 8192));
	}
	return out;
}

function decodeWindows1252(bytes: Uint8Array): string {
	const units = new Uint16Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i];
		units[i] = byte >= 0x80 && byte < 0xa0 ? WINDOWS_1252_HIGH[byte - 0x80] : byte;
	}
	return fromCodeUnits(units);
}

function decodeUtf16(bytes: Uint8Array, isBigEndian: boolean): string {
	const units = new Uint16Array(Math.floor(bytes.length / 2));
	for (let i = 0; i < units.length; i++) {
		const [hi, lo] = isBigEndian
			? [bytes[2 * i], bytes[2 * i + 1]]
			: [bytes[2 * i + 1], bytes[2 * i]];
		units[i] = (hi << 8) | lo;
	}
	return fromCodeUnits(units);
}

/** UTF-8, or Windows-1252 when the bytes are not valid UTF-8: a file that says `ASCII` or nothing at all is often really ANSI. */
function decodeUtf8OrAnsi(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return decodeWindows1252(bytes);
	}
}

/** The `HEAD.CHAR` value, read from the header as single bytes; null when the header names none. */
function declaredCharset(bytes: Uint8Array): string | null {
	const head = decodeWindows1252(bytes.subarray(0, 64 * 1024));
	const lines = head.split(/\r\n|\r|\n/);
	for (const line of lines.slice(1)) {
		// The header ends at the next record.
		if (/^\s*0\s/.test(line)) break;
		const match = line.match(/^\s*1\s+CHAR\s+(.+?)\s*$/i);
		if (match) return match[1].toUpperCase();
	}
	return null;
}

/** The text of a GEDCOM file or GEDZip archive. Throws a `ValidationError` for an archive with no dataset. */
export function decodeGedcomFile(input: Uint8Array): string {
	const bytes = isZip(input) ? unpackGedzip(input) : input;

	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return decodeUtf8OrAnsi(bytes.subarray(3));
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), false);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), true);
	// UTF-16 with no byte-order mark: every file starts with the ASCII `0` of `0 HEAD`.
	if (bytes[0] === 0x30 && bytes[1] === 0x00) return decodeUtf16(bytes, false);
	if (bytes[0] === 0x00 && bytes[1] === 0x30) return decodeUtf16(bytes, true);

	const charset = declaredCharset(bytes);
	if (charset === 'ANSEL') return decodeAnsel(bytes);
	if (charset === 'ANSI' || charset === 'WINDOWS-1252' || charset === 'CP1252') {
		return decodeWindows1252(bytes);
	}
	// UTF-8, ASCII, an unnamed set, and the rare ones (IBMPC, MACINTOSH) this does not decode.
	return decodeUtf8OrAnsi(bytes);
}
