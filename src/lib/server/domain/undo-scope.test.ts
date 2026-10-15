/**
 * Proof that an undo may read a scoped snapshot (ADR-055): for undoable changes of every kind of
 * record, the labels of what the undo writes and the rows that stop it (`HAS_DEPENDENTS`) are the
 * same over the rows `loadRowsForUndo` selects as over the whole tree.
 *
 * Each case is a change planned over a fixture, then optionally a later change that attaches
 * something to what the first created (so undoing the first has dependents), then the inverse of
 * the first change planned against the tree as it stands: what `undoLast` sees.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbClient } from '../db';
import { MutationRunner } from '../services/mutation-runner';
import { sequentialIds, TEST_TREE_ID } from '../testing/rows';
import { createWorlds, type World } from '../testing/scope-worlds';
import type { TestDatabase } from '../testing/d1';
import {
	dependentsOfDeletions,
	describeOps,
	invertOps,
	type RowOp,
	type TreeRows
} from './change-log';
import type { RelationshipCommand } from './relationship-commands';
import { makeLabeler } from './tree-labels';
import { applyOpsToRows } from './tree-ops';
import { loadRowsForUndo, undoSeed } from './undo-scope';
import { selectScope } from './write-scope';
import { viewerScopes } from '../testing/scope-equivalence';

let t: TestDatabase;
let worlds: World[] = [];
beforeAll(async () => {
	({ t, worlds } = await createWorlds());
}, 120_000);
afterAll(async () => {
	await t.dispose();
});

const scope = viewerScopes().unrestricted;
const FACT = { dateText: '1900', place: 'York', value: null, cause: null, age: null, notes: null };

function planner() {
	return new MutationRunner({} as DbClient, {
		now: () => 1_700_000_000_000,
		newId: sequentialIds('new')
	});
}

function plan(rows: TreeRows, commands: RelationshipCommand[]): RowOp[] | null {
	try {
		return planner().planFor(TEST_TREE_ID, rows, commands, scope);
	} catch {
		return null;
	}
}

interface Case {
	label: string;
	change: RelationshipCommand[];
	/** A later change to what the first made, built from the first's ops. */
	later?: (ops: RowOp[]) => RelationshipCommand[];
}

const every = <T>(items: T[], limit: number): T[] =>
	items.filter((_, index) => index % Math.max(1, Math.ceil(items.length / limit)) === 0);

const createdId = (ops: RowOp[], table: RowOp['table']) =>
	ops.find((op) => op.table === table && op.before === null)?.id ?? 'none';

