/**
 * The data-quality report (Phase 5): what it finds over real rows, who may read and dismiss, what a
 * restricted viewer is never told, and that a dismissal keeps matching until the data changes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { events } from '../db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors';
import type { TreeRole } from '../domain/identity';
import { importGedcomToDb } from '../gedcom/importer';
import {
	addTestMember,
	createTestDatabase,
	createTestTree,
	createTestUser,
	type TestActor,
	type TestDatabase
} from '../testing/d1';
import { FactService } from './fact-service';
import { QualityService } from './quality-service';
import { MAX_FINDINGS_PER_RULE } from '../../shared/quality';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Dead /Early/
1 BIRT
2 DATE 1900
1 DEAT
2 DATE 1899
0 @I2@ INDI
1 NAME Kid /Early/
1 BIRT
2 DATE 1890
1 FAMC @F1@
0 @I3@ INDI
1 NAME Parent /Early/
1 BIRT
2 DATE 1900
1 FAMS @F1@
0 @I4@ INDI
1 NAME Secret /Hidden/
1 RESN privacy
1 BIRT
2 DATE 1900
1 DEAT
2 DATE 1890
0 @F1@ FAM
1 HUSB @I3@
1 CHIL @I2@
0 TRLR`;

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const service = () => new QualityService(t.db);

const rulesFor = async (who: TreeRole) =>
	(await service().report(treeId, actors[who].context)).findings.map((f) => f.rule);

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Quality');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the report', () => {
	it('finds what the rows say, most serious first, naming the people involved', async () => {
		const report = await service().report(treeId, actors.owner.context);
		const byRule = (rule: string) => report.findings.filter((f) => f.rule === rule);
		expect(
			byRule('death_before_birth')
				.map((f) => f.subjects[0]!.name)
				.sort()
		).toEqual(['Dead Early', 'Secret Hidden']);
		expect(byRule('child_before_parent')).toHaveLength(1);
		expect(byRule('child_before_parent')[0]!.message).toContain('Kid Early');
		expect(byRule('one_parent_recorded')).toHaveLength(1);
		const severities = report.findings.map((f) => f.severity);
		expect(severities).toEqual(
			[...severities].sort(
				(a, b) =>
					['error', 'warning', 'suggestion'].indexOf(a) -
					['error', 'warning', 'suggestion'].indexOf(b)
			)
		);
		expect(report.counts.death_before_birth).toBe(2);
	});

	it('tells a restricted viewer nothing about a private person, and does not let a rule hint at one', async () => {
		for (const who of ['viewer', 'contributor'] as const) {
			const report = await service().report(treeId, actors[who].context);
			expect(JSON.stringify(report)).not.toContain('Secret');
			expect(report.counts.death_before_birth).toBe(1);
		}
	});

	it('is readable by every role, and only by members', async () => {
		for (const who of ['owner', 'editor', 'contributor', 'viewer'] as const)
			expect(await rulesFor(who)).toContain('child_before_parent');
		const stranger = await createTestUser(t.db, 'stranger');
		await expect(service().report(treeId, stranger.context)).rejects.toBeInstanceOf(
			UnauthorizedError
		);
	});
});

describe('dismissing', () => {
	const keyOf = async (rule: string) =>
		(await service().report(treeId, actors.owner.context)).findings.find((f) => f.rule === rule)!
			.key;

	it('needs a reason, an editor, and a finding that exists', async () => {
		const key = await keyOf('child_before_parent');
		await expect(
			service().dismiss(treeId, key, '   ', actors.editor.context)
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			service().dismiss(treeId, key, 'x'.repeat(501), actors.editor.context)
		).rejects.toBeInstanceOf(ValidationError);
		for (const who of ['contributor', 'viewer'] as const) {
			await expect(
				service().dismiss(treeId, key, 'Checked the register', actors[who].context)
			).rejects.toBeInstanceOf(UnauthorizedError);
			await expect(service().restore(treeId, key, actors[who].context)).rejects.toBeInstanceOf(
				UnauthorizedError
			);
		}
		await expect(
			service().dismiss(
				treeId,
				'child_before_parent:nobody,nothing',
				'Because',
				actors.editor.context
			)
		).rejects.toBeInstanceOf(NotFoundError);
		expect((await service().report(treeId, actors.owner.context)).dismissed).toEqual([]);
	});

	it('moves a finding to the dismissed list with its reason, for everyone, and restores it', async () => {
		const key = await keyOf('child_before_parent');
		await service().dismiss(
			treeId,
			key,
			'  Both dates are in the register  ',
			actors.editor.context
		);

		for (const who of ['owner', 'viewer'] as const) {
			const report = await service().report(treeId, actors[who].context);
			expect(report.findings.map((f) => f.key)).not.toContain(key);
			expect(report.counts.child_before_parent).toBeUndefined();
			expect(report.dismissed).toHaveLength(1);
			expect(report.dismissed[0]).toMatchObject({ key, reason: 'Both dates are in the register' });
			expect(report.dismissed[0]!.dismissedBy).toBeTruthy();
			expect(report.dismissed[0]!.finding.message).toContain('Kid Early');
		}

		// The latest word stands.
		await service().dismiss(treeId, key, 'Confirmed twice', actors.owner.context);
		expect((await service().report(treeId, actors.owner.context)).dismissed[0]!.reason).toBe(
			'Confirmed twice'
		);

		await service().restore(treeId, key, actors.editor.context);
		const restored = await service().report(treeId, actors.owner.context);
		expect(restored.dismissed).toEqual([]);
		expect(restored.findings.map((f) => f.key)).toContain(key);
		await expect(service().restore(treeId, key, actors.editor.context)).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

	it('stops listing a dismissal once the data no longer raises the finding, and never lists one about a hidden person', async () => {
		const secretKey = await keyOf('death_before_birth').then(
			async () =>
				(await service().report(treeId, actors.owner.context)).findings.find((f) =>
					f.message.includes('Secret')
				)!.key
		);
		await service().dismiss(treeId, secretKey, 'Known', actors.owner.context);
		expect(JSON.stringify(await service().report(treeId, actors.viewer.context))).not.toContain(
			secretKey
		);
		expect((await service().report(treeId, actors.owner.context)).dismissed).toHaveLength(1);
		await service().restore(treeId, secretKey, actors.owner.context);
	});

	it('keeps matching after an unrelated edit, and stops listing once the dates are corrected', async () => {
		const key = await keyOf('death_before_birth').then(
			async () =>
				(await service().report(treeId, actors.owner.context)).findings.find((f) =>
					f.message.includes('Dead Early')
				)!.key
		);
		await service().dismiss(treeId, key, 'Transcription is right', actors.owner.context);
		const personId = (await service().report(treeId, actors.owner.context)).dismissed[0]!.finding
			.subjects[0]!.id;

		const facts = new FactService(t.db);
		await facts.create(
			treeId,
			personId,
			{
				dateText: '1950',
				place: null,
				value: null,
				cause: null,
				age: null,
				notes: null,
				type: 'RESI'
			},
			actors.owner.context
		);
		expect((await service().report(treeId, actors.owner.context)).dismissed).toHaveLength(1);

		const death = await t.db
			.select()
			.from(events)
			.where(and(eq(events.entityId, personId), eq(events.type, 'DEAT')))
			.get();
		await facts.update(
			treeId,
			death!.id,
			{ dateText: '1950' },
			death!.version,
			actors.owner.context
		);
		const corrected = await service().report(treeId, actors.owner.context);
		expect(corrected.dismissed).toEqual([]);
		expect(corrected.findings.map((f) => f.key)).not.toContain(key);
		// The decision itself is kept, so it can still be brought back.
		await service().restore(treeId, key, actors.owner.context);
	});
});

describe('a badly tangled tree', () => {
	it('lists the first findings of a rule, and counts them all', async () => {
		const owner = await createTestUser(t.db, 'bulk');
		const tree = await createTestTree(t.db, owner);
		const children = Array.from(
			{ length: MAX_FINDINGS_PER_RULE + 5 },
			(_, i) => `0 @C${i}@ INDI\n1 NAME Child${i} /Bulk/\n1 FAMC @F1@`
		).join('\n');
		await importGedcomToDb(
			t.d1,
			tree,
			`0 HEAD\n0 @P@ INDI\n1 NAME Parent /Bulk/\n1 FAMS @F1@\n${children}\n0 @F1@ FAM\n1 HUSB @P@\n${Array.from({ length: MAX_FINDINGS_PER_RULE + 5 }, (_, i) => `1 CHIL @C${i}@`).join('\n')}\n0 TRLR`,
			'Bulk'
		);

		const report = await new QualityService(t.db).report(tree, owner.context);
		expect(report.counts.one_parent_recorded).toBe(MAX_FINDINGS_PER_RULE + 5);
		expect(report.findings.filter((f) => f.rule === 'one_parent_recorded')).toHaveLength(
			MAX_FINDINGS_PER_RULE
		);
		expect(report.truncatedRules).toEqual(['one_parent_recorded']);
	}, 60_000);
});
