/**
 * A structural validator for GEDCOM 7.0 text, driven by the generated spec table. It is a test and
 * diagnostics tool: nothing on the import path calls it, so it favours one readable rule per
 * code over speed. It reports; it never repairs, and it never throws on bad input.
 */

import { GEDCOM7_CALENDARS } from './spec/gedcom7-spec';
import { calendarOf, enumValues, rootOf, structureByUri, substructureOf } from './spec/lookup';
import type { StructureSpec } from './spec/types';

export const GEDCOM7_ISSUE_CODES = [
	'line-grammar',
	'conc-unsupported',
	'control-character',
	'level-jump',
	'at-sign-escape',
	'terminator-mixed',
	'head-not-first',
	'trlr-not-last',
	'root-cardinality',
	'root-tag-unknown',
	'xref-format',
	'xref-void-reserved',
	'xref-duplicate',
	'xref-misplaced',
	'xref-missing',
	'tag-not-allowed',
	'cardinality-max',
	'cardinality-min',
	'payload-unexpected',
	'payload-missing',
	'pointer-format',
	'pointer-unresolved',
	'pointer-wrong-type',
	'enum-value',
	'y-or-null',
	'integer',
	'language',
	'media-type',
	'date-value',
	'date-exact',
	'date-period',
	'age',
	'time',
	'latitude',
	'longitude',
	'personal-name',
	'uri',
	'tag-def',
	'schma-standard-tag',
	'extension-undocumented',
	'gedc-version'
] as const;

export type Gedcom7IssueCode = (typeof GEDCOM7_ISSUE_CODES)[number];

export interface Gedcom7Issue {
	/** 1-based line in the input; 0 for a problem with the file as a whole. */
	line: number;
	code: Gedcom7IssueCode;
	/** Tags from the record down, such as `INDI.BIRT.DATE`. */
	path: string;
	message: string;
}

export interface Gedcom7Report {
	errors: Gedcom7Issue[];
	warnings: Gedcom7Issue[];
}

const V7 = 'https://gedcom.io/terms/v7/';
// Bytes the 7.0 grammar bans outright: C0 controls except TAB, DEL, C1 controls, and the
// non-characters. Surrogates cannot appear in a well-formed JS string pair, so lone ones count.
// eslint-disable-next-line no-control-regex
const BANNED_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]/;
const XREF = /^@[A-Z0-9_]+@$/;
const STANDARD_TAG = /^[A-Z][A-Z0-9_]*$/;
const EXTENSION_TAG = /^_[A-Z0-9_]+$/;
const LINE = /^(\d+) (?:(@[^ ]*@) )?([^ ]+)(?: (.*))?$/;
const VOID = '@VOID@';

interface Node {
	line: number;
	level: number;
	tag: string;
	path: string;
	/** Structure type that governs the children; undefined when the subtree is not checked. */
	spec: StructureSpec | undefined;
	uri: string | undefined;
	counts: Map<string, number>;
	/** An AGE with no payload is legal only when a PHRASE says what it means. */
	needsPhrase?: boolean;
}

interface PendingPointer {
	line: number;
	path: string;
	xref: string;
	target: string;
}

const isDigits = (s: string) => /^\d+$/.test(s);

/** Own tags: a standard-looking name, or an underscore extension. */
function isTagShape(tag: string): boolean {
	return STANDARD_TAG.test(tag) || EXTENSION_TAG.test(tag);
}

// --- payload grammars -------------------------------------------------------------------------

// RFC 5646 well-formedness only; the registry is deliberately not consulted.
const BCP47_LANGTAG = new RegExp(
	'^(?:' +
		'(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4}|[A-Za-z]{5,8})' +
		'(?:-[A-Za-z]{4})?' +
		'(?:-(?:[A-Za-z]{2}|\\d{3}))?' +
		'(?:-(?:[A-Za-z0-9]{5,8}|\\d[A-Za-z0-9]{3}))*' +
		'(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*' +
		'(?:-[xX](?:-[A-Za-z0-9]{1,8})+)?' +
		'|[xX](?:-[A-Za-z0-9]{1,8})+' +
		// The registry's irregular grandfathered tags do not fit the productions above.
		'|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)' +
		'|sgn-(?:BE-FR|BE-NL|CH-DE)|en-GB-oed' +
		')$'
);

