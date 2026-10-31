/**
 * A diff of two GEDCOM 7 texts by meaning, not bytes. It exists to measure what an import and
 * export loses (ADR-036), so it normalises only what 7.0 calls meaningless or what Epoch changes
 * on purpose, and reports everything else.
 *
 * Normalised away: xref text (records are matched structurally and pointers compared through the
 * match), line terminators, a leading BOM, `CONT`/`CONC` versus one line, the `@@` escape, the
 * order of substructures (except the same-tag runs in `ORDERED_TAGS`), `CHAN`, a `NAME`'s
 * `GIVN`/`SURN` that only restate its payload, and every `HEAD` line other than `GEDC`, `SCHMA`
 * and `LANG`. A `SUBM` record that only the export has is ignored, because Epoch writes one from
 * the tree's settings.
 */

import { buildGedcomTree, type GedcomNode } from './node';

/**
 * Tags whose repeats are ordered in 7.0: the first `NAME` is the preferred one, and `CHIL` order
 * is birth order. Every other repeated tag is compared as a set.
 */
const ORDERED_TAGS: ReadonlySet<string> = new Set(['NAME', 'CHIL']);
const KEPT_HEAD_TAGS: ReadonlySet<string> = new Set(['GEDC', 'SCHMA', 'LANG']);
const POINTER = /^@([^@\s#][^@\s]*)@$/;
const MAX_SNIPPET_CHARS = 90;

/** One line of the diff. `path` has no indices, so a test can allowlist a cause by it. */
interface GedcomDiffEntry {
	kind: 'missing' | 'added' | 'changed';
	/** Record tag then substructure tags, such as `INDI.BIRT.DATE`. */
	path: string;
	/** The record, as `INDI @I1@ (Ann /Ash/)`, for a reader. */
	record: string;
	before?: string;
	after?: string;
}

export interface GedcomDiff {
	recordsMissing: string[];
	recordsAdded: string[];
	changes: GedcomDiffEntry[];
	isEmpty: boolean;
}

/** A node with its text folded and its pointer split out. */
interface CNode {
	tag: string;
	text: string;
	/** The xref the payload points at, when it is a pointer. */
	pointer?: string;
	children: CNode[];
}

interface RecordInfo {
	/** Position in its file, which stands in for the xref when records are paired. */
	index: number;
	tag: string;
	xref: string;
	node: CNode;
}

function foldText(node: GedcomNode): string {
	let text = unescapeAt(node.value ?? '');
	for (const child of node.children) {
		if (child.tag === 'CONT') text += `\n${unescapeAt(child.value ?? '')}`;
		else if (child.tag === 'CONC') text += unescapeAt(child.value ?? '');
	}
	return text;
}

/** 7.0 doubles only a leading `@`; a 5.5.1 file may double it elsewhere, so every line is read. */
function unescapeAt(line: string): string {
	return line.startsWith('@@') ? line.slice(1) : line;
}

/**
 * The `GIVN` and `SURN` a `NAME` payload already says. Epoch writes these parts out whenever it
 * has the name, and a part that only restates the payload adds no meaning, so it is not compared.
 */
function restatedNameParts(payload: string): Map<string, string> {
	const parts = new Map<string, string>();
	const [, given, surname] = /^([^/]*)\/([^/]*)\//.exec(payload) ?? [];
	if (given?.trim()) parts.set('GIVN', given.trim());
	if (surname?.trim()) parts.set('SURN', surname.trim());
	return parts;
}

function canonical(node: GedcomNode, isHead = false): CNode {
	const pointerMatch = node.value !== undefined ? POINTER.exec(node.value) : null;
	const restated = node.tag === 'NAME' ? restatedNameParts(foldText(node)) : null;
	const children = node.children
		.filter((c) => c.tag !== 'CONT' && c.tag !== 'CONC' && c.tag !== 'CHAN')
		.filter((c) => !isHead || KEPT_HEAD_TAGS.has(c.tag))
		.filter((c) => !restated || restated.get(c.tag) !== foldText(c).trim())
		.map((c) => canonical(c));
	return {
		tag: node.tag,
		text: pointerMatch ? '' : foldText(node),
		pointer: pointerMatch?.[1],
		children
	};
}

function readRecords(text: string): RecordInfo[] {
	const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
	const records: RecordInfo[] = [];
	for (const root of buildGedcomTree(lines)) {
		if (root.tag === 'TRLR') continue;
		const isHead = root.tag === 'HEAD';
		records.push({
			index: records.length,
			tag: root.tag,
			xref: root.xref?.slice(1, -1) ?? '',
			node: canonical(root, isHead)
		});
	}
	return records;
}

const childText = (node: CNode, ...path: string[]): string => {
	let current: CNode | undefined = node;
	for (const tag of path) current = current?.children.find((c) => c.tag === tag);
	return current?.text ?? '';
};

const childrenOf = (node: CNode, tag: string) => node.children.filter((c) => c.tag === tag);

/**
 * How a pointer reads on one side: the before-file xref of the record it resolves to, so the same
 * target renders the same on both sides whatever its xref was renamed to. `null` for a target the
 * file does not have, which then renders as the xref text itself.
 */
type Resolve = (xref: string) => string | null;

function valueOf(node: CNode, resolve: Resolve): string {
	if (node.pointer === undefined) return node.text;
	if (node.pointer === 'VOID') return '@VOID@';
	return `@${resolve(node.pointer) ?? node.pointer}@`;
}

/** The subtree as one canonical string; equal strings mean equal meaning. */
function render(node: CNode, resolve: Resolve): string {
	const kids = node.children.map((c) => render(c, resolve));
	if (!kids.length) return `${node.tag} ${valueOf(node, resolve)}`;
	// Sorting loses the order of an ordered run, so those tags keep file order inside a tag group.
	const groups = new Map<string, string[]>();
	node.children.forEach((c, i) => {
		const list = groups.get(c.tag) ?? [];
		list.push(kids[i]);
		groups.set(c.tag, list);
	});
	const parts = [...groups.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([tag, list]) => (ORDERED_TAGS.has(tag) ? list : [...list].sort()).join(' '));
	return `${node.tag} ${valueOf(node, resolve)} {${parts.join('; ')}}`;
}

function snippet(node: CNode, resolve: Resolve): string {
	const lines: string[] = [];
	const walk = (n: CNode) => {
		const value = valueOf(n, resolve).replace(/\n/g, '\\n');
		lines.push(`${n.tag}${value ? ` ${value}` : ''}`);
		for (const c of n.children) walk(c);
	};
	walk(node);
	const joined = lines.join(' / ');
	return joined.length > MAX_SNIPPET_CHARS ? `${joined.slice(0, MAX_SNIPPET_CHARS - 1)}…` : joined;
}

function short(text: string): string {
	const flat = text.replace(/\n/g, '\\n');
	return flat.length > MAX_SNIPPET_CHARS ? `${flat.slice(0, MAX_SNIPPET_CHARS - 1)}…` : flat;
}

/** Identity that survives a rewrite: `UID`/`EXID` when present, else what the record says of itself. */
function fingerprint(
	record: RecordInfo,
	resolve: Resolve,
	targetTag: (xref: string) => string
): string {
	const uid = childText(record.node, 'UID');
	if (uid) return `uid:${record.tag}:${uid}`;
	const exids = childrenOf(record.node, 'EXID')
		.map((n) => `${n.text}|${childText(n, 'TYPE')}`)
		.sort();
	if (exids.length) return `exid:${record.tag}:${exids.join(',')}`;
	const n = record.node;
	if (record.tag === 'INDI') {
		const parts = [
			childrenOf(n, 'NAME')
				.map((c) => c.text)
				.join('|'),
			childText(n, 'SEX'),
			childText(n, 'BIRT', 'DATE'),
			childText(n, 'DEAT', 'DATE')
		];
		return parts.some(Boolean) ? `INDI:${parts.join('~')}` : '';
	}
	if (record.tag === 'FAM') {
		const partners = [...childrenOf(n, 'HUSB'), ...childrenOf(n, 'WIFE')]
			.map((c) => (c.pointer ? (resolve(c.pointer) ?? '') : ''))
			.sort();
		if (!partners.some(Boolean)) return '';
		return `FAM:${partners.join(',')}~${childText(n, 'MARR', 'DATE')}`;
	}
	// Pointers are masked to the target's kind: they may not be matched yet, and a fingerprint
	// that depended on them could never be computed for a cycle.
	const masked = (node: CNode): string =>
		`${node.tag}=${
			node.pointer !== undefined
				? node.pointer === 'VOID'
					? '@VOID@'
					: `@${targetTag(node.pointer)}@`
				: node.text
		}[${node.children.map(masked).sort().join(',')}]`;
	return `${record.tag}:${masked(n)}`;
}

function label(record: RecordInfo): string {
	const name = childrenOf(record.node, 'NAME')[0]?.text ?? childText(record.node, 'TITL');
	const id = record.xref ? ` @${record.xref}@` : '';
	return `${record.tag}${id}${name ? ` (${short(name)})` : ''}`;
}

/**
 * Pair the records of the two files. Identity keys first, then content fingerprints, then
 * position among what is left, so a record that changed in place still reports as a change
 * instead of a loss and an addition.
 */
function matchRecords(before: RecordInfo[], after: RecordInfo[]): Map<number, number> {
	const beforeOf = new Map<number, number>(); // after index -> before index
	const afterOf = new Map<number, number>(); // before index -> after index
	const xrefIndex = (records: RecordInfo[]) =>
		new Map(records.filter((r) => r.xref).map((r) => [r.xref, r.index] as const));
	const beforeByXref = xrefIndex(before);
	const afterByXref = xrefIndex(after);

	const resolveBefore: Resolve = (x) => (beforeByXref.has(x) ? x : null);
	const resolveAfter: Resolve = (x) => {
		const a = afterByXref.get(x);
		if (a === undefined) return null;
		const b = beforeOf.get(a);
		return b === undefined ? null : before[b].xref;
	};
	const tagOf = (records: RecordInfo[], byXref: Map<string, number>) => (x: string) =>
		byXref.has(x) ? records[byXref.get(x)!].tag : '?';

	const pass = (isEligible: (r: RecordInfo) => boolean) => {
		const pools = new Map<string, number[]>();
		for (const r of after) {
			if (beforeOf.has(r.index) || !isEligible(r)) continue;
			const key = fingerprint(r, resolveAfter, tagOf(after, afterByXref));
			if (key) pools.set(key, [...(pools.get(key) ?? []), r.index]);
		}
		for (const r of before) {
			if (afterOf.has(r.index) || !isEligible(r)) continue;
			const key = fingerprint(r, resolveBefore, tagOf(before, beforeByXref));
			const candidate = key ? pools.get(key)?.shift() : undefined;
			if (candidate === undefined) continue;
			afterOf.set(r.index, candidate);
			beforeOf.set(candidate, r.index);
		}
	};

	// HEAD is unique. Partnerships wait for the people they name to be matched.
	for (const r of before) {
		const a = after.find((x) => x.tag === 'HEAD');
		if (r.tag === 'HEAD' && a) {
			afterOf.set(r.index, a.index);
			beforeOf.set(a.index, r.index);
		}
	}
	pass((r) => r.tag !== 'FAM' && r.tag !== 'HEAD');
	pass((r) => r.tag === 'FAM');
	// Last resort: the leftovers of one kind, in file order.
	for (const r of before) {
		if (afterOf.has(r.index)) continue;
		const candidate = after.find((x) => x.tag === r.tag && !beforeOf.has(x.index));
		if (!candidate) continue;
		afterOf.set(r.index, candidate.index);
		beforeOf.set(candidate.index, r.index);
	}
	return afterOf;
}

/** Diff two subtrees already known to sit at the same place. */
function diffNodes(
	path: string,
	record: string,
	a: CNode,
	b: CNode,
	resolveA: Resolve,
	resolveB: Resolve,
	out: GedcomDiffEntry[]
): void {
	const va = valueOf(a, resolveA);
	const vb = valueOf(b, resolveB);
	if (va !== vb) out.push({ kind: 'changed', path, record, before: short(va), after: short(vb) });

	const tags = [...new Set([...a.children, ...b.children].map((c) => c.tag))];
	for (const tag of tags) {
		const la = childrenOf(a, tag);
		const lb = childrenOf(b, tag);
		const here = `${path}.${tag}`;
		const ra = la.map((c) => render(c, resolveA));
		const rb = lb.map((c) => render(c, resolveB));
		const pairs: Array<[CNode, CNode]> = [];
		const lostA: CNode[] = [];
		const lostB: CNode[] = [];
		if (ORDERED_TAGS.has(tag)) {
			for (let i = 0; i < Math.max(la.length, lb.length); i++) {
				if (i >= la.length) lostB.push(lb[i]);
				else if (i >= lb.length) lostA.push(la[i]);
				else if (ra[i] !== rb[i]) pairs.push([la[i], lb[i]]);
			}
		} else {
			const unusedB = new Set(lb.keys());
			const unmatchedA: number[] = [];
			la.forEach((_, i) => {
				const j = [...unusedB].find((k) => rb[k] === ra[i]);
				if (j === undefined) unmatchedA.push(i);
				else unusedB.delete(j);
			});
			// Same-valued leftovers pair first so a changed child reads as a change, not a swap.
			const restB = new Set(unusedB);
			for (const i of unmatchedA) {
				const j = [...restB].find(
					(k) => lb[k].text === la[i].text && lb[k].pointer === la[i].pointer
				);
				const pick = j ?? [...restB][0];
				if (pick === undefined) lostA.push(la[i]);
				else {
					restB.delete(pick);
					pairs.push([la[i], lb[pick]]);
				}
			}
			for (const j of restB) lostB.push(lb[j]);
		}
		for (const [x, y] of pairs) diffNodes(here, record, x, y, resolveA, resolveB, out);
		for (const x of lostA)
			out.push({ kind: 'missing', path: here, record, before: snippet(x, resolveA) });
		for (const y of lostB)
			out.push({ kind: 'added', path: here, record, after: snippet(y, resolveB) });
	}
}

export function semanticDiff(before: string, after: string): GedcomDiff {
	const recordsBefore = readRecords(before);
	const recordsAfter = readRecords(after);
	const afterOf = matchRecords(recordsBefore, recordsAfter);
	const beforeOf = new Map([...afterOf].map(([b, a]) => [a, b] as const));

	const byXrefBefore = new Map(recordsBefore.filter((r) => r.xref).map((r) => [r.xref, r]));
	const byXrefAfter = new Map(recordsAfter.filter((r) => r.xref).map((r) => [r.xref, r]));
	const resolveBefore: Resolve = (x) => byXrefBefore.get(x)?.xref ?? null;
	const resolveAfter: Resolve = (x) => {
		const record = byXrefAfter.get(x);
		const partner = record ? beforeOf.get(record.index) : undefined;
		return partner === undefined ? null : recordsBefore[partner].xref;
	};

	const diff: GedcomDiff = { recordsMissing: [], recordsAdded: [], changes: [], isEmpty: true };
	for (const r of recordsBefore) {
		const partner = afterOf.get(r.index);
		if (partner === undefined) {
			diff.recordsMissing.push(label(r));
			continue;
		}
		diffNodes(
			r.tag,
			label(r),
			r.node,
			recordsAfter[partner].node,
			resolveBefore,
			resolveAfter,
			diff.changes
		);
	}
	const hasSubmitter = recordsBefore.some((r) => r.tag === 'SUBM');
	for (const r of recordsAfter) {
		if (beforeOf.has(r.index)) continue;
		if (r.tag === 'SUBM' && !hasSubmitter) continue;
		diff.recordsAdded.push(label(r));
	}
	diff.isEmpty =
		diff.recordsMissing.length === 0 && diff.recordsAdded.length === 0 && diff.changes.length === 0;
	return diff;
}

/** The diff as short plain text, empty when there is none, for a test failure to print. */
export function formatGedcomDiff(diff: GedcomDiff): string {
	const lines: string[] = [];
	for (const r of diff.recordsMissing) lines.push(`- record ${r}`);
	for (const r of diff.recordsAdded) lines.push(`+ record ${r}`);
	for (const c of diff.changes) {
		const mark = c.kind === 'missing' ? '-' : c.kind === 'added' ? '+' : '~';
		const detail = c.kind === 'changed' ? `${c.before} => ${c.after}` : (c.before ?? c.after ?? '');
		lines.push(`${mark} ${c.path}: ${detail}  [${c.record}]`);
	}
	return lines.join('\n');
}
