/**
 * Layer (b) of ADR-055 for the person domain: planning facts, names, people and files over the
 * scoped snapshot equals planning over the whole tree, for every person of the fixtures and a
 * deterministic sample of a generated corpus, with evidence attached so the cascades have work.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import simpsons from '../../../../../test/data/The Simpsons.ged?raw';
import simpsonsNames from '../../../../../test/data/The Simpsons names.ged?raw';
import factDetails from '../../../../../test/data/fact-details.ged?raw';
import {
	citations,
	mediaItems,
	noteAttachments,
	notes,
	repositories,
	researchTasks,
	sourceRepositories,
	sources
} from '../../db/schema';
import {
	REPRESENTATIVE_GEDCOM_7_FIXTURE,
	REPRESENTATIVE_GEDCOM_FIXTURE
} from '../../fixtures/genealogy-fixtures';
import { ChangeStore } from '../../repositories/change-store';
import { insertCorpus } from '../../testing/corpus';
import {
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../../testing/d1';
import { importGedcomToDb } from '../../testing/gedcom';
import { expectScopedEqualsWhole, viewerScopes } from '../../testing/scope-equivalence';
import type { TreeRows } from '../change-log';
import type { RelationshipCommand } from '../relationship-commands';
import type { ScopeSeed } from '../write-scope';
import { FACT_SCOPES, MEDIA_SCOPES, NAME_SCOPES, PERSON_COMMAND_SCOPES } from './person';
import type { ScopeTable } from './types';

let t: TestDatabase;
let actor: TestActor;
beforeAll(async () => {
	t = await createTestDatabase();
	actor = await createTestUser(t.db);
});
afterAll(async () => {
	await t.dispose();
});

/** Citations, notes (shared and inline), tasks and files on people, names and facts. */
async function addEvidence(treeId: string, rows: TreeRows, every: number) {
	const tag = treeId.slice(0, 8);
	const sourceIds = [`${tag}-src-a`, `${tag}-src-b`];
	const noteIds = [`${tag}-note-a`, `${tag}-note-b`];
	await t.db.insert(sources).values(sourceIds.map((id) => ({ id, treeId, title: id, version: 1 })));
	await t.db.insert(repositories).values({ id: `${tag}-repo`, treeId, name: 'r', version: 1 });
	await t.db
		.insert(sourceRepositories)
		.values({ id: `${tag}-sr`, sourceId: sourceIds[0]!, repositoryId: `${tag}-repo` });
	await t.db.insert(notes).values(noteIds.map((id) => ({ id, treeId, text: id, version: 1 })));
	let n = 0;
	const cite = async (kind: 'person' | 'name' | 'event', id: string) => {
		const citationId = `${tag}-c${n}`;
		await t.db.insert(citations).values({
			id: citationId,
			treeId,
			subjectKind: kind,
			subjectId: id,
			sortOrder: n,
			sourceId: sourceIds[n % 2]!,
			page: `p${n}`,
			version: 1
		});
		// A note on the citation, so deleting its subject has to reach it through the citation.
		await t.db.insert(noteAttachments).values({
			id: `${tag}-ca${n}`,
			treeId,
			subjectKind: 'citation',
			subjectId: citationId,
			sortOrder: n,
			noteId: noteIds[n % 2]!,
			text: null,
			version: 1
		});
		n++;
	};
	const attach = async (kind: 'person' | 'name' | 'event', id: string) => {
		await t.db.insert(noteAttachments).values({
			id: `${tag}-a${n}`,
			treeId,
			subjectKind: kind,
			subjectId: id,
			sortOrder: n,
			noteId: n % 2 ? noteIds[0]! : null,
			text: n % 2 ? null : 'inline',
			version: 1
		});
		// A task cannot be about a name, so a name's task sits on its person instead.
		if (kind !== 'name')
			await t.db.insert(researchTasks).values({
				id: `${tag}-t${n}`,
				treeId,
				title: `task ${n}`,
				subjectKind: kind,
				subjectId: id,
				version: 1
			});
		n++;
	};
	const addFile = async (entityId: string | null) => {
		await t.db.insert(mediaItems).values({
			id: `${tag}-m${n}`,
			treeId,
			entityId,
			r2ObjectKey: `media/${treeId}/${n}.png`,
			mimeType: 'image/png',
			version: 1
		});
		n++;
	};
	for (const [index, person] of rows.individuals.entries()) {
		if (index % every !== 0) continue;
		await cite('person', person.id);
		await attach('person', person.id);
		const name = rows.personNames.find((x) => x.personId === person.id);
		if (name) {
			await cite('name', name.id);
			await attach('name', name.id);
		}
		const fact = rows.events.find((e) => e.entityType === 'INDIVIDUAL' && e.entityId === person.id);
		if (fact) {
			await cite('event', fact.id);
			await attach('event', fact.id);
		}
		if (index % 2 === 0) await addFile(person.id);
	}
	// A file on a partnership and one on nothing, for attach and detach.
	if (rows.unions[0]) await addFile(rows.unions[0].id);
	await addFile(null);
}

