/**
 * The privacy-leak checks of the data-quality report (ADR-029): what each rule fires on, what it
 * leaves alone, and that only a manager or owner is told, because a finding names the private
 * person it is about.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TreeRole } from '../../shared/roles';
import { importGedcomToDb } from '../testing/gedcom';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { ChangeStore } from '../repositories/change-store';
import { checkPrivacyLeaks } from '../domain/quality-privacy';
import { EVERYONE_SHOWN_CUTOFF, livingCutoff } from '../domain/living-state';
import { QualityService } from './quality-service';
import { TaskService } from './task-service';

const FIXTURE = `0 HEAD
0 @N1@ NOTE About Livia Aliveson's family and the Oldman family
0 @N2@ NOTE Livia Aliveson kept this diary
0 @N3@ NOTE Only the first name Livia appears here
0 @S1@ SOUR
1 TITL Letters of Livia Aliveson
0 @S2@ SOUR
1 TITL Birth certificate of Livia Aliveson
0 @S3@ SOUR
1 TITL Census 1851
0 @I1@ INDI
1 NAME Grandar /Oldman/
1 NOTE His granddaughter Livia Aliveson was born in 1985
1 NOTE Livia is mentioned by first name only
1 NOTE @N1@
1 NOTE @N3@
1 BIRT
2 DATE 1850
2 SOUR @S1@
3 PAGE 1
2 SOUR @S3@
3 PAGE 4
0 @I2@ INDI
1 NAME Livia /Aliveson/
1 NOTE Livia Aliveson writes about herself
1 NOTE @N1@
1 NOTE @N2@
1 BIRT
2 DATE 1985
2 SOUR @S2@
3 PAGE 7
0 @I3@ INDI
1 NAME Max /Public/
1 _EPOCH_PRIVACY public
0 @I4@ INDI
1 NAME Old /Pat/
1 _EPOCH_PRIVACY public
1 DEAT
2 DATE 1900
0 @I5@ INDI
1 NAME Young /Pat/
1 _EPOCH_PRIVACY public
1 BIRT
2 DATE 1700
0 TRLR`;

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const NOW = new Date('2026-10-01T12:00:00Z');
const service = () => new QualityService(t.db, () => NOW.getTime());

const rulesFor = async (who: TreeRole) =>
	(await service().report(treeId, actors[who].context)).findings.map((f) => f.rule);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Leaks');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

const LEAK_RULES = [
	'public_override_likely_living',
	'note_names_private_person',
	'source_names_private_person'
];

describe('what the privacy-leak rules fire on', () => {
	it('an always-public person with no death and no birth long ago, and nobody else', async () => {
		const report = await service().report(treeId, actors.manager.context);
		const found = report.findings.filter((f) => f.rule === 'public_override_likely_living');
		// Max has no dates at all; Old Pat has a death; Young Pat was born in 1700, long before the cut-off.
		expect(found.map((f) => f.subjects[0].name)).toEqual(['Max Public']);
		expect(found[0].severity).toBe('warning');
		expect(found[0].message).toContain('may still be living');
	});

	it('a note viewers can read that carries a private person’s full name, on someone else’s record', async () => {
		const report = await service().report(treeId, actors.manager.context);
		const messages = report.findings
			.filter((f) => f.rule === 'note_names_private_person')
			.map((f) => f.message)
			.sort();
		expect(messages).toEqual([
			'A note on a record viewers can see names Livia Aliveson, who is private.',
			'A shared note viewers can see names Livia Aliveson, who is private.'
		]);
		// Not her own notes (hidden), not the note that has her first name alone, and not the diary
		// only she uses.
		expect(JSON.stringify(report.findings)).not.toContain('diary');
	});

	it('a source viewers can see whose words carry a private person’s full name', async () => {
		const report = await service().report(treeId, actors.manager.context);
		const found = report.findings.filter((f) => f.rule === 'source_names_private_person');
		expect(found).toHaveLength(1);
		// "Letters of Livia Aliveson" supports Grandar's birth; the certificate supports only Livia.
		expect(found[0].message).toContain('Letters of Livia Aliveson');
	});

	it('names the rules and gives every one a reason', async () => {
		const { QUALITY_RULE_BY_CODE } = await import('../../shared/quality');
		for (const code of LEAK_RULES) {
			const rule = QUALITY_RULE_BY_CODE.get(code)!;
			expect(rule.severity).toBe('warning');
			expect(rule.isManagerOnly).toBe(true);
			expect(rule.why.length).toBeGreaterThan(40);
		}
	});

	it('is the same over the rows directly, and finds nothing when nobody is private', async () => {
		const rows = await new ChangeStore(t.db).loadRows(treeId);
		const cutoff = livingCutoff(NOW, 110);
		expect(
			checkPrivacyLeaks(rows, cutoff)
				.map((f) => f.rule)
				.sort()
		).toEqual([
			'note_names_private_person',
			'note_names_private_person',
			'public_override_likely_living',
			'source_names_private_person'
		]);
		// No-one private: everyone is dead by the cut-off.
		expect(
			checkPrivacyLeaks(
				{ ...rows, individuals: rows.individuals.filter((p) => p.givenName === 'Old') },
				cutoff
			).filter((f) => f.rule !== 'public_override_likely_living')
		).toEqual([]);
	});
});

// Each undated person is kept private by their own facts; only their relatives' dates differ.
const RELATIVES_FIXTURE = `0 HEAD
0 @OLD@ INDI
1 NAME Old /Parent/
1 BIRT
2 DATE 1700
1 FAMS @F1@
0 @I1@ INDI
1 NAME Via /Parent/
1 FAMC @F1@
0 @I2@ INDI
1 NAME Has /Death/
1 FAMC @F1@
1 DEAT Y
0 @I3@ INDI
1 NAME Set /Public/
1 _EPOCH_PRIVACY public
1 FAMC @F1@
0 @I4@ INDI
1 NAME Set /Private/
1 RESN privacy
1 FAMC @F1@
0 @I5@ INDI
1 NAME Via /Child/
1 FAMS @F2@
0 @I6@ INDI
1 NAME Old /Child/
1 BIRT
2 DATE 1850
1 FAMC @F2@
0 @I7@ INDI
1 NAME Recent /Parent/
1 BIRT
2 DATE 1990
1 FAMS @F3@
0 @I8@ INDI
1 NAME Young /Child/
1 FAMC @F3@
0 @I9@ INDI
1 NAME Undated /Parent/
1 BIRT
1 FAMS @F4@
0 @I10@ INDI
1 NAME Unknown /Child/
1 FAMC @F4@
0 @F1@ FAM
1 HUSB @OLD@
1 CHIL @I1@
1 CHIL @I2@
1 CHIL @I3@
1 CHIL @I4@
0 @F2@ FAM
1 HUSB @I5@
1 CHIL @I6@
0 @F3@ FAM
1 HUSB @I7@
1 CHIL @I8@
0 @F4@ FAM
1 HUSB @I9@
1 CHIL @I10@
0 TRLR`;

describe('probably dead, but no death recorded', () => {
	const fired = async (cutoff: string) => {
		const relatives = await createTestTree(t.db, actors.owner);
		await importGedcomToDb(t.d1, relatives, RELATIVES_FIXTURE, 'Relatives');
		return checkPrivacyLeaks(await new ChangeStore(t.db).loadRows(relatives), cutoff)
			.filter((f) => f.rule === 'probably_dead_no_death')
			.map((f) => f.subjects[0].name)
			.sort();
	};

	it('fires through an old parent or child, not a recent or undated one, a death or an override', async () => {
		// Not Has Death (a death), Set Public or Set Private (overrides), Young Child (a parent born
		// in 1990), or Unknown Child (a parent with an undated birth).
		expect(await fired(livingCutoff(NOW, 120))).toEqual(['Via Child', 'Via Parent']);
	});

	it('is quiet on a public tree, where nobody counts as living', async () => {
		expect(await fired(EVERYONE_SHOWN_CUTOFF)).toEqual([]);
	});

	it('is a manager-only suggestion', async () => {
		const { QUALITY_RULE_BY_CODE } = await import('../../shared/quality');
		const rule = QUALITY_RULE_BY_CODE.get('probably_dead_no_death')!;
		expect(rule.severity).toBe('suggestion');
		expect(rule.isManagerOnly).toBe(true);
	});
});

describe('who is shown them', () => {
	it.each(['manager', 'owner'] as const)('shows a %s the findings', async (who) => {
		const rules = await rulesFor(who);
		for (const rule of LEAK_RULES) expect(rules).toContain(rule);
	});

	it.each(['editor', 'contributor', 'viewer'] as const)(
		'shows a %s none, and no name',
		async (who) => {
			const report = await service().report(treeId, actors[who].context);
			expect(report.findings.filter((f) => LEAK_RULES.includes(f.rule))).toEqual([]);
			expect(report.counts['note_names_private_person']).toBeUndefined();
			expect(JSON.stringify(report.findings)).not.toContain('Aliveson');
		}
	);

	it('cannot be dismissed by an editor, who is not shown the finding, but can by a manager', async () => {
		const report = await service().report(treeId, actors.manager.context);
		const finding = report.findings.find((f) => f.rule === 'public_override_likely_living')!;
		await expect(
			service().dismiss(treeId, finding.key, 'meant it', actors.editor.context)
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await service().dismiss(treeId, finding.key, 'Max is a public figure', actors.manager.context);
		expect(
			(await service().report(treeId, actors.manager.context)).findings.some(
				(f) => f.key === finding.key
			)
		).toBe(false);
		await service().restore(treeId, finding.key, actors.manager.context);
	});
});

describe('tasks from findings', () => {
	it('has a finding say it has a task, and completing the task does not dismiss the finding', async () => {
		const report = await service().report(treeId, actors.manager.context);
		const finding = report.findings.find((f) => f.rule === 'public_override_likely_living')!;
		expect(finding.task).toBeUndefined();

		const tasks = new TaskService(t.db);
		const made = await tasks.createTask(
			treeId,
			{
				task: { title: 'Check whether Max is living' },
				subject: { kind: 'person', id: finding.subjects[0].id },
				findingKey: finding.key
			},
			actors.manager.context
		);
		const withTask = (await service().report(treeId, actors.manager.context)).findings.find(
			(f) => f.key === finding.key
		)!;
		expect(withTask.task).toEqual({
			id: made.taskId,
			title: 'Check whether Max is living',
			status: 'open'
		});

		await tasks.updateTask(
			treeId,
			made.taskId,
			{ status: 'done' },
			undefined,
			actors.manager.context
		);
		const afterDone = (await service().report(treeId, actors.manager.context)).findings.find(
			(f) => f.key === finding.key
		)!;
		// The finding is still there, now showing its completed task: two separate decisions.
		expect(afterDone.task).toMatchObject({ id: made.taskId, status: 'done' });
		expect(
			(await service().report(treeId, actors.manager.context)).dismissed.map((d) => d.key)
		).not.toContain(finding.key);
	});
});
