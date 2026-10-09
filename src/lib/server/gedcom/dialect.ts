/**
 * The last pass over a serialized file, making its lines valid in the dialect being written. It
 * runs over every line, the ones the serializers build and the ones kept verbatim from an imported
 * file alike, because a tree imported from 5.5.1 and exported as 7.0 carries both.
 */

import { toGedcom551Date, toGedcom7Date } from './date-dialect';

/** `level [@xref@] tag [payload]`. The payload keeps its leading spaces, which `CONC` depends on. */
const LINE = /^(\d+) (?:(@[^@\s]+@) )?(\S+)(?: (.*))?$/;

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

/** A pointer payload (`@I1@`, `@VOID@`), which is not text and is never escaped. */
const POINTER = /^@[^@\s]+@$/;

/**
 * Lines in 7.0 form: `CONC` folded into the line it continues (7.0 has no line-length limit and no
 * `CONC`), dates converted with a `PHRASE` where 7.0 needs one, and a text payload that starts with
 * `@` escaped as `@@`.
 */
export function toGedcom7Lines(lines: readonly string[]): string[] {
	// A line that is not GEDCOM (a blank one) stays as a string, where it was, rather than be lost.
	const out: (Line | string)[] = [];
	for (const raw of lines) {
		const line = parse(raw);
		if (!line) {
			out.push(raw);
			continue;
		}
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
			if (phrase) out.push({ level: line.level + 1, tag: 'PHRASE', payload: phrase });
			continue;
		}
		out.push(line);
	}
	return out.map((line) => {
		if (typeof line === 'string') return line;
		const payload = line.payload;
		// Escaped last, so a payload that only starts with `@` once its `CONC` is folded in is caught.
		if (payload?.startsWith('@') && !payload.startsWith('@@') && !POINTER.test(payload)) {
			return format({ ...line, payload: `@${payload}` });
		}
		return format(line);
	});
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