interface World {
	label: string;
	rows: TreeRows;
	/** Which people to generate commands for. */
	people: string[];
}

/** A deterministic subset: every `step`th item. */
const sample = <T>(list: T[], max: number) => {
	const step = Math.max(1, Math.ceil(list.length / max));
	return list.filter((_, index) => index % step === 0);
};

/**
 * Makes some people private and some created by the contributor, so the three viewers differ:
 * an owner sees all, a viewer loses the private ones, the creator keeps the ones they added.
 */
function markPrivacy(rows: TreeRows) {
	rows.individuals.forEach((person, index) => {
		if (index % 7 === 3) person.privacy = 'private';
		if (index % 5 === 1) person.createdBy = 'creator-1';
	});
}

const worlds: World[] = [];
beforeAll(async () => {
	const fixtures: Array<[string, string]> = [
		['Simpsons', simpsons],
		['Simpsons names', simpsonsNames],
		['Representative 5.5.1', REPRESENTATIVE_GEDCOM_FIXTURE],
		['Representative 7', REPRESENTATIVE_GEDCOM_7_FIXTURE],
		['Fact details', factDetails]
	];
	for (const [label, text] of fixtures) {
		const treeId = await createTestTree(t.db, actor);
		await importGedcomToDb(t.d1, treeId, text, label);
		const store = new ChangeStore(t.db);
		await addEvidence(treeId, await store.loadRows(treeId), 1);
		const rows = await store.loadRows(treeId);
		markPrivacy(rows);
		worlds.push({ label, rows, people: rows.individuals.map((p) => p.id) });
	}
	const treeId = await createTestTree(t.db, actor);
	await insertCorpus(t.db, treeId, {
		prefix: treeId.slice(0, 8),
		lineages: 3,
		generations: 6,
		shouldNameThePeople: true
	});
	const store = new ChangeStore(t.db);
	await addEvidence(treeId, await store.loadRows(treeId), 3);
	const rows = await store.loadRows(treeId);
	markPrivacy(rows);
	expect(rows.individuals.length).toBeGreaterThan(150);
	worlds.push({ label: 'Corpus', rows, people: sample(rows.individuals, 100).map((p) => p.id) });
}, 600_000);

const FACT = {
	type: 'OCCU',
	dateText: 'ABT 1900',
	place: 'York',
	value: 'Miller',
	cause: null,
	age: null,
	notes: 'a note'
};

