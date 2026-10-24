/**
 * ADR-055: a partnership with no partners, and its fact, its link and its file, reached by any kind.
 *
 * The whole tree's privacy mask drops such a partnership (with its facts, its file, and its place in
 * a link) as soon as anyone in the tree is private; a scoped snapshot that holds nobody private
 * keeps it. So a scoped write can answer differently from the whole tree unless the snapshot falls
 * back to the whole tree whenever it holds one, for every seed, opted in or not. The tree has a
 * private person who is unrelated to the partnership, which is what makes the snapshot differ.
 */

import { describe, expect, it } from 'vitest';
import type { DbClient } from '../../db';
import type { ViewerScope } from '../../services/tree-access';
import { MutationRunner } from '../../services/mutation-runner';
import {
	mkAttachment,
	mkCitation,
	mkLink,
	mkNote,
	mkRepository,
	mkSource,
	mkTask
} from '../../testing/evidence-rows';
import { TEST_TREE_ID, sequentialIds, treeRows } from '../../testing/rows';
import {
	expectScopedEqualsWhole,
	selectScopeWithFollowUp,
	viewerScopes
} from '../../testing/scope-equivalence';
import type { TreeRows } from '../change-log';
import { pastTense } from '../command-summary';
import { describeImpact } from '../impact';
import {
	planRelationshipCommand,
	type RelationshipCommand,
	type RelationshipPlan
} from '../relationship-commands';
import type { PersonRef, RelationshipIntent } from '../relationship-sentence';
import { seedFor } from './index';
import { intentSeed } from './intent';
import { EVIDENCE_SCOPES } from './evidence';
import { PERSON_SCOPES } from './person';
import { UNION_SCOPES } from './union';

const CREATOR = 'creator-1';
const scopes = viewerScopes(CREATOR);
const UNION = 'u-lonely';

/** The partnership has no partners; `hidden` is living and made by no one, so private elsewhere. */
function world(): TreeRows {
	const rows = treeRows({
		people: [
			...['dead1', 'dead2', 'dead3', 'dead4', 'dead5', 'dead6'].map((id) => ({
				id,
				birth: '1902',
				death: '1970'
			})),
			{ id: 'hidden', birth: '2000' },
			{ id: 'living', birth: '2001' }
		],
		unions: [
			{ id: 'u1', partners: ['dead1', 'dead2'] },
			{ id: UNION, partners: [], marriage: '1920' }
		],
		links: [
			{ parentId: 'dead5', childId: 'dead6', unionId: UNION },
			{ parentId: 'dead1', childId: 'hidden', unionId: 'u1' }
		],
		names: [
			{ id: 'name-dead5', personId: 'dead5' },
			{ id: 'name-dead6', personId: 'dead6' }
		],
		media: [
			{ id: 'file-lonely', linkedTo: [UNION] },
			{ id: 'file-dead5', linkedTo: ['dead5'] }
		]
	});
	rows.individuals.find((p) => p.id === 'living')!.createdBy = CREATOR;
	const fact = rows.events.find((e) => e.entityId === UNION)!;
	const link = rows.parentChild.find((l) => l.unionId === UNION)!;
	return {
		...rows,
		sources: [mkSource('s1'), mkSource('s2')],
		repositories: [mkRepository('r1')],
		sourceRepositories: [mkLink('l1', 's1', 'r1')],
		citations: [
			mkCitation('c-union', 'union', UNION, 's1'),
			mkCitation('c-fact', 'event', fact.id, 's1'),
			mkCitation('c-link', 'parent_child', link.id, 's2'),
			mkCitation('c-dead1', 'person', 'dead1', 's1')
		],
		notes: [mkNote('n1'), mkNote('n2')],
		noteAttachments: [
			mkAttachment('a-union', 'union', UNION, 'n1'),
			mkAttachment('a-fact', 'event', fact.id, null),
			mkAttachment('a-link', 'parent_child', link.id, 'n2'),
			mkAttachment('a-source', 'source', 's1', 'n2')
		],
		researchTasks: [
			mkTask('t-union', 'union', UNION),
			mkTask('t-fact', 'event', fact.id),
			mkTask('t-source', 'source', 's1')
		]
	};
}

