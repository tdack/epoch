/**
 * The last pass over a serialized file, making its lines valid in the dialect being written. It
 * runs over every line, the ones the serializers build and the ones kept verbatim from an imported
 * file alike, because a tree imported from 5.5.1 and exported as 7.0 carries both.
 */

import { escapeText } from './evidence-lines';
import { toGedcom551Date, toGedcom7Date } from './date-dialect';

/** `level [@xref@] tag [payload]`. The payload keeps its leading spaces, which `CONC` depends on. */
// Two digits at most, so rows kept before the parser enforced it cannot make `tags.length` throw.
const LINE = /^(\d{1,2}) (?:(@[^@\s]+@) )?(\S+)(?: (.*))?$/;

interface Line {
	level: number;
	xref?: string;
	tag: string;
	payload?: string;
}

function parse(line: string): Line | null {
	const m = line.match(LINE);
	return m ? { level: Number(m[1]), xref: m[2], tag: m[3], payload: m[4] } : null;
}

function format({ level, xref, tag, payload }: Line): string {
	return [String(level), xref, tag, payload || undefined].filter((p) => p !== undefined).join(' ');
}

/** Tags whose 7.0 payload is an enumeration, which 7.0 spells in capitals and 5.5.1 often did not. */
const ENUMERATED_TAGS = new Set(['STAT', 'RESN', 'ADOP', 'PEDI']);

/** 7.0's media kinds. Programs wrote others in 5.5.1 (`certificate`), which 7.0 says as `OTHER`. */
const MEDIA_KINDS = new Set([
	'AUDIO',
	'BOOK',
	'CARD',
	'ELECTRONIC',
	'FICHE',
	'FILM',
	'MAGAZINE',
	'MANUSCRIPT',
	'MAP',
	'NEWSPAPER',
	'PHOTO',
	'TOMBSTONE',
	'VIDEO',
	'OTHER'
]);

/** A `MEDI` line, with a kind 7.0 has no word for kept as the `PHRASE` of `OTHER`. */
function mediaKind(line: Line): Line[] {
	const word = line.payload?.trim();
	if (!word || MEDIA_KINDS.has(word.toUpperCase())) {
		return [{ ...line, tag: 'MEDI', payload: word?.toUpperCase() }];
	}
	return [
		{ ...line, tag: 'MEDI', payload: 'OTHER' },
		{ level: line.level + 1, tag: 'PHRASE', payload: escapeText(word) }
	];
}

/** 5.5.1's `FORM` words for a file, as the media types 7.0 asks for. */
const MEDIA_TYPES: Record<string, string> = {
	bmp: 'image/bmp',
	gif: 'image/gif',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	wav: 'audio/wav',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	pdf: 'application/pdf',
	txt: 'text/plain',
	htm: 'text/html',
	html: 'text/html'
};

/**
 * One kept 5.5.1 structure in its 7.0 form, by its parent's tag: a file's `FORM` as a media type and
 * its `TYPE` as `MEDI` (an unknown kind as `OTHER`), an association's `RELA` as `ROLE OTHER` with the word as its `PHRASE`, and an
 * enumeration in capitals. A structure 7.0 already wrote comes through unchanged.
 */
function restructure7(line: Line, parentTag: string | undefined): Line[] {
	const { tag, payload } = line;
	if (tag === 'FORM' && parentTag === 'FILE' && payload && !payload.includes('/')) {
		return [{ ...line, payload: MEDIA_TYPES[payload.trim().toLowerCase()] ?? payload }];
	}
	if ((tag === 'TYPE' && parentTag === 'FORM') || tag === 'MEDI') return mediaKind(line);
	if (tag === 'RELA' && parentTag === 'ASSO') {
		const role: Line = { ...line, tag: 'ROLE', payload: 'OTHER' };
		return payload
			? [role, { level: line.level + 1, tag: 'PHRASE', payload: escapeText(payload) }]
			: [role];
	}
	if (ENUMERATED_TAGS.has(tag) && payload) return [{ ...line, payload: payload.toUpperCase() }];
	return [line];
}

/**
 * Lines in 7.0 form: `CONC` folded into the line it continues (7.0 has no line-length limit and no
 * `CONC`), dates converted with a `PHRASE` where 7.0 needs one, and the few 5.5.1 structures 7.0
 * renamed rewritten (`restructure7`). A model payload's leading `@` was already doubled by
 * `escapeText` at its call site; a line kept verbatim is left exactly as the file wrote it, because
 * only the escape that belongs to the model can be told from a file's own bytes.
 */
export function toGedcom7Lines(lines: readonly string[]): string[] {
	// A line that is not GEDCOM (a blank one) stays as a string, where it was, rather than be lost.
	const out: (Line | string)[] = [];
	// The tag at each level above the current line, as the file had it.
	const tags: string[] = [];
	for (const raw of lines) {
		const line = parse(raw);
		if (!line) {
			out.push(raw);
			continue;
		}
		tags.length = line.level;
		const parentTag = tags[line.level - 1];
		tags[line.level] = line.tag;
		if (line.tag === 'CONC') {
			const target = concTarget(out, line.level);
			if (target) {
				target.payload = (target.payload ?? '') + (line.payload ?? '');
				continue;
			}
		}
		if (line.tag === 'DATE' && line.payload !== undefined) {
			const { value, phrase } = toGedcom7Date(line.payload);
			out.push({ ...line, payload: value });
			if (phrase) out.push({ level: line.level + 1, tag: 'PHRASE', payload: escapeText(phrase) });
			continue;
		}
		out.push(...restructure7(line, parentTag));
	}
	return out.map((line) => (typeof line === 'string' ? line : format(line)));
}

/**
 * The line a `CONC` at `level` continues: the last `CONT` beside it, or else the line it sits under.
 * Null when there is neither, and the line is then kept as it came.
 */
function concTarget(out: readonly (Line | string)[], level: number): Line | null {
	for (let i = out.length - 1; i >= 0; i--) {
		const line = out[i];
		if (typeof line === 'string') continue;
		if (line.level === level - 1) return line;
		if (line.level === level && line.tag === 'CONT') return line;
		if (line.level < level - 1) return null;
	}
	return null;
}

/** Lines in 5.5.1 form: the dates a 7.0 file brought in, written with 5.5.1's calendar escapes. */
export function toGedcom551Lines(lines: readonly string[]): string[] {
	return lines.map((raw) => {
		const line = parse(raw);
		if (line?.tag !== 'DATE' || !line.payload) return raw;
		return format({ ...line, payload: toGedcom551Date(line.payload) });
	});
}
