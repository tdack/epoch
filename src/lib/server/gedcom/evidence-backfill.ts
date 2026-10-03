/**
 * Moves the evidence a tree kept as retained lines (imported before ADR-028) into records.
 *
 * Pure: `scripts/backfill-evidence.mjs` reads the rows `BACKFILL_QUERIES` names, hands them to
 * `evidenceBackfillStatements`, and runs the SQL it returns. The lines are read with the import's own
 * parser and become rows with the import's own row builders (`evidence-rows.ts`), so a tree backfilled
 * from retained lines and the same file imported afresh hold the same records.
 *
 * Idempotent by construction: a line is removed from where it was kept in the same run that stores
 * it, so a second run finds nothing to move. A line that cannot be placed (a `FAMC` whose family or
 * parent is gone) is left where it is.
 */

import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { citations, repositories, sourceRepositories, sources } from '../db/schema';
import { CITATION_SUBJECT_KINDS, type CitationSubjectKind } from '../../shared/evidence';
import { buildGedcomTree, collectLines, type GedcomNode } from './node';
import {
	parseCitation,
	parseRepositoryRecord,
	parseSourceRecord,
	type ParsedCitation
} from './evidence-parse';
import { citationRow, repositoryRow, sourceRepositoryRow, sourceRow } from './evidence-rows';
import { treeScopedId } from './import-preview';

/** The reads the backfill needs, as plain SQL so the script can run them through wrangler. */
export const BACKFILL_QUERIES = {
	preserved:
		'SELECT id, tree_id, owner_xref, lines FROM gedcom_preserved ORDER BY tree_id, "order"',
	events:
		'SELECT id, tree_id, entity_type, entity_id, gedcom_extra FROM events WHERE gedcom_extra IS NOT NULL ORDER BY rowid',
	names:
		'SELECT n.id AS id, i.tree_id AS tree_id, n.gedcom_extra AS gedcom_extra FROM person_names n JOIN individuals i ON i.id = n.person_id WHERE n.gedcom_extra IS NOT NULL ORDER BY n.rowid',
	individuals: 'SELECT id, tree_id, xref_id, xref_aliases FROM individuals',
	unions: 'SELECT id, tree_id, xref_aliases FROM unions',
	partners: 'SELECT union_id, person_id, "order" AS "order" FROM union_partners',
	links:
		'SELECT id, tree_id, parent_id, child_id, union_id FROM parent_child WHERE union_id IS NOT NULL ORDER BY rowid',
	sources: 'SELECT id, tree_id, xref, xref_aliases FROM sources',
	repositories: 'SELECT id, tree_id, xref, xref_aliases FROM repositories',
	citationOrder:
		'SELECT subject_kind, subject_id, max(sort_order) + 1 AS next FROM citations GROUP BY subject_kind, subject_id'
} as const;