/** Every kind the three tables seed, aimed at the partnership or its records where one fits. */
function commandsFor(rows: TreeRows): RelationshipCommand[] {
	const fact = rows.events.find((e) => e.entityId === UNION)!;
	const link = rows.parentChild.find((l) => l.unionId === UNION)!;
	const subjects = [
		{ kind: 'union', id: UNION },
		{ kind: 'event', id: fact.id },
		{ kind: 'parent_child', id: link.id }
	] as const;
	const commands: RelationshipCommand[] = [
		// Facts
		{
			kind: 'create_fact',
			personId: 'dead5',
			factId: 'new-fact',
			fact: {
				type: 'OCCU',
				dateText: null,
				place: null,
				value: 'Baker',
				cause: null,
				age: null,
				notes: null
			}
		},
		{ kind: 'update_fact', factId: fact.id, fact: { place: 'York' } },
		{ kind: 'delete_fact', factId: fact.id },
		{ kind: 'reorder_facts', personId: 'dead5', orderedFactIds: [fact.id] },
		// Names
		{
			kind: 'create_name',
			personId: 'dead5',
			nameId: 'new-name',
			name: { type: 'married', givenName: 'Ada', unionId: UNION }
		},
		{ kind: 'update_name', nameId: 'name-dead5', name: { unionId: UNION } },
		{ kind: 'delete_name', nameId: 'name-dead5' },
		{ kind: 'reorder_names', personId: 'dead5', orderedNameIds: ['name-dead5'] },
		{ kind: 'set_preferred_name', personId: 'dead5', nameId: 'name-dead5' },
		// People
		{
			kind: 'create_person',
			personId: 'new-person',
			givenName: 'New',
			surname: 'Person',
			sex: 'U'
		},
		{ kind: 'update_person', personId: 'dead5', givenName: 'Edited' },
		{ kind: 'delete_person', personId: 'dead5' },
		{ kind: 'delete_person', personId: 'dead6' },
		{ kind: 'set_person_privacy', personId: 'dead5', privacy: 'private' },
		{ kind: 'record_death', personId: 'dead5', dateText: '1980', place: null },
		// Files
		{ kind: 'rename_media', mediaId: 'file-lonely', title: 'Renamed' },
		{ kind: 'unlink_media', mediaId: 'file-lonely', entityId: UNION },
		{ kind: 'link_media', mediaId: 'file-lonely', entityId: UNION },
		{ kind: 'link_media', mediaId: 'file-dead5', entityId: UNION },
		{ kind: 'link_media', mediaId: 'file-lonely', entityId: 'dead5' },
		// Partnerships and links
		{ kind: 'update_union', unionId: UNION, expectedVersion: 1, status: 'separated' },
		{ kind: 'end_union', unionId: UNION, status: 'ended', event: null },
		{ kind: 'destroy_union', unionId: UNION },
		{ kind: 'create_union', unionId: 'new-union', personIds: ['dead5', 'dead6'] },
		{ kind: 'add_partner_to_union', unionId: UNION, personId: 'dead3' },
		{ kind: 'add_partner_to_union', unionId: UNION, personId: 'hidden' },
		{ kind: 'remove_partner_from_union', unionId: UNION, personId: 'dead5' },
		{
			kind: 'assert_parent_child',
			parentId: 'dead5',
			childId: 'dead6',
			type: 'biological',
			unionId: UNION
		},
		{
			kind: 'assert_parent_child',
			parentId: 'dead3',
			childId: 'dead4',
			type: 'biological',
			unionId: UNION
		},
		{ kind: 'remove_parent_child', parentId: 'dead5', childId: 'dead6', type: 'biological' },
		{
			kind: 'change_parent_child_type',
			parentId: 'dead5',
			childId: 'dead6',
			fromType: 'biological',
			toType: 'adoptive'
		},
		// Evidence
		{ kind: 'create_source', sourceId: 'new-source', source: { title: 'S' } },
		{ kind: 'update_source', sourceId: 's1', source: { title: 'Renamed' } },
		{ kind: 'delete_source', sourceId: 's1' },
		{ kind: 'delete_source', sourceId: 's1', shouldRemoveCitations: true },
		{ kind: 'create_repository', repositoryId: 'new-repo', repository: { name: 'R' } },
		{ kind: 'update_repository', repositoryId: 'r1', repository: { name: 'Renamed' } },
		{ kind: 'delete_repository', repositoryId: 'r1' },
		{ kind: 'link_repository', linkId: 'new-link', sourceId: 's2', repositoryId: 'r1' },
		{ kind: 'update_source_repository', linkId: 'l1', callNumber: 'MS 1' },
		{ kind: 'unlink_repository', linkId: 'l1' },
		{ kind: 'update_citation', citationId: 'c-union', citation: { page: 'p. 2' } },
		{ kind: 'update_citation', citationId: 'c-union', citation: { sourceId: 's2' } },
		{ kind: 'remove_citation', citationId: 'c-union' },
		{ kind: 'remove_citation', citationId: 'c-fact' },
		{ kind: 'remove_citation', citationId: 'c-link' },
		{ kind: 'create_note', noteId: 'new-note', note: { text: 'N' } },
		{ kind: 'update_note', attachmentId: 'a-fact', text: 'Edited' },
		{ kind: 'remove_note', attachmentId: 'a-union' },
		{ kind: 'remove_note', attachmentId: 'a-link' },
		{ kind: 'share_note', attachmentId: 'a-fact', noteId: 'new-shared' },
		{ kind: 'update_shared_note', noteId: 'n1', note: { text: 'Edited' } },
		{ kind: 'delete_shared_note', noteId: 'n1', shouldDetach: true },
		{ kind: 'update_task', taskId: 't-union', task: { status: 'done' } },
		{ kind: 'update_task', taskId: 't-fact', task: { status: 'done' } },
		{ kind: 'delete_task', taskId: 't-union' },
		{ kind: 'delete_task', taskId: 't-fact' }
	];
	for (const [n, subject] of subjects.entries()) {
		commands.push(
			{ kind: 'add_citation', citationId: `new-c-${n}`, subject, citation: { sourceId: 's1' } },
			{ kind: 'reorder_citations', subject, orderedCitationIds: [] },
			{ kind: 'add_note', attachmentId: `new-a-${n}`, subject, text: 'On a lonely record' },
			{ kind: 'attach_note', attachmentId: `new-b-${n}`, subject, noteId: 'n2' },
			{ kind: 'reorder_notes', subject, orderedAttachmentIds: [] }
		);
		if (subject.kind !== 'parent_child')
			commands.push({
				kind: 'create_task',
				taskId: `new-t-${n}`,
				task: { title: 'T' },
				subject
			});
	}
	return commands;
}