/** Commands about this person, their facts, names and files, including ones naming missing ids. */
function commandsFor(rows: TreeRows, personId: string): RelationshipCommand[] {
	const facts = rows.events.filter((e) => e.entityType === 'INDIVIDUAL' && e.entityId === personId);
	const names = rows.personNames.filter((n) => n.personId === personId);
	const files = rows.mediaItems.filter((m) => m.entityId === personId);
	const someoneElse = rows.events.find((e) => e.entityId !== personId);
	const otherName = rows.personNames.find((n) => n.personId !== personId);
	const partnerships = rows.unionPartners.filter((p) => p.personId === personId);
	const foreignUnion = rows.unions.find((u) => !partnerships.some((p) => p.unionId === u.id));
	const anyFile = rows.mediaItems[0];
	const anyUnion = rows.unions[0];
	const fact = facts[0];
	const name = names[0];
	const out: RelationshipCommand[] = [
		{ kind: 'create_fact', personId, factId: 'new-fact', fact: FACT },
		{ kind: 'create_fact', personId, factId: 'new-fact', fact: { ...FACT, type: 'DEAT' } },
		{ kind: 'create_fact', personId, factId: 'new-fact', fact: { ...FACT, type: 'BIRT' } },
		{ kind: 'create_fact', personId: 'no-such-person', factId: 'new-fact', fact: FACT },
		{ kind: 'update_fact', factId: 'no-such-fact', fact: { place: 'X' } },
		{ kind: 'delete_fact', factId: 'no-such-fact' },
		{ kind: 'reorder_facts', personId, orderedFactIds: facts.map((f) => f.id).reverse() },
		{ kind: 'reorder_facts', personId: 'no-such-person', orderedFactIds: [] },
		{ kind: 'create_name', personId, nameId: 'new-name', name: { type: 'aka', givenName: 'Al' } },
		{
			kind: 'create_name',
			personId,
			nameId: 'new-name',
			name: { type: 'married', surname: 'Wed' },
			isPreferred: true
		},
		{ kind: 'create_name', personId: 'no-such-person', nameId: 'n', name: { type: 'aka' } },
		{ kind: 'update_name', nameId: 'no-such-name', name: { givenName: 'X' } },
		{ kind: 'delete_name', nameId: 'no-such-name' },
		{ kind: 'reorder_names', personId, orderedNameIds: names.map((n) => n.id).reverse() },
		{ kind: 'set_preferred_name', personId, nameId: 'no-such-name' },
		{
			kind: 'create_person',
			personId: 'new-person',
			givenName: ' Nia ',
			surname: 'New',
			sex: 'F',
			birthDate: '1990',
			birthPlace: 'Leeds',
			deathDate: null,
			deathPlace: null
		},
		{ kind: 'create_person', personId: 'new-person', givenName: null, surname: null, sex: 'U' },
		{ kind: 'update_person', personId, givenName: 'Changed', birthDate: '1850', deathDate: '1900' },
		{ kind: 'update_person', personId, sex: 'F', expectedVersion: 99 },
		{ kind: 'update_person', personId: 'no-such-person', givenName: 'X' },
		{ kind: 'delete_person', personId },
		{ kind: 'delete_person', personId: 'no-such-person' },
		{ kind: 'set_person_privacy', personId, privacy: 'private' },
		{ kind: 'set_person_privacy', personId, privacy: 'public' },
		{ kind: 'record_death', personId, dateText: '1 JAN 1950', place: 'Rome' },
		{ kind: 'record_death', personId, dateText: null, place: null },
		{ kind: 'rename_media', mediaId: 'no-such-file', title: 'x' },
		{ kind: 'attach_media', mediaId: 'no-such-file', entityId: personId },
		{ kind: 'detach_media', mediaId: 'no-such-file' }
	];
	for (const f of facts.slice(0, 4)) {
		out.push(
			{ kind: 'update_fact', factId: f.id, fact: { place: 'Elsewhere', notes: 'changed' } },
			{ kind: 'update_fact', factId: f.id, fact: { type: 'DEAT', value: 'v' } },
			{ kind: 'update_fact', factId: f.id, expectedVersion: 99, fact: { place: 'Z' } },
			{ kind: 'delete_fact', factId: f.id }
		);
	}
	if (fact && someoneElse)
		out.push({ kind: 'reorder_facts', personId, orderedFactIds: [fact.id, someoneElse.id] });
	if (fact) out.push({ kind: 'reorder_facts', personId, orderedFactIds: [fact.id, fact.id] });
	for (const n of names.slice(0, 4)) {
		out.push(
			{ kind: 'update_name', nameId: n.id, name: { givenName: 'Renamed', type: 'aka' } },
			{ kind: 'update_name', nameId: n.id, name: { givenName: null, surname: null } },
			{ kind: 'delete_name', nameId: n.id },
			{ kind: 'set_preferred_name', personId, nameId: n.id },
			{ kind: 'update_name', nameId: n.id, expectedVersion: 99, name: { surname: 'Z' } }
		);
		for (const p of partnerships.slice(0, 1))
			out.push({
				kind: 'update_name',
				nameId: n.id,
				name: { type: 'married', unionId: p.unionId }
			});
		if (foreignUnion)
			out.push({
				kind: 'update_name',
				nameId: n.id,
				name: { type: 'married', unionId: foreignUnion.id }
			});
	}
	for (const p of partnerships.slice(0, 2))
		out.push({
			kind: 'create_name',
			personId,
			nameId: 'new-name',
			name: { type: 'married', surname: 'Wed', unionId: p.unionId }
		});
	if (name && otherName) {
		out.push(
			{ kind: 'create_name', personId, nameId: name.id, name: { type: 'aka', givenName: 'Dup' } },
			{ kind: 'set_preferred_name', personId, nameId: otherName.id },
			{ kind: 'reorder_names', personId, orderedNameIds: [otherName.id, ...names.map((n) => n.id)] }
		);
	}
	for (const m of files.slice(0, 2)) {
		out.push(
			{ kind: 'rename_media', mediaId: m.id, title: 'Renamed' },
			{ kind: 'rename_media', mediaId: m.id, title: '   ' },
			{ kind: 'detach_media', mediaId: m.id },
			{ kind: 'attach_media', mediaId: m.id, entityId: personId },
			{ kind: 'attach_media', mediaId: m.id, entityId: 'no-such-record' },
			{ kind: 'detach_media', mediaId: m.id, expectedVersion: 99 }
		);
		if (anyUnion) out.push({ kind: 'attach_media', mediaId: m.id, entityId: anyUnion.id });
	}
	if (anyFile) {
		out.push(
			{ kind: 'attach_media', mediaId: anyFile.id, entityId: personId },
			{ kind: 'rename_media', mediaId: anyFile.id, title: 'Moved' }
		);
	}
	return out;
}