const MEDIA_TOKEN = "[A-Za-z0-9!#$&^_.+'`*%~-]+";
const MEDIA_TYPE = new RegExp(`^${MEDIA_TOKEN}/${MEDIA_TOKEN}(?:\\s*;\\s*[^;]+)*$`);

// The hour may be one digit (`8:38`); the spec's production allows it.
const TIME = /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z?$/;

function ageError(text: string): string | null {
	const tokens = text.split(' ');
	if (tokens[0] === '<' || tokens[0] === '>') tokens.shift();
	if (tokens.length === 0 || tokens[0] === '') return 'an age needs at least one of y, m, w, d';
	const order = ['y', 'm', 'w', 'd'];
	let last = -1;
	for (const token of tokens) {
		const m = /^(\d+)([ymwd])$/.exec(token);
		if (!m) return `"${token}" is not a count of years, months, weeks or days`;
		const at = order.indexOf(m[2]);
		if (at <= last) return 'age units must be in the order y, m, w, d, each at most once';
		last = at;
	}
	return null;
}

function nameError(text: string): string | null {
	return /^[^/]*(?:\/[^/]*\/[^/]*)?$/.test(text)
		? null
		: 'a personal name has no slashes or exactly one slash-delimited surname';
}

/** Whether the month tag belongs to the calendar, or is an extension. */
function isMonthOf(calendar: string, month: string): boolean {
	if (EXTENSION_TAG.test(month)) return true;
	const cal = calendarOf(calendar);
	// An extension calendar defines its own months, which the table cannot know.
	return cal ? cal.months.includes(month) : STANDARD_TAG.test(month);
}

interface DateUse {
	onExtension: (name: string) => void;
}

/** One `date` production: `[calendar] [[day] month] year [epoch]`. */
function dateError(tokens: string[], use: DateUse): string | null {
	if (tokens.length === 0 || tokens.some((t) => t === '')) return 'a date is missing';

	// An extension calendar and an extension month both start with an underscore, so the first
	// token is tried as a calendar and, failing that, as part of the date itself.
	const attempts: { calendar: string; rest: string[] }[] = [];
	if (calendarOf(tokens[0]) || (EXTENSION_TAG.test(tokens[0]) && tokens.length > 1)) {
		attempts.push({ calendar: tokens[0], rest: tokens.slice(1) });
	}
	attempts.push({ calendar: 'GREGORIAN', rest: tokens });

	let firstProblem: string | null = null;
	for (const { calendar, rest } of attempts) {
		const problem = dateBodyError(calendar, rest, use);
		if (problem === null) return null;
		firstProblem ??= problem;
	}
	return firstProblem;
}

function dateBodyError(calendar: string, rest: string[], use: DateUse): string | null {
	const body = [...rest];
	let epoch: string | undefined;
	if (body.length >= 2 && !isDigits(body[body.length - 1])) epoch = body.pop();
	if (body.length < 1 || body.length > 3) return 'expected [[day] month] year';

	const year = body[body.length - 1];
	if (!isDigits(year)) return `"${year}" is not a year (dual years are not part of 7.0)`;
	if (body.length >= 2 && !isMonthOf(calendar, body[body.length - 2])) {
		return `"${body[body.length - 2]}" is not a month of ${calendar}`;
	}
	if (body.length === 3 && !isDigits(body[0])) return `"${body[0]}" is not a day`;

	const isStandardCalendar = calendarOf(calendar) !== undefined;
	if (!isStandardCalendar) {
		if (!EXTENSION_TAG.test(calendar)) return `"${calendar}" is not a calendar`;
		use.onExtension(calendar);
	}
	if (body.length >= 2 && EXTENSION_TAG.test(body[body.length - 2])) {
		use.onExtension(body[body.length - 2]);
	}
	if (epoch !== undefined) {
		if (EXTENSION_TAG.test(epoch)) use.onExtension(epoch);
		else if (epoch !== 'BCE') return `"${epoch}" is not an epoch`;
		else if (calendar !== 'GREGORIAN' && calendar !== 'JULIAN' && isStandardCalendar) {
			return `BCE is not defined for the ${calendar} calendar`;
		}
	}
	return null;
}

