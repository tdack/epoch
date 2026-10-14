/**
 * Moves the detail structures under an event (its ADDR, TYPE, AGNC, RELI and contacts) that a tree
 * kept as retained lines, in the event's extra lines, before the model had columns for them.
 *
 * Pure, as `note-backfill.ts` is: `scripts/backfill-fact-details.mjs` reads the rows
 * `FACT_DETAIL_BACKFILL_QUERIES` names, hands them to `factDetailBackfillStatements`, and runs the SQL
 * it returns. The lines are read by `extractFactDetails`, the same function the import uses, so a
 * backfilled tree and the same file imported afresh hold the same values.
 *
 * Only what the import would have modelled moves, and a value already in a column is never replaced:
 * an edited fact keeps what the user wrote, and its old line stays where it was. `PLAC` children
 * (`MAP`, `FORM`, ...) are not handled here: an earlier import dropped them, so the lines are not in
 * the row to move. A replace-mode re-import restores them.
 *
 * Idempotent by construction: a line is removed from the extra lines in the same statement that
 * stores it, so a second run finds nothing to move and emits nothing.
 */

import { extractFactDetails, factDetailColumns } from './fact-details';
import { buildGedcomTree, collectLines, levelOfLine, type GedcomNode } from './node';
import { normalizeModelText } from './parser';
import { jsonList, quote } from './evidence-backfill';

type DetailValues = ReturnType<typeof factDetailColumns>;

/**
 * Each detail column, the SQL column it is stored in, and the tags its values come from. An ADDR
 * with its own column in use is held back as a whole, so `address` and `address_layout` never split.
 */
const DETAIL_COLUMNS: ReadonlyArray<{
	key: keyof DetailValues;
	column: string;
	tags: readonly string[];
}> = [
	{ key: 'address', column: 'address', tags: ['ADDR'] },
	{ key: 'addressLayout', column: 'address_layout', tags: ['ADDR'] },
	{ key: 'classification', column: 'classification', tags: ['TYPE'] },
	{ key: 'agency', column: 'agency', tags: ['AGNC'] },
	{ key: 'phone', column: 'phone', tags: ['PHON'] },
	{ key: 'email', column: 'email', tags: ['EMAIL'] },
	{ key: 'fax', column: 'fax', tags: ['FAX'] },
	{ key: 'web', column: 'web', tags: ['WWW'] },
	{ key: 'religion', column: 'religion', tags: ['RELI'] }
];

const MOVABLE_TAGS: ReadonlySet<string> = new Set(DETAIL_COLUMNS.flatMap((c) => c.tags));

/** The reads the backfill needs, as plain SQL so the script can run them through wrangler. */
export const FACT_DETAIL_BACKFILL_QUERIES = {
	events:
		'SELECT id, tree_id, entity_type, version, gedcom_extra, address, address_layout, classification, agency, phone, email, fax, web, latitude, longitude, place_extra, religion FROM events WHERE gedcom_extra IS NOT NULL ORDER BY rowid'
} as const;

/** What the query answers, as D1 returns it: JSON columns still text. */
export interface FactDetailBackfillInput {
	events: Array<{
		id: string;
		tree_id: string;
		entity_type: string;
		version: number;
		gedcom_extra: string;
		address: string | null;
		address_layout: string | null;
		classification: string | null;
		agency: string | null;
		phone: string | null;
		email: string | null;
		fax: string | null;
		web: string | null;
		latitude: string | null;
		longitude: string | null;
		place_extra: string | null;
		religion: string | null;
	}>;
}

/** The event's extra lines as the nodes they were, read the way the import reads them. */
function nodesOf(lines: string[]): GedcomNode[] {
	const level = levelOfLine(lines[0] ?? '');
	if (level === null) return [];
	const nodes = buildGedcomTree(lines, level);
	normalizeModelText(nodes);
	return nodes;
}

/**
 * The SQL that moves every movable detail out of the extra lines and into the empty columns, one
 * UPDATE per row that changes. Empty when nothing is left to move.
 */
export function factDetailBackfillStatements(
	input: FactDetailBackfillInput,
	now = new Date()
): string[] {
	const statements: string[] = [];
	const updatedAt = Math.floor(now.getTime() / 1000);

	for (const row of input.events) {
		const lines = jsonList(row.gedcom_extra);
		if (lines.length === 0) continue;
		const nodes = nodesOf(lines);

		// A tag whose column already holds a value stays in the extra lines, whole.
		const held = new Set(
			DETAIL_COLUMNS.filter((c) => row[c.column as keyof typeof row] != null).flatMap((c) => c.tags)
		);
		const candidates = nodes.filter((n) => MOVABLE_TAGS.has(n.tag) && !held.has(n.tag));
		const { details, consumed } = extractFactDetails(candidates);
		if (consumed.size === 0) continue;

		const values = factDetailColumns(details);
		const sets = DETAIL_COLUMNS.flatMap(({ key, column }) => {
			const value = values[key];
			if (value === null) return [];
			const text = typeof value === 'string' ? value : JSON.stringify(value);
			return [`${column} = ${quote(text)}`];
		});
		if (sets.length === 0) continue;

		const rest = nodes.filter((n) => !consumed.has(n)).flatMap(collectLines);
		statements.push(
			`UPDATE events SET ${[
				...sets,
				`gedcom_extra = ${rest.length > 0 ? quote(JSON.stringify(rest)) : 'NULL'}`,
				'version = version + 1',
				`updated_at = ${updatedAt}`
			].join(', ')} WHERE id = ${quote(row.id)};`
		);
	}
	return statements;
}