const scopes = viewerScopes();
const GROUPS: Array<[string, ScopeTable]> = [
	['facts', FACT_SCOPES],
	['names', NAME_SCOPES],
	['people', PERSON_COMMAND_SCOPES],
	['media', MEDIA_SCOPES]
];

describe('person-domain scoped planning equals whole-tree planning', () => {
	for (const [group, table] of GROUPS) {
		it(
			group,
			() => {
				let plannedCount = 0;
				let failedCount = 0;
				for (const world of worlds) {
					for (const personId of world.people) {
						for (const command of commandsFor(world.rows, personId)) {
							const seedFunction = table[command.kind] as
								((c: RelationshipCommand) => ScopeSeed) | undefined;
							if (!seedFunction) continue;
							for (const [viewer, scope] of Object.entries(scopes)) {
								const outcome = expectScopedEqualsWhole({
									whole: world.rows,
									commands: [command],
									scope,
									seed: seedFunction(command),
									label: `${world.label} ${personId} ${viewer} ${JSON.stringify(command)}`
								});
								if (outcome.failure) failedCount++;
								else plannedCount++;
							}
						}
					}
				}
				// A green run must include real plans, not only refusals.
				expect(plannedCount).toBeGreaterThan(100);
				expect(plannedCount).toBeGreaterThan(failedCount / 8);
			},
			600_000
		);
	}

	it('covers cascades: deleting a fact reaches its citations, notes and tasks', () => {
		const world = worlds.find((w) => w.label === 'Representative 5.5.1')!;
		const fact = world.rows.events.find(
			(e) => e.entityType === 'INDIVIDUAL' && world.rows.citations.some((c) => c.subjectId === e.id)
		)!;
		const command: RelationshipCommand = { kind: 'delete_fact', factId: fact.id };
		const outcome = expectScopedEqualsWhole({
			whole: world.rows,
			commands: [command],
			scope: scopes.unrestricted,
			seed: FACT_SCOPES.delete_fact!(command as never)
		});
		const touched = new Set(outcome.ops?.map((op) => op.table));
		expect(touched).toContain('citations');
		expect(touched).toContain('note_attachments');
		expect(touched).toContain('research_tasks');
	});
});