function casesFor(rows: TreeRows): Case[] {
	const cases: Case[] = [];
	const people = every(rows.individuals, 8);
	const source = rows.sources[0]?.id;
	const note = rows.notes[0]?.id;
	const repository = rows.repositories[0]?.id;
	const other = (index: number) => rows.individuals[(index * 5 + 2) % rows.individuals.length]!.id;

	for (const [index, person] of people.entries()) {
		const p = person.id;
		cases.push(
			{
				label: `create person ${p}`,
				change: [
					{ kind: 'create_person', personId: 'np', givenName: 'Nu', surname: 'Pe', sex: 'U' }
				],
				later: () => [
					{
						kind: 'create_fact',
						personId: 'np',
						factId: 'np-fact',
						fact: { ...FACT, type: 'BIRT' }
					}
				]
			},
			{
				label: `delete person ${p}`,
				change: [{ kind: 'delete_person', personId: p }]
			},
			{
				label: `update person ${p}`,
				change: [{ kind: 'update_person', personId: p, givenName: 'Changed' }]
			},
			{
				label: `create fact on ${p}`,
				change: [
					{ kind: 'create_fact', personId: p, factId: 'nf', fact: { ...FACT, type: 'RESI' } }
				],
				later: () =>
					source
						? [
								{
									kind: 'add_citation',
									citationId: 'nf-cite',
									subject: { kind: 'event', id: 'nf' },
									citation: { sourceId: source }
								}
							]
						: []
			},
			{
				label: `name on ${p}`,
				change: [
					{
						kind: 'create_name',
						personId: p,
						nameId: 'nn',
						name: { type: 'aka', givenName: 'Al', surname: 'Ias' }
					}
				],
				later: () => [
					{
						kind: 'add_note',
						attachmentId: 'nn-note',
						subject: { kind: 'name', id: 'nn' },
						text: 'x'
					}
				]
			},
			{
				label: `partnership of ${p}`,
				change: [{ kind: 'create_union', unionId: 'nu', personIds: [p, other(index)] }],
				later: (ops) => [
					{
						kind: 'assert_parent_child',
						parentId: p,
						childId: other(index + 1),
						type: 'adoptive',
						unionId: createdId(ops, 'unions')
					}
				]
			},
			{
				label: `link under ${p}`,
				change: [
					{
						kind: 'assert_parent_child',
						parentId: p,
						childId: other(index + 3),
						type: 'foster',
						unionId: null
					}
				],
				later: (ops) =>
					source
						? [
								{
									kind: 'add_citation',
									citationId: 'link-cite',
									subject: { kind: 'parent_child', id: createdId(ops, 'parent_child') },
									citation: { sourceId: source }
								}
							]
						: []
			},
			{
				label: `inline note on ${p}`,
				change: [
					{
						kind: 'add_note',
						attachmentId: 'na',
						subject: { kind: 'person', id: p },
						text: 'a note'
					}
				]
			}
		);
		if (source)
			cases.push({
				label: `citation of ${p}`,
				change: [
					{
						kind: 'add_citation',
						citationId: 'nc',
						subject: { kind: 'person', id: p },
						citation: { sourceId: source, page: '3' }
					}
				],
				later: () => [
					{
						kind: 'add_note',
						attachmentId: 'nc-note',
						subject: { kind: 'citation', id: 'nc' },
						text: 'n'
					}
				]
			});
	}
	for (const event of every(rows.events, 10)) {
		cases.push(
			{
				label: `delete fact ${event.id}`,
				change: [{ kind: 'delete_fact', factId: event.id }]
			},
			{
				label: `update fact ${event.id}`,
				change: [{ kind: 'update_fact', factId: event.id, fact: { place: 'Leeds' } }]
			}
		);
	}
	for (const name of every(rows.personNames, 6)) {
		cases.push({
			label: `delete name ${name.id}`,
			change: [{ kind: 'delete_name', nameId: name.id }]
		});
	}
	for (const union of every(rows.unions, 10)) {
		const members = rows.unionPartners.filter((p) => p.unionId === union.id);
		cases.push(
			{ label: `destroy ${union.id}`, change: [{ kind: 'destroy_union', unionId: union.id }] },
			{
				label: `end ${union.id}`,
				change: [
					{
						kind: 'end_union',
						unionId: union.id,
						status: 'divorced',
						event: { type: 'DIV', dateText: '1999', place: null }
					}
				]
			},
			{
				label: `edit ${union.id}`,
				change: [
					{
						kind: 'update_union',
						unionId: union.id,
						expectedVersion: union.version,
						status: 'separated',
						events: []
					}
				]
			}
		);
		if (members[0])
			cases.push({
				label: `remove partner of ${union.id}`,
				change: [
					{ kind: 'remove_partner_from_union', unionId: union.id, personId: members[0].personId }
				]
			});
		cases.push({
			label: `add partner to ${union.id}`,
			change: [
				{
					kind: 'add_partner_to_union',
					unionId: union.id,
					personId: other(union.id.length)
				}
			]
		});
	}
	for (const link of every(rows.parentChild, 10)) {
		cases.push(
			{
				label: `remove link ${link.id}`,
				change: [
					{
						kind: 'remove_parent_child',
						parentId: link.parentId,
						childId: link.childId,
						type: link.type as 'biological'
					}
				]
			},
			{
				label: `retype link ${link.id}`,
				change: [
					{
						kind: 'change_parent_child_type',
						parentId: link.parentId,
						childId: link.childId,
						fromType: link.type as 'biological',
						toType: link.type === 'unknown' ? 'foster' : 'unknown'
					}
				]
			}
		);
	}
	for (const citation of every(rows.citations, 8)) {
		cases.push({
			label: `remove citation ${citation.id}`,
			change: [{ kind: 'remove_citation', citationId: citation.id }]
		});
	}
	for (const attachment of every(rows.noteAttachments, 8)) {
		cases.push({
			label: `remove note ${attachment.id}`,
			change: [{ kind: 'remove_note', attachmentId: attachment.id }]
		});
	}
	cases.push(
		{
			label: 'create source',
			change: [{ kind: 'create_source', sourceId: 'ns', source: { title: 'Fresh' } }],
			later: () => [
				{
					kind: 'add_citation',
					citationId: 'ns-cite',
					subject: { kind: 'person', id: rows.individuals[0]!.id },
					citation: { sourceId: 'ns' }
				}
			]
		},
		{
			label: 'create repository',
			change: [{ kind: 'create_repository', repositoryId: 'nr', repository: { name: 'Fresh' } }],
			later: () =>
				source
					? [{ kind: 'link_repository', linkId: 'nr-link', sourceId: source, repositoryId: 'nr' }]
					: []
		},
		{
			label: 'create shared note',
			change: [{ kind: 'create_note', noteId: 'nn', note: { text: 'shared' } }],
			later: () => [
				{
					kind: 'attach_note',
					attachmentId: 'nn-att',
					subject: { kind: 'person', id: rows.individuals[0]!.id },
					noteId: 'nn'
				}
			]
		}
	);
	if (source)
		cases.push({
			label: 'delete cited source',
			change: [{ kind: 'delete_source', sourceId: source, shouldRemoveCitations: true }]
		});
	if (repository)
		cases.push({
			label: 'delete repository',
			change: [{ kind: 'delete_repository', repositoryId: repository }]
		});
	if (note)
		cases.push({
			label: 'delete shared note',
			change: [{ kind: 'delete_shared_note', noteId: note, shouldDetach: true }]
		});
	return cases;
}