const TABLE_KINDS = [
	...Object.keys(PERSON_SCOPES),
	...Object.keys(UNION_SCOPES),
	...Object.keys(EVIDENCE_SCOPES)
];

describe('a partnership with no partners, reached by any scoped kind', () => {
	it('plans the same over a scoped snapshot as over the whole tree', () => {
		const rows = world();
		const commands = commandsFor(rows);
		const covered = new Set<string>();
		const differences: string[] = [];
		let compared = 0;
		let succeeded = 0;
		for (const command of commands) {
			const seed = seedFor([command]);
			if (!seed) continue;
			covered.add(command.kind);
			for (const [who, scope] of Object.entries(scopes)) {
				try {
					const outcome = expectScopedEqualsWhole({
						whole: rows,
						commands: [command],
						scope,
						seed,
						label: `${who} ${JSON.stringify(command)}`
					});
					compared++;
					if (!outcome.failure) succeeded++;
				} catch {
					differences.push(`${who} ${JSON.stringify(command)}`);
				}
			}
		}
		expect(differences, `${differences.length} differences`).toEqual([]);
		expect([...covered].sort()).toEqual([...new Set(TABLE_KINDS)].sort());
		// Not every case refused the same way on both sides.
		expect(succeeded).toBeGreaterThan(compared / 4);
	});
});