type DateForm = 'value' | 'period';

function dateValueError(text: string, form: DateForm, use: DateUse): string | null {
	if (text === '') return form === 'value' ? null : 'a period needs FROM or TO';
	const tokens = text.split(' ');
	const head = tokens[0];
	const dates = (...parts: string[][]) => {
		for (const part of parts) {
			const problem = dateError(part, use);
			if (problem) return problem;
		}
		return null;
	};

	if (head === 'FROM') {
		const to = tokens.indexOf('TO', 1);
		return to === -1 ? dates(tokens.slice(1)) : dates(tokens.slice(1, to), tokens.slice(to + 1));
	}
	if (head === 'TO') return dates(tokens.slice(1));
	if (form === 'period') return 'a period starts with FROM or TO';
	if (head === 'BET') {
		const and = tokens.indexOf('AND', 1);
		if (and === -1) return 'BET needs AND';
		return dates(tokens.slice(1, and), tokens.slice(and + 1));
	}
	if (['BEF', 'AFT', 'ABT', 'CAL', 'EST'].includes(head)) return dates(tokens.slice(1));
	return dates(tokens);
}

function exactDateError(text: string): string | null {
	const tokens = text.split(' ');
	const greg = GEDCOM7_CALENDARS.GREGORIAN.months as readonly string[];
	if (
		tokens.length === 3 &&
		isDigits(tokens[0]) &&
		greg.includes(tokens[1]) &&
		isDigits(tokens[2])
	) {
		return null;
	}
	return 'an exact date is day month year in the Gregorian calendar';
}

function coordinateError(text: string, hemispheres: string, limit: number): string | null {
	const m = new RegExp(`^[${hemispheres}](\\d+(?:\\.\\d+)?)$`).exec(text);
	if (!m) return `expected ${hemispheres[0]} or ${hemispheres[1]} followed by a decimal number`;
	return Number(m[1]) > limit ? `the value exceeds ${limit}` : null;
}

function uriError(text: string): string | null {
	return /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(text) ? null : 'expected a URI with a scheme';
}

// --- the validator ----------------------------------------------------------------------------

