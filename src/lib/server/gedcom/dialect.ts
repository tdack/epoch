/**
 * The last pass over a serialized file, making its lines valid in the dialect being written. It
 * runs over every line, the ones the serializers build and the ones kept verbatim from an imported
 * file alike, because a tree imported from 5.5.1 and exported as 7.0 carries both.
 */

import { escapeText } from './evidence-lines';
import { toGedcom551Date, toGedcom7Date } from './date-dialect';
import { enumValues, rootOf, structureByUri, substructureOf } from './spec/lookup';

const V7 = 'https://gedcom.io/terms/v7/';

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
	webp: 'image/webp',
	svg: 'image/svg+xml',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	m4a: 'audio/mp4',
	flac: 'audio/flac',
	mov: 'video/quicktime',
	mpg: 'video/mpeg',
	mpeg: 'video/mpeg',
	avi: 'video/x-msvideo',
	vtt: 'text/vtt',
	txt: 'text/plain',
	rtf: 'application/rtf',
	htm: 'text/html',
	html: 'text/html'
};

/** What 7.0 asks for when neither the `FORM` nor the file name says what a file is. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream';

/** The media type a file's extension implies, or `application/octet-stream`. */
function mediaTypeOfPath(path: string | undefined): string {
	const name = (path ?? '').split(/[?#]/)[0];
	const dot = name.lastIndexOf('.');
	const extension = dot > name.lastIndexOf('/') ? name.slice(dot + 1).toLowerCase() : '';
	return MEDIA_TYPES[extension] ?? UNKNOWN_MEDIA_TYPE;
}

// --- FILE paths (ADR-082) ----------------------------------------------------------------------

/** Characters a URI reference may hold as they are; `%` is checked apart, since it needs two hex digits. */
const URI_SAFE = "A-Za-z0-9\\-._~!$&'()*+,;=:@/?#\\[\\]";
const NOT_URI_SAFE = new RegExp(`%(?![0-9A-Fa-f]{2})|[^${URI_SAFE}%]`, 'gu');
/** A scheme of two letters or more, so `C:\` is a drive and `file:` is a URI. */
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;
const WINDOWS_DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

/**
 * What a `FILE` payload is, told from its text alone. A `uri` (`file:`, `https:`) means one thing
 * in both dialects. A `relative` reference is already a valid URI reference. A `path` is 5.5.1's
 * free text (a drive letter, a backslash, a space), which 7.0 does not allow.
 */
function fileReferenceKind(path: string): 'uri' | 'relative' | 'path' {
	if (URI_SCHEME.test(path)) return 'uri';
	if (WINDOWS_DRIVE.test(path) || path.includes('\\')) return 'path';
	return new RegExp(NOT_URI_SAFE.source, 'u').test(path) ? 'path' : 'relative';
}

function percentEncodeUnsafe(text: string): string {
	return text.replace(NOT_URI_SAFE, (char) => {
		try {
			return encodeURIComponent(char);
		} catch {
			return char;
		}
	});
}

/**
 * A `FILE` as 7.0 writes it. A 5.5.1 path becomes a URI reference: `\` becomes `/`, a drive becomes
 * a `file:///C:/…` URI, and anything a URI cannot hold is percent-encoded. The stored text is never
 * changed, so a 5.5.1 export of the same file comes back exactly as it was.
 */
function fileTextFor7(path: string): string {
	if (fileReferenceKind(path) !== 'path') return path;
	let text: string;
	if (WINDOWS_DRIVE.test(path)) text = `file:///${path.replace(/\\/g, '/')}`;
	else if (path.startsWith('\\\\')) text = `file://${path.slice(2).replace(/\\/g, '/')}`;
	else text = path.replace(/\\/g, '/');
	return percentEncodeUnsafe(text);
}

/** A `FILE` as 5.5.1 writes it: a relative reference is percent-decoded, because 5.5.1 means a plain path. */
function fileTextFor551(path: string): string {
	if (fileReferenceKind(path) !== 'relative') return path;
	return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run;
		}
	});
}

/** The format word 5.5.1 uses for a media type, from the same table the other direction reads. */
function formatWordOfMediaType(mediaType: string): string {
	return Object.entries(MEDIA_TYPES).find(([, type]) => type === mediaType)?.[0] ?? mediaType;
}