/** What each query answers, as D1 returns it: JSON columns still text. */
export interface BackfillInput {
	preserved: Array<{ id: string; tree_id: string; owner_xref: string | null; lines: string }>;
	events: Array<{
		id: string;
		tree_id: string;
		entity_type: string;
		entity_id: string;
		gedcom_extra: string;
	}>;
	names: Array<{ id: string; tree_id: string; gedcom_extra: string }>;
	individuals: Array<{
		id: string;
		tree_id: string;
		xref_id: string | null;
		xref_aliases: string | null;
	}>;
	unions: Array<{ id: string; tree_id: string; xref_aliases: string | null }>;
	partners: Array<{ union_id: string; person_id: string; order: number }>;
	links: Array<{
		id: string;
		tree_id: string;
		parent_id: string;
		child_id: string;
		union_id: string;
	}>;
	sources: Array<{ id: string; tree_id: string; xref: string | null; xref_aliases: string | null }>;
	repositories: Array<{
		id: string;
		tree_id: string;
		xref: string | null;
		xref_aliases: string | null;
	}>;
	citationOrder: Array<{ subject_kind: string; subject_id: string; next: number }>;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A value as SQL text, in the form Drizzle stores it: timestamps in whole seconds, JSON as text. */
function literal(value: unknown, columnType: string): string {
	if (value === null || value === undefined) return 'NULL';
	if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (columnType === 'SQLiteTextJson') return quote(JSON.stringify(value));
	return quote(String(value));
}

function insertStatement(table: SQLiteTable, row: Record<string, unknown>): string {
	const columns = getTableColumns(table) as Record<string, { name: string; columnType: string }>;
	const keys = Object.keys(row).filter((key) => row[key] !== undefined && columns[key]);
	return (
		`INSERT OR IGNORE INTO ${(table as unknown as Record<symbol, string>)[Symbol.for('drizzle:Name')]} ` +
		`(${keys.map((k) => `"${columns[k].name}"`).join(', ')}) VALUES ` +
		`(${keys.map((k) => literal(row[k], columns[k].columnType)).join(', ')});`
	);
}

const jsonList = (text: string | null): string[] => {
	if (!text) return [];
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
};

/** A tree's lookups, built once from the rows. */
interface TreeIndex {
	personByXref: Map<string, string>;
	unionByXref: Map<string, string>;
	sourceByXref: Map<string, string>;
	repositoryByXref: Map<string, string>;
	/** Partners of a union, first first. */
	partners: Map<string, string[]>;
	/** The link row filed under a union for a child by one parent. */
	linkOf: Map<string, string>;
}

function indexTrees(input: BackfillInput): Map<string, TreeIndex> {
	const trees = new Map<string, TreeIndex>();
	const of = (treeId: string) => {
		let index = trees.get(treeId);
		if (!index) {
			index = {
				personByXref: new Map(),
				unionByXref: new Map(),
				sourceByXref: new Map(),
				repositoryByXref: new Map(),
				partners: new Map(),
				linkOf: new Map()
			};
			trees.set(treeId, index);
		}
		return index;
	};
	for (const p of input.individuals) {
		const index = of(p.tree_id);
		if (p.xref_id) index.personByXref.set(p.xref_id, p.id);
		for (const alias of jsonList(p.xref_aliases)) index.personByXref.set(alias, p.id);
	}
	for (const u of input.unions) {
		const index = of(u.tree_id);
		const prefix = `${u.tree_id}:`;
		if (u.id.startsWith(prefix)) index.unionByXref.set(u.id.slice(prefix.length), u.id);
		for (const alias of jsonList(u.xref_aliases)) index.unionByXref.set(alias, u.id);
	}
	for (const s of input.sources) {
		const index = of(s.tree_id);
		if (s.xref) index.sourceByXref.set(s.xref, s.id);
		for (const alias of jsonList(s.xref_aliases)) index.sourceByXref.set(alias, s.id);
	}
	for (const r of input.repositories) {
		const index = of(r.tree_id);
		if (r.xref) index.repositoryByXref.set(r.xref, r.id);
		for (const alias of jsonList(r.xref_aliases)) index.repositoryByXref.set(alias, r.id);
	}
	const unionTree = new Map(input.unions.map((u) => [u.id, u.tree_id] as const));
	for (const p of [...input.partners].sort((a, b) => a.order - b.order)) {
		const treeId = unionTree.get(p.union_id);
		if (!treeId) continue;
		const index = of(treeId);
		index.partners.set(p.union_id, [...(index.partners.get(p.union_id) ?? []), p.person_id]);
	}
	for (const link of input.links) {
		const key = `${link.union_id}|${link.child_id}|${link.parent_id}`;
		if (!of(link.tree_id).linkOf.has(key)) of(link.tree_id).linkOf.set(key, link.id);
	}
	return trees;
}

/**
 * The SQL that stores every piece of retained evidence as a record and removes it from where it was
 * kept. Empty when there is nothing left to move.
 */
export function evidenceBackfillStatements(input: BackfillInput, now = new Date()): string[] {
	const statements: string[] = [];
	const trees = indexTrees(input);
	const nextOrder = new Map<string, number>(
		input.citationOrder.map((c) => [`${c.subject_kind}|${c.subject_id}`, c.next] as const)
	);
	const removedPreserved = new Set<string>();

	const store = (
		treeId: string,
		index: TreeIndex,
		kind: CitationSubjectKind,
		subjectId: string,
		list: ParsedCitation[]
	) => {
		for (const parsed of list) {
			const key = `${kind}|${subjectId}`;
			const order = nextOrder.get(key) ?? 0;
			nextOrder.set(key, order + 1);
			const sourceId = parsed.pointer ? (index.sourceByXref.get(parsed.pointer) ?? null) : null;
			statements.push(
				insertStatement(
					citations,
					citationRow(
						treeId,
						crypto.randomUUID(),
						{ kind, id: subjectId },
						parsed,
						sourceId,
						order,
						now
					)
				)
			);
		}
	};

	const preservedByTree = new Map<string, BackfillInput['preserved']>();
	for (const p of input.preserved)
		preservedByTree.set(p.tree_id, [...(preservedByTree.get(p.tree_id) ?? []), p]);

	for (const [treeId, entries] of preservedByTree) {
		const index = trees.get(treeId);
		if (!index) continue;
		const rootsOf = (tag: 'SOUR' | 'REPO') =>
			entries.flatMap((entry) => {
				const lines = jsonList(entry.lines);
				const node = lines[0]?.startsWith('0 ') ? buildGedcomTree(lines, 0)[0] : undefined;
				return node?.tag === tag && node.xref ? [{ entry, node }] : [];
			});

		// Records before the citations that point at them, repositories before the sources that link them.
		for (const { entry, node } of rootsOf('REPO')) {
			removedPreserved.add(entry.id);
			if (index.repositoryByXref.has(node.xref!)) continue;
			const id = treeScopedId(treeId, node.xref!);
			index.repositoryByXref.set(node.xref!, id);
			statements.push(
				insertStatement(repositories, repositoryRow(treeId, id, parseRepositoryRecord(node), now))
			);
		}
		for (const { entry, node } of rootsOf('SOUR')) {
			removedPreserved.add(entry.id);
			if (index.sourceByXref.has(node.xref!)) continue;
			const id = treeScopedId(treeId, node.xref!);
			index.sourceByXref.set(node.xref!, id);
			const parsed = parseSourceRecord(node);
			statements.push(insertStatement(sources, sourceRow(treeId, id, parsed, now)));
			parsed.repositories.forEach((link, order) =>
				statements.push(
					insertStatement(
						sourceRepositories,
						sourceRepositoryRow(
							crypto.randomUUID(),
							id,
							link,
							link.pointer ? (index.repositoryByXref.get(link.pointer) ?? null) : null,
							order,
							now
						)
					)
				)
			);
		}

		for (const entry of entries) {
			if (removedPreserved.has(entry.id) || !entry.owner_xref) continue;
			const lines = jsonList(entry.lines);
			const head = lines[0] ?? '';
			const personId = index.personByXref.get(entry.owner_xref);
			const unionId = index.unionByXref.get(entry.owner_xref);

			if (/^1 SOUR(\s|$)/.test(head)) {
				const subject = personId
					? ([CITATION_SUBJECT_KINDS.PERSON, personId] as const)
					: unionId
						? ([CITATION_SUBJECT_KINDS.UNION, unionId] as const)
						: null;
				if (!subject) continue;
				const [node] = buildGedcomTree(lines, 1);
				if (!node) continue;
				store(treeId, index, subject[0], subject[1], [parseCitation(node)]);
				removedPreserved.add(entry.id);
			} else if (personId && /^1 FAMC\s+\S+/.test(head)) {
				const [famc] = buildGedcomTree(lines, 1);
				const familyUnion = famc?.value ? index.unionByXref.get(famc.value.trim()) : undefined;
				const sour = famc?.children.filter((c) => c.tag === 'SOUR') ?? [];
				if (!famc || !familyUnion || sour.length === 0) continue;
				const firstParent = (index.partners.get(familyUnion) ?? []).find((parentId) =>
					index.linkOf.has(`${familyUnion}|${personId}|${parentId}`)
				);
				const linkId = firstParent
					? index.linkOf.get(`${familyUnion}|${personId}|${firstParent}`)
					: undefined;
				if (!linkId) continue;
				store(treeId, index, CITATION_SUBJECT_KINDS.PARENT_CHILD, linkId, sour.map(parseCitation));
				const rest = famc.children.filter((c) => c.tag !== 'SOUR').flatMap(collectLines);
				if (rest.length === 0) {
					removedPreserved.add(entry.id);
				} else {
					statements.push(
						`UPDATE gedcom_preserved SET lines = ${quote(JSON.stringify([famc.rawLine, ...rest]))} WHERE id = ${quote(entry.id)};`
					);
				}
			}
		}
	}
	// The retained entries are deleted after everything that reads them has been planned.
	for (const id of removedPreserved)
		statements.push(`DELETE FROM gedcom_preserved WHERE id = ${quote(id)};`);

	/** Citations kept among a fact's or name's extra lines, moved out; the rest of the lines stay. */
	const moveFromExtra = (
		table: 'events' | 'person_names',
		kind: CitationSubjectKind,
		row: { id: string; tree_id: string; gedcom_extra: string }
	) => {
		const index = trees.get(row.tree_id);
		const lines = jsonList(row.gedcom_extra);
		const nodes: GedcomNode[] = buildGedcomTree(lines, 2);
		const sour = nodes.filter((n) => n.tag === 'SOUR');
		if (!index || sour.length === 0) return;
		store(row.tree_id, index, kind, row.id, sour.map(parseCitation));
		const rest = nodes.filter((n) => n.tag !== 'SOUR').flatMap(collectLines);
		statements.push(
			`UPDATE ${table} SET gedcom_extra = ${rest.length > 0 ? quote(JSON.stringify(rest)) : 'NULL'} WHERE id = ${quote(row.id)};`
		);
	};
	for (const row of input.events) moveFromExtra('events', CITATION_SUBJECT_KINDS.EVENT, row);
	for (const row of input.names) moveFromExtra('person_names', CITATION_SUBJECT_KINDS.NAME, row);

	return statements;
}