export function validateGedcom7(input: string): Gedcom7Report {
	const errors: Gedcom7Issue[] = [];
	const warnings: Gedcom7Issue[] = [];
	const error = (line: number, code: Gedcom7IssueCode, path: string, message: string) =>
		errors.push({ line, code, path, message });
	const warn = (line: number, code: Gedcom7IssueCode, path: string, message: string) =>
		warnings.push({ line, code, path, message });

	const text = input.startsWith('﻿') ? input.slice(1) : input;

	// Terminator style: CR, LF and CRLF are all legal, but a file that mixes them is usually
	// one that was edited by two tools.
	const terminators = new Set<string>();
	for (const m of text.matchAll(/\r\n|\r|\n/g)) terminators.add(m[0]);
	if (terminators.size > 1) {
		warn(1, 'terminator-mixed', '', `the file mixes line terminators (${terminators.size} kinds)`);
	}
	const rawLines = text.split(/\r\n|\r|\n/);
	// The terminator after the last line leaves an empty final segment that is not a blank line.
	if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

	const stack: Node[] = [];
	const xrefs = new Map<string, { line: number; tag: string }>();
	const pointers: PendingPointer[] = [];
	const rootCounts = new Map<string, number>();
	const roots: { tag: string; line: number }[] = [];
	const documented = new Map<string, string[]>();
	const usedExtensions = new Map<string, { line: number; path: string }>();
	let previousLevel = -1;

	const noteExtension = (name: string, line: number, path: string) => {
		if (!usedExtensions.has(name)) usedExtensions.set(name, { line, path });
	};

	const finish = (node: Node) => {
		if (!node.spec) return;
		if (node.needsPhrase && !node.counts.has('PHRASE')) {
			error(node.line, 'payload-missing', node.path, 'an AGE with no payload needs a PHRASE');
		}
		for (const [tag, sub] of Object.entries(node.spec.subs)) {
			if (sub.min === 1 && !node.counts.has(tag)) {
				error(node.line, 'cardinality-min', node.path, `${node.path} requires a ${tag}`);
			}
		}
	};
	const popTo = (level: number) => {
		while (stack.length > level) finish(stack.pop() as Node);
	};

	rawLines.forEach((rawLine, index) => {
		const line = index + 1;
		if (rawLine === '') {
			error(line, 'line-grammar', '', 'blank line');
			return;
		}
		if (BANNED_CHARACTER.test(rawLine)) {
			error(line, 'control-character', '', 'the line contains a character GEDCOM 7 bans');
		}
		const m = LINE.exec(rawLine);
		if (!m) {
			error(line, 'line-grammar', '', 'expected "level [xref] tag [payload]" with single spaces');
			return;
		}
		const [, levelText, xref, tag, payload] = m;
		if (levelText.length > 1 && levelText.startsWith('0')) {
			error(line, 'line-grammar', tag, 'a level has no leading zeros');
			return;
		}
		const level = Number(levelText);
		if (!isTagShape(tag)) {
			error(
				line,
				'line-grammar',
				tag,
				'a tag is upper-case letters, digits and underscores, starting with a letter or underscore'
			);
			return;
		}
		if (tag === 'CONC') {
			error(line, 'conc-unsupported', tag, 'GEDCOM 7 has no CONC; use CONT');
			return;
		}
		if (level > previousLevel + 1) {
			error(line, 'level-jump', tag, `level ${level} follows level ${previousLevel}`);
		}
		// Whatever the jump was, the line still has to hang somewhere to be checked in context.
		const effectiveLevel = Math.min(level, previousLevel + 1);
		previousLevel = level;
		if (effectiveLevel === 0 && level !== 0) return;

		// `@` rule: a payload that starts with `@` is either a whole pointer or an escaped `@@`.
		let isPointerPayload = false;
		if (payload?.startsWith('@')) {
			if (XREF.test(payload) || payload === VOID) isPointerPayload = true;
			else if (!payload.startsWith('@@')) {
				error(line, 'at-sign-escape', tag, 'a payload that starts with @ must double it (@@)');
			}
		}

		popTo(effectiveLevel);
		const parent = stack[effectiveLevel - 1];
		const path = parent ? `${parent.path}.${tag}` : tag;

		if (xref !== undefined && effectiveLevel !== 0) {
			error(line, 'xref-misplaced', path, 'only a record (level 0) carries an xref');
		}

		let uri: string | undefined;
		let isChecked = true;

		if (effectiveLevel === 0) {
			roots.push({ tag, line });
			if (EXTENSION_TAG.test(tag)) {
				isChecked = false;
				noteExtension(tag, line, path);
			} else {
				const root = rootOf(tag);
				if (!root) {
					error(line, 'root-tag-unknown', path, `${tag} is not a GEDCOM 7 record`);
					isChecked = false;
				} else {
					rootCounts.set(tag, (rootCounts.get(tag) ?? 0) + 1);
					uri = root.uri;
				}
			}
			if (xref !== undefined) {
				if (xref === VOID) {
					error(line, 'xref-void-reserved', path, '@VOID@ is reserved for pointers');
				} else if (!XREF.test(xref)) {
					error(line, 'xref-format', path, `${xref} is not @ followed by A-Z, 0-9, _ and @`);
				} else if (xrefs.has(xref)) {
					error(
						line,
						'xref-duplicate',
						path,
						`${xref} is already defined on line ${xrefs.get(xref)?.line}`
					);
				} else {
					xrefs.set(xref, { line, tag });
				}
			} else if (tag !== 'HEAD' && tag !== 'TRLR') {
				// The official extensions.ged carries a bare `0 INDI`, so this is a warning rather than
				// an error even though the structure table lists the record with an xref.
				warn(line, 'xref-missing', path, `${tag} record has no xref, so nothing can point at it`);
			} else {
				// HEAD and TRLR are not referenced.
			}
			if ((tag === 'HEAD' || tag === 'TRLR') && xref !== undefined) {
				error(line, 'xref-misplaced', path, `${tag} has no xref`);
			}
		} else if (!parent.spec) {
			isChecked = false;
			if (EXTENSION_TAG.test(tag)) noteExtension(tag, line, path);
		} else if (EXTENSION_TAG.test(tag)) {
			isChecked = false;
			noteExtension(tag, line, path);
		} else if (tag === 'CONT') {
			const kind = parent.spec.payload.kind;
			if (kind === 'string' || kind === 'listText') {
				uri = `${V7}CONT`;
			} else {
				error(line, 'tag-not-allowed', path, `CONT cannot continue a ${parent.spec.tag} payload`);
				isChecked = false;
			}
		} else {
			const sub = substructureOf(parent.uri as string, tag);
			if (!sub) {
				error(line, 'tag-not-allowed', path, `${tag} is not allowed under ${parent.path}`);
				isChecked = false;
			} else {
				const seen = (parent.counts.get(tag) ?? 0) + 1;
				parent.counts.set(tag, seen);
				if (sub.max === 1 && seen > 1) {
					error(line, 'cardinality-max', path, `${tag} may appear once under ${parent.path}`);
				}
				uri = sub.uri;
			}
		}

		const spec = uri === undefined ? undefined : structureByUri(uri);
		const node: Node = {
			line,
			level: effectiveLevel,
			tag,
			path,
			spec: isChecked ? spec : undefined,
			uri,
			counts: new Map()
		};
		stack.push(node);

		if (!isChecked || !spec) return;
		if (spec.payload.kind === 'age' && (payload === undefined || payload === '')) {
			node.needsPhrase = true;
			return;
		}
		checkPayload({
			spec,
			payload,
			isPointerPayload,
			line,
			path,
			error,
			pointers,
			warn,
			noteExtension,
			documented
		});
	});
	popTo(0);

	// Record order and cardinality.
	if (roots.length === 0 || roots[0].tag !== 'HEAD') {
		error(
			roots[0]?.line ?? 0,
			'head-not-first',
			roots[0]?.tag ?? '',
			'the first record must be HEAD'
		);
	}
	if (roots.length === 0 || roots[roots.length - 1].tag !== 'TRLR') {
		const last = roots[roots.length - 1];
		error(last?.line ?? 0, 'trlr-not-last', last?.tag ?? '', 'the last record must be TRLR');
	}
	for (const tag of ['HEAD', 'TRLR']) {
		const count = rootCounts.get(tag) ?? 0;
		if (count > 1) {
			const second = roots.filter((r) => r.tag === tag)[1];
			error(second.line, 'root-cardinality', tag, `${tag} must appear exactly once`);
		} else if (count === 0 && roots.length > 0) {
			error(0, 'root-cardinality', tag, `${tag} must appear exactly once`);
		}
	}

	// Pointers resolve against the finished record set, since a pointer may run forward.
	for (const p of pointers) {
		const record = xrefs.get(p.xref);
		if (!record) {
			error(p.line, 'pointer-unresolved', p.path, `${p.xref} is not defined (use @VOID@)`);
			continue;
		}
		const root = rootOf(record.tag);
		const types = root ? [root.uri] : (documented.get(record.tag) ?? []);
		if (!types.includes(p.target)) {
			error(
				p.line,
				'pointer-wrong-type',
				p.path,
				`${p.xref} is a ${record.tag} record, expected ${p.target.slice(V7.length)}`
			);
		}
	}

	for (const [name, where] of usedExtensions) {
		if (!documented.has(name)) {
			warn(
				where.line,
				'extension-undocumented',
				where.path,
				`${name} is not documented in HEAD.SCHMA`
			);
		}
	}

	return { errors, warnings };
}