/**
 * One kept 5.5.1 structure in its 7.0 form, by its parent's tag: a file's `FORM` as a media type and
 * its `TYPE` as `MEDI` (an unknown kind as `OTHER`), and an enumeration in capitals. What needs the
 * structures around a line (`rewriteNodes`) is not done here. A structure 7.0 already wrote comes through unchanged.
 */
function restructure7(line: Line, parentTag: string | undefined): Line[] {
	const { tag, payload } = line;
	if (tag === 'FILE' && parentTag === 'OBJE' && payload) {
		return [{ ...line, payload: fileTextFor7(payload) }];
	}
	if (tag === 'FORM' && parentTag === 'FILE' && payload && !payload.includes('/')) {
		return [{ ...line, payload: MEDIA_TYPES[payload.trim().toLowerCase()] ?? payload }];
	}
	if ((tag === 'TYPE' && parentTag === 'FORM') || tag === 'MEDI') return mediaKind(line);
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
	return rewriteStructures7(out);
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

// --- Rewrites that need the structure around a line ------------------------------------------------

interface Node {
	line: Line | string;
	children: Node[];
}

/** What a rewrite needs to know of the structure above a line. */
interface Parent {
	tag: string;
	/** The 7.0 structure type, undefined inside an extension or anything the spec has no place for. */
	uri?: string;
}

interface LineNode extends Node {
	line: Line;
}

const isLine = (node: Node): node is LineNode => typeof node.line !== 'string';

/** The first child that is a line with this tag. */
const childTagged = (children: readonly Node[], tag: string): LineNode | undefined =>
	children.find((c): c is LineNode => isLine(c) && c.line.tag === tag);

/**
 * Lines nested by level. A line that is not GEDCOM stays where it was, as a child of the last line
 * before it, so flattening gives the order back.
 */
function toTree(items: readonly (Line | string)[]): Node[] {
	const roots: Node[] = [];
	const stack: LineNode[] = [];
	for (const item of items) {
		const node: Node = { line: item, children: [] };
		if (typeof item === 'string') {
			(stack.at(-1)?.children ?? roots).push(node);
			continue;
		}
		while (stack.length > 0 && stack[stack.length - 1].line.level >= item.level) stack.pop();
		(stack.at(-1)?.children ?? roots).push(node);
		stack.push(node as LineNode);
	}
	return roots;
}

function flatten(nodes: readonly Node[]): string[] {
	return nodes.flatMap((node) => [
		typeof node.line === 'string' ? node.line : format(node.line),
		...flatten(node.children)
	]);
}

function uriOf(level: number, tag: string, parent: Parent | undefined): string | undefined {
	if (tag.startsWith('_')) return undefined;
	if (level === 0) return rootOf(tag)?.uri;
	return parent?.uri ? substructureOf(parent.uri, tag)?.uri : undefined;
}

const POINTER = /^@[^@\s]+@$/;
/** A payload meant as a pointer, well formed or not; a malformed one is left for the validator. */
const isPointerLike = (payload: string) =>
	POINTER.test(payload) ||
	(payload.startsWith('@') && !payload.startsWith('@@') && payload.endsWith('@'));
/** A tag as GEDCOM spells one. Anything else is a damaged line, which is not renamed. */
const TAG_NAME = /^[A-Za-z0-9]+$/;

// ASSO.RELA <-> ROLE -----------------------------------------------------------------------------

/** The word 7.0 writes for each role it names; a RELA word that is exactly this needs no PHRASE. */
const ROLE_WORDS: Readonly<Record<string, string>> = {
	CHIL: 'child',
	CLERGY: 'clergy',
	FATH: 'father',
	FRIEND: 'friend',
	GODP: 'godparent',
	HUSB: 'husband',
	MOTH: 'mother',
	MULTIPLE: 'multiple',
	NGHBR: 'neighbor',
	OFFICIATOR: 'officiator',
	PARENT: 'parent',
	SPOU: 'spouse',
	WIFE: 'wife',
	WITN: 'witness'
};

/** Other words 5.5.1 files used for those roles, lower case. */
const ROLE_ALIASES: Readonly<Record<string, string>> = {
	godfather: 'GODP',
	godmother: 'GODP',
	priest: 'CLERGY',
	minister: 'CLERGY',
	neighbour: 'NGHBR',
	officiant: 'OFFICIATOR',
	son: 'CHIL',
	daughter: 'CHIL'
};

/** The `ROLE` value for a `RELA` word, or `OTHER` when 7.0 has none. */
function roleOf(word: string): string {
	const lower = word.trim().toLowerCase();
	const byWord = Object.entries(ROLE_WORDS).find(([, w]) => w === lower)?.[0];
	const role = byWord ?? ROLE_ALIASES[lower] ?? lower.toUpperCase();
	// Checked against the spec table, so a word that is not in it can never be written as a value.
	return role !== 'OTHER' && enumValues(`${V7}enumset-ROLE`)?.includes(role) ? role : 'OTHER';
}

/**
 * `RELA word` as `ROLE value`. The word stays as the `PHRASE` unless it is the value's own word, so
 * `Godfather` is not flattened to `godparent` and reads back as it was written.
 */
function roleNode(line: Line, children: Node[]): Node {
	const word = line.payload?.trim() ?? '';
	const role = roleOf(word);
	const phrase: Node[] =
		word && word !== ROLE_WORDS[role]
			? [
					{
						line: { level: line.level + 1, tag: 'PHRASE', payload: escapeText(word) },
						children: []
					}
				]
			: [];
	return { line: { ...line, tag: 'ROLE', payload: role }, children: [...phrase, ...children] };
}

// FONE / ROMN <-> TRAN ---------------------------------------------------------------------------

/**
 * The language a 5.5.1 `TYPE` implies for a phonetic (`FONE`) or romanized (`ROMN`) variation, by
 * lower-case type word. A romanization with no type is `und-Latn`. A phonetic variation with no
 * type, and either kind with a type 7.0 has no language for, has no faithful `TRAN`: it is kept as
 * the extension `_FONE` / `_ROMN` rather than guess a language.
 */
const VARIATION_LANGUAGES = {
	FONE: { hangul: 'ko-Hang', kana: 'ja-Kana' },
	ROMN: {
		pinyin: 'zh-Latn-pinyin',
		romanji: 'ja-Latn',
		romaji: 'ja-Latn',
		wadegiles: 'zh-Latn-wadegile'
	}
} as const satisfies Record<string, Record<string, string>>;

const UNTYPED_ROMN_LANGUAGE = 'und-Latn';

/** The tag and `TYPE` 5.5.1 gets back for a `TRAN` language, by lower-case language. */
const VARIATION_FROM_LANGUAGE: Readonly<Record<string, { tag: 'FONE' | 'ROMN'; type?: string }>> = {
	'ko-hang': { tag: 'FONE', type: 'hangul' },
	'ja-kana': { tag: 'FONE', type: 'kana' },
	'zh-latn-pinyin': { tag: 'ROMN', type: 'pinyin' },
	'ja-latn': { tag: 'ROMN', type: 'romanji' },
	'zh-latn-wadegile': { tag: 'ROMN', type: 'wadegiles' },
	[UNTYPED_ROMN_LANGUAGE.toLowerCase()]: { tag: 'ROMN' }
};

const isVariationParent = (tag: string | undefined) => tag === 'NAME' || tag === 'PLAC';

/** The `TRAN` for a `FONE`/`ROMN` node, or null when its type has no language. */
function translationNode(node: LineNode): Node | null {
	const tag = node.line.tag as 'FONE' | 'ROMN';
	const typeNode = childTagged(node.children, 'TYPE');
	const type = typeNode?.line.payload?.trim().toLowerCase();
	const languages: Readonly<Record<string, string>> = VARIATION_LANGUAGES[tag];
	const language = type ? languages[type] : tag === 'ROMN' ? UNTYPED_ROMN_LANGUAGE : undefined;
	if (!language) return null;
	return {
		line: { ...node.line, tag: 'TRAN' },
		children: [
			{ line: { level: node.line.level + 1, tag: 'LANG', payload: language }, children: [] },
			...node.children.filter((c) => c !== typeNode)
		]
	};
}

// Inline SOUR -> a pointer to a new record -------------------------------------------------------

/** What the rewrite adds to the file or has to avoid colliding with. */
interface Context {
	/** Every xref the file defines, plus those made here. */
	xrefs: Set<string>;
	/** The record made for each inline source text. */
	sources: Map<string, string>;
	/** The records made, in order, to go before the trailer. */
	records: Node[];
}

/** FNV-1a, 32 bits: only to make the same text give the same xref, not for security. */
function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * The xref of the `SOUR` record whose `TITL` is `text`, made on first use. The id comes from the
 * text, so one export always gives the same ids, and the same words cited twice share a record.
 */
function sourceRecordFor(text: string, ctx: Context): string {
	const known = ctx.sources.get(text);
	if (known) return known;
	const base = `SOUR_${hashText(text)}`;
	let xref = `@${base}@`;
	for (let n = 2; ctx.xrefs.has(xref); n++) xref = `@${base}_${n}@`;
	ctx.xrefs.add(xref);
	ctx.sources.set(text, xref);
	const [first, ...rest] = text.split('\n');
	ctx.records.push({
		line: { level: 0, xref, tag: 'SOUR' },
		children: [
			{
				line: { level: 1, tag: 'TITL', payload: first },
				children: rest.map((more) => ({
					line: { level: 2, tag: 'CONT', payload: more },
					children: []
				}))
			}
		]
	});
	return xref;
}

// The walk ---------------------------------------------------------------------------------------

function rewriteNodes(nodes: readonly Node[], parent: Parent | undefined, ctx: Context): Node[] {
	return nodes.flatMap((node) => (isLine(node) ? rewriteNode(node, parent, ctx) : [node]));
}

/**
 * One kept 5.5.1 structure in 7.0 form, where the rule needs its parent or its children:
 * `RELA` as `ROLE`, `FONE`/`ROMN` as `TRAN`, a shared note as `SNOTE`, an inline source as a pointer
 * to a record, a `FILE` with its `FORM`, `URL` as `WWW`, and any other tag the spec has no place for
 * (or a pointer tag with no pointer, such as an embedded `OBJE`) as an extension (underscore prefix). Nothing inside an extension is touched: the spec says nothing
 * of what is there.
 */
function rewriteNode(node: LineNode, parent: Parent | undefined, ctx: Context): Node[] {
	let line = node.line;
	let children = node.children;
	const parentUri = line.level > 0 ? parent?.uri : undefined;

	if (line.level === 0) {
		if (line.xref && line.tag === 'NOTE') line = { ...line, tag: 'SNOTE' };
		else if (TAG_NAME.test(line.tag) && !rootOf(line.tag)) line = { ...line, tag: `_${line.tag}` };
	} else if (parentUri) {
		if (line.tag === 'RELA' && parent?.tag === 'ASSO') {
			return rewriteNodes([roleNode(line, children)], parent, ctx);
		}
		if ((line.tag === 'FONE' || line.tag === 'ROMN') && isVariationParent(parent?.tag)) {
			const tran = translationNode(node);
			if (tran) return rewriteNodes([tran], parent, ctx);
		}
		if (line.tag === 'NOTE' && line.payload && POINTER.test(line.payload)) {
			line = { ...line, tag: 'SNOTE' };
		}
		if (
			line.tag === 'SOUR' &&
			line.payload &&
			!isPointerLike(line.payload) &&
			substructureOf(parentUri, 'SOUR')?.uri === `${V7}SOUR`
		) {
			// The text of a source with no record continues on `CONT` lines, which belong to the title.
			const continuation = children.filter(
				(c): c is LineNode => isLine(c) && c.line.tag === 'CONT'
			);
			const text = [line.payload, ...continuation.map((c) => c.line.payload ?? '')].join('\n');
			line = { ...line, payload: sourceRecordFor(text, ctx) };
			children = children.filter((c) => !continuation.includes(c as LineNode));
		}
		if (TAG_NAME.test(line.tag) && line.tag !== 'CONT' && line.tag !== 'CONC') {
			const sub = substructureOf(parentUri, line.tag);
			if (!sub) {
				const isWebAddress = line.tag === 'URL' && substructureOf(parentUri, 'WWW');
				line = { ...line, tag: isWebAddress ? 'WWW' : `_${line.tag}` };
			} else if (
				structureByUri(sub.uri)?.payload.kind === 'pointer' &&
				!(line.payload && isPointerLike(line.payload))
			) {
				// 5.5.1 embedded an `OBJE` and its `FILE` where 7.0 allows only a pointer. Until media are
				// modelled it is kept whole as an extension, which keeps what is inside it.
				line = { ...line, tag: `_${line.tag}` };
			}
		}
	}

	const uri = uriOf(line.level, line.tag, parent);
	if (uri === `${V7}FILE`) children = withFileForm(line, children);
	return [{ line, children: rewriteNodes(children, { tag: line.tag, uri }, ctx) }];
}

/**
 * The children of a `FILE` with a valid `FORM`: 7.0 requires one media type, where 5.5.1 allowed
 * none, an empty one, or a word that is not a media type. What the file's name implies stands in,
 * and `application/octet-stream` when it implies nothing.
 */
function withFileForm(file: Line, children: Node[]): Node[] {
	const form = childTagged(children, 'FORM');
	const inferred = mediaTypeOfPath(file.payload);
	if (!form) {
		return [
			{ line: { level: file.level + 1, tag: 'FORM', payload: inferred }, children: [] },
			...children
		];
	}
	if (form.line.payload?.includes('/')) return children;
	return children.map((c) =>
		c === form ? { ...form, line: { ...form.line, payload: inferred } } : c
	);
}

/** The structure-aware rewrites over lines that have had their line-level conversion. */
function rewriteStructures7(items: readonly (Line | string)[]): string[] {
	const roots = toTree(items);
	const xrefs = new Set<string>();
	for (const node of roots) if (isLine(node) && node.line.xref) xrefs.add(node.line.xref);
	const ctx: Context = { xrefs, sources: new Map(), records: [] };
	const rewritten = rewriteNodes(roots, undefined, ctx);
	// New records go before the trailer, which must stay last.
	const trailer = rewritten.findLastIndex(
		(n) => isLine(n) && n.line.level === 0 && n.line.tag === 'TRLR'
	);
	const at = trailer === -1 ? rewritten.length : trailer;
	return flatten([...rewritten.slice(0, at), ...ctx.records, ...rewritten.slice(at)]);
}

/**
 * Lines in 5.5.1 form: the dates a 7.0 file brought in, written with 5.5.1's calendar escapes, and
 * the 7.0 structures that have a 5.5.1 spelling put back (`ROLE` as `RELA`, `TRAN` as `FONE` or
 * `ROMN`, the extensions `_FONE` and `_ROMN` as the tags they stand for).
 */
export function toGedcom551Lines(lines: readonly string[]): string[] {
	return flatten(rewriteNodes551(toTree(lines.map((raw) => parse(raw) ?? raw)), undefined));
}

function rewriteNodes551(nodes: readonly Node[], parentTag: string | undefined): Node[] {
	return nodes.map((node) => {
		if (!isLine(node)) return node;
		let { line, children } = node;
		if (line.tag === 'DATE' && line.payload) {
			line = { ...line, payload: toGedcom551Date(line.payload) };
		} else if (line.tag === 'ROLE' && parentTag === 'ASSO') {
			const phrase = childTagged(children, 'PHRASE');
			const word =
				phrase?.line.payload ??
				(line.payload === 'OTHER' ? 'other' : ROLE_WORDS[line.payload ?? '']) ??
				line.payload;
			line = { ...line, tag: 'RELA', payload: word };
			children = children.filter((c) => c !== phrase);
		} else if (isVariationParent(parentTag) && line.tag === 'TRAN') {
			const language = childTagged(children, 'LANG');
			const variation = VARIATION_FROM_LANGUAGE[(language?.line.payload ?? '').toLowerCase()];
			if (variation) {
				line = { ...line, tag: variation.tag };
				children = children.filter((c) => c !== language);
				if (variation.type) {
					const type: Node = {
						line: { level: line.level + 1, tag: 'TYPE', payload: variation.type },
						children: []
					};
					children = [type, ...children];
				}
			}
		} else if (isVariationParent(parentTag) && (line.tag === '_FONE' || line.tag === '_ROMN')) {
			line = { ...line, tag: line.tag.slice(1) };
		} else if (line.tag === 'FILE' && parentTag === 'OBJE' && line.payload) {
			line = { ...line, payload: fileTextFor551(line.payload) };
		} else if (line.tag === 'FORM' && parentTag === 'FILE' && line.payload?.includes('/')) {
			line = { ...line, payload: formatWordOfMediaType(line.payload) };
		}
		return { line, children: rewriteNodes551(children, line.tag) };
	});
}