/** What an undo shows: the labels it writes, and the rows that would refuse it with their names. */
function outcomeOf(rows: TreeRows, ops: RowOp[]) {
	const labeler = makeLabeler(rows, ops);
	return {
		labels: describeOps(ops, labeler),
		dependents: dependentsOfDeletions(rows, ops).map((d) => ({
			table: d.table,
			id: String(d.row.id),
			label: labeler(d.table, d.row)
		}))
	};
}

describe('an undo over a scoped snapshot', () => {
	it('labels and refuses exactly as over the whole tree', async () => {
		let compared = 0;
		let refused = 0;
		let skipped = 0;
		const tables = new Set<string>();
		for (const world of worlds) {
			for (const c of casesFor(world.rows)) {
				const forward = plan(world.rows, c.change);
				if (!forward || forward.length === 0) {
					skipped++;
					continue;
				}
				let now = applyOpsToRows(world.rows, forward);
				if (c.later) {
					const laterOps = plan(now, c.later(forward));
					if (laterOps) now = applyOpsToRows(now, laterOps);
				}
				const inverse = invertOps(forward);
				const expected = outcomeOf(now, inverse);
				const scoped = await loadRowsForUndo(inverse, async (seed) => selectScope(now, seed));
				expect(outcomeOf(scoped, inverse), `${world.label}: ${c.label}`).toEqual(expected);
				compared++;
				if (expected.dependents.length > 0) {
					refused++;
					for (const d of expected.dependents) tables.add(d.table);
				}
				for (const op of inverse) tables.add(`op:${op.table}`);
			}
		}
		expect(compared).toBeGreaterThan(300);
		expect(refused).toBeGreaterThan(10);
		expect(skipped).toBeLessThan(compared);
		// Not vacuous: dependents of several kinds, and ops on most tables.
		expect([...tables].filter((name) => !name.startsWith('op:')).length).toBeGreaterThan(3);
		expect([...tables].filter((name) => name.startsWith('op:')).length).toBeGreaterThan(9);
	}, 600_000);

	it('seeds every record the ops name, from both images', () => {
		const rows = worlds[0]!.rows;
		const person = rows.individuals[0]!;
		const forward = plan(rows, [{ kind: 'delete_person', personId: person.id }])!;
		const seed = undoSeed(invertOps(forward));
		expect(seed.people.has(person.id)).toBe(true);
	});
});