interface PayloadContext {
	spec: StructureSpec;
	payload: string | undefined;
	isPointerPayload: boolean;
	line: number;
	path: string;
	error: (line: number, code: Gedcom7IssueCode, path: string, message: string) => void;
	pointers: PendingPointer[];
	warn: (line: number, code: Gedcom7IssueCode, path: string, message: string) => void;
	noteExtension: (name: string, line: number, path: string) => void;
	documented: Map<string, string[]>;
}

function checkPayload(ctx: PayloadContext): void {
	const { spec, line, path, error } = ctx;
	const payload = ctx.payload === '' ? undefined : ctx.payload;
	const kind = spec.payload.kind;
	const bad = (code: Gedcom7IssueCode, message: string | null) => {
		if (message !== null) error(line, code, path, message);
	};
	// Kinds that read an absent payload as the empty string; every other kind needs one.
	const isPayloadOptional = [
		'none',
		'string',
		'listText',
		'filePath',
		'yOrNull',
		'name',
		'dateValue',
		'datePeriod'
	].includes(kind);
	if (payload === undefined && !isPayloadOptional) {
		error(line, 'payload-missing', path, `${spec.tag} needs a ${kind} payload`);
		return;
	}
	const text = payload ?? '';
	const use: DateUse = { onExtension: (name) => ctx.noteExtension(name, line, path) };

	if (ctx.isPointerPayload && kind !== 'pointer') {
		error(line, 'payload-unexpected', path, `${spec.tag} takes ${kind}, not a pointer`);
		return;
	}

	switch (spec.payload.kind) {
		case 'none':
			// CONT is the one structure the table lists with no payload that carries text.
			if (payload !== undefined && spec.tag !== 'CONT') {
				error(line, 'payload-unexpected', path, `${spec.tag} takes no payload`);
			}
			return;
		case 'string':
			if (
				path === 'HEAD.GEDC.VERS' &&
				payload !== undefined &&
				!/^7\.\d+(?:\.\d+)?$/.test(payload)
			) {
				ctx.warn(line, 'gedc-version', path, `${payload} is not a 7.x version`);
			}
			return;
		case 'listText':
		case 'filePath':
			return;
		case 'yOrNull':
			if (payload !== undefined && payload !== 'Y') {
				error(line, 'y-or-null', path, `expected Y or no payload, got "${payload}"`);
			}
			return;
		case 'integer':
			bad('integer', isDigits(text) ? null : 'expected a non-negative integer');
			return;
		case 'uri':
			bad('uri', uriError(text));
			return;
		case 'language':
			bad('language', BCP47_LANGTAG.test(text) ? null : 'not a well-formed BCP 47 tag');
			return;
		case 'mediaType':
			bad('media-type', MEDIA_TYPE.test(text) ? null : 'expected type/subtype');
			return;
		case 'pointer': {
			if (!ctx.isPointerPayload) {
				error(line, 'pointer-format', path, 'expected a pointer such as @I1@ or @VOID@');
			} else if (payload !== VOID) {
				ctx.pointers.push({ line, path, xref: text, target: spec.payload.target });
			}
			return;
		}
		case 'dateValue':
			bad('date-value', dateValueError(payload ?? '', 'value', use));
			return;
		case 'datePeriod':
			bad('date-period', dateValueError(payload ?? '', 'period', use));
			return;
		case 'dateExact':
			bad('date-exact', exactDateError(text));
			return;
		case 'age':
			bad('age', ageError(text));
			return;
		case 'time':
			bad('time', TIME.test(text) ? null : 'expected hh:mm[:ss[.f]][Z]');
			return;
		case 'latitude':
			bad('latitude', coordinateError(text, 'NS', 90));
			return;
		case 'longitude':
			bad('longitude', coordinateError(text, 'EW', 180));
			return;
		case 'name':
			if (payload !== undefined) bad('personal-name', nameError(payload));
			return;
		case 'enum':
		case 'listEnum': {
			const values = enumValues(spec.payload.enumSet) ?? [];
			const items = kind === 'listEnum' ? text.split(/\s*,\s*/) : [text];
			for (const item of items) {
				if (EXTENSION_TAG.test(item)) ctx.noteExtension(item, line, path);
				else if (!values.includes(item)) {
					error(
						line,
						'enum-value',
						path,
						`"${item}" is not a value of ${spec.payload.enumSet.slice(V7.length)}`
					);
				}
			}
			return;
		}
		case 'tagDef': {
			const m = /^(\S+) (\S+)$/.exec(text);
			if (!m) {
				error(line, 'tag-def', path, 'expected "_TAG uri"');
				return;
			}
			const [, tag, uri] = m;
			if (!EXTENSION_TAG.test(tag)) {
				const code = STANDARD_TAG.test(tag) ? 'schma-standard-tag' : 'tag-def';
				error(line, code, path, `${tag} must start with an underscore to be defined in SCHMA`);
				return;
			}
			bad('tag-def', uriError(uri) === null ? null : 'the definition needs a URI');
			ctx.documented.set(tag, [...(ctx.documented.get(tag) ?? []), uri]);
			return;
		}
	}
}