// ---- Relationship intents ----

const FIXED_NOW_MS = 1_700_000_000_000;

function outcomeOf(rows: TreeRows, intent: RelationshipIntent, scope: ViewerScope) {
	const runner = new MutationRunner({} as DbClient, {
		now: () => FIXED_NOW_MS,
		newId: sequentialIds('new')
	});
	let stage = 'plan';
	let plan: RelationshipPlan | undefined;
	try {
		const visible = runner.visibleRows(rows, scope);
		plan = planRelationshipCommand(intent, {
			rows: visible,
			hasDuplicateName: false,
			newId: runner.clock.newId
		});
		stage = 'ops';
		const ops = runner.planFor(TEST_TREE_ID, rows, plan.commands, scope);
		return {
			plan,
			ops,
			summary: pastTense(plan.sentence),
			impact: describeImpact(plan.sentence, visible, ops)
		};
	} catch (error) {
		return {
			plan,
			failure: {
				stage,
				name: error instanceof Error ? error.constructor.name : typeof error,
				message: error instanceof Error ? error.message : String(error)
			}
		};
	}
}

const ref = (id: string): PersonRef => ({ id, givenName: id, surname: 'Test' });
const NEW: PersonRef = { id: 'placeholder', givenName: 'Nova', surname: 'Newcomer', isNew: true };

const INTENTS: RelationshipIntent[] = [
	...[ref('dead5'), ref('dead6'), NEW].flatMap((other) => [
		{
			kind: 'add_child' as const,
			parent: ref('dead5'),
			child: other,
			type: 'biological' as const,
			unionLabel: null,
			unionId: UNION
		},
		{
			kind: 'add_parent' as const,
			child: ref('dead6'),
			parent: other,
			type: 'biological' as const,
			role: 'parent' as const,
			unionLabel: null,
			unionId: UNION
		},
		{
			kind: 'add_partner' as const,
			person: ref('dead3'),
			partner: other,
			unionLabel: null,
			unionId: UNION
		}
	]),
	{
		kind: 'add_partner',
		person: ref('dead5'),
		partner: ref('dead3'),
		unionLabel: null,
		unionId: UNION
	},
	{
		kind: 'add_partner',
		person: ref('dead5'),
		partner: ref('hidden'),
		unionLabel: null,
		unionId: UNION
	},
	{
		kind: 'add_sibling',
		person: ref('dead6'),
		sibling: NEW,
		parentIds: ['dead5'],
		type: 'biological'
	},
	{
		kind: 'change_link_type',
		parent: ref('dead5'),
		child: ref('dead6'),
		fromType: 'biological',
		toType: 'adoptive'
	},
	{ kind: 'record_death', person: ref('dead5'), dateText: '1980', place: null },
	{ kind: 'end_union', person: ref('dead5'), unionId: UNION, status: 'ended', event: null }
];

describe('the relationship intents that name a partnership with no partners', () => {
	it('plan the same over a scoped snapshot as over the whole tree', () => {
		const rows = world();
		let compared = 0;
		for (const intent of INTENTS) {
			const seed = intentSeed(intent);
			if (!seed) continue;
			for (const [who, scope] of Object.entries(scopes)) {
				const whole = outcomeOf(rows, intent, scope);
				const scoped = outcomeOf(selectScopeWithFollowUp(rows, seed), intent, scope);
				expect(scoped, `${who} ${JSON.stringify(intent)}`).toEqual(whole);
				compared++;
			}
		}
		expect(compared).toBeGreaterThan(30);
	});
});
