import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { individuals } from '../db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '../domain/errors';
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
import { ChangeLogService } from './change-log-service';
import { PersonPageService } from './person-page-service';
import { PrivacyService } from './privacy-service';
import { SearchService } from './search-service';

const FIXTURE = `0 HEAD
0 @I1@ INDI
1 NAME Olda /Oldman/
1 BIRT
2 DATE 1850
0 @I2@ INDI
1 NAME Mida /Middleton/
1 BIRT
2 DATE 1900
0 @I3@ INDI
1 NAME Younga /Youngman/
1 BIRT
2 DATE 1990
0 TRLR`;

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
let idOf: (xref: string) => string;
const service = () =>
	new PrivacyService(t.db, { now: () => NOW.getTime(), newId: () => crypto.randomUUID() });
const search = () => new SearchService(t.db, () => NOW);
const found = async (text: string) =>
	(await search().search(treeId, { text }, actors.viewer.context)).people.length;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Privacy service');
	const rows = await t.db
		.select({ id: individuals.id, xref: individuals.xrefId })
		.from(individuals)
		.where(eq(individuals.treeId, treeId));
	const byXref = new Map(rows.map((r) => [r.xref, r.id]));
	idOf = (xref) => byXref.get(xref)!;
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe("a person's override", () => {
	it('lets a manager hide an old person and show a young one, and an undo puts it back', async () => {
		expect(await found('Olda')).toBe(1);
		expect(await found('Younga')).toBe(0);
		await service().setPersonPrivacy(
			treeId,
			idOf('@I1@'),
			'private',
			undefined,
			actors.manager.context
		);
		await service().setPersonPrivacy(
			treeId,
			idOf('@I3@'),
			'public',
			undefined,
			actors.manager.context
		);
		expect(await found('Olda')).toBe(0);
		expect(await found('Younga')).toBe(1);

		const undo = new ChangeLogService(t.db, {
			now: () => NOW.getTime(),
			newId: () => crypto.randomUUID()
		});
		await undo.undoLast(treeId, actors.manager.context);
		expect(await found('Younga')).toBe(0);
		await service().setPersonPrivacy(
			treeId,
			idOf('@I1@'),
			'auto',
			undefined,
			actors.manager.context
		);
		expect(await found('Olda')).toBe(1);
	});

	it.each(['editor', 'contributor', 'viewer'] as const)('is refused for a %s', async (role) => {
		await expect(
			service().setPersonPrivacy(treeId, idOf('@I1@'), 'private', undefined, actors[role].context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it('shows a manager the setting and what the dates alone say, and a viewer neither', async () => {
		const pages = new PersonPageService(t.db, () => NOW);
		const asManager = await pages.getPerson(treeId, idOf('@I3@'), actors.manager.context);
		expect(asManager.privacy).toEqual({
			setting: 'auto',
			isLikelyLiving: true,
			isRecentlyDead: false
		});
		const old = await pages.getPerson(treeId, idOf('@I1@'), actors.manager.context);
		expect(old.privacy).toEqual({
			setting: 'auto',
			isLikelyLiving: false,
			isRecentlyDead: false
		});
		const asViewer = await pages.getPerson(treeId, idOf('@I1@'), actors.viewer.context);
		expect(asViewer.privacy).toBeNull();
	});
});

describe('the tree settings', () => {
	it('are read and changed by a manager only', async () => {
		expect(await service().getSettings(treeId, actors.manager.context)).toEqual({
			maxAliveYears: 120,
			recentDeathYears: 0,
			shouldShowPrivateStructure: false
		});
		for (const role of ['editor', 'contributor', 'viewer'] as const) {
			await expect(service().getSettings(treeId, actors[role].context)).rejects.toBeInstanceOf(
				UnauthorizedError
			);
			await expect(
				service().updateSettings(treeId, { maxAliveYears: 100 }, actors[role].context)
			).rejects.toBeInstanceOf(UnauthorizedError);
		}
	});

	it('move the age at which someone stops being private', async () => {
		// Mida was born in 1900: not living at 120 years, living at 150.
		expect(await found('Mida')).toBe(1);
		await service().updateSettings(treeId, { maxAliveYears: 150 }, actors.manager.context);
		expect(await found('Mida')).toBe(0);
		await service().updateSettings(treeId, { maxAliveYears: 120 }, actors.manager.context);
		expect(await found('Mida')).toBe(1);
	});

	it('refuse a recent-death window outside 0 to 100 years', async () => {
		for (const bad of [-1, 101, 2.5]) {
			await expect(
				service().updateSettings(treeId, { recentDeathYears: bad }, actors.manager.context)
			).rejects.toBeInstanceOf(ValidationError);
		}
		const saved = await service().updateSettings(
			treeId,
			{ recentDeathYears: 25 },
			actors.manager.context
		);
		expect(saved.recentDeathYears).toBe(25);
		await service().updateSettings(treeId, { recentDeathYears: 0 }, actors.manager.context);
	});

	it('refuse an age that would show the living or hide everyone', async () => {
		for (const bad of [10, 49, 151, 1000, 80.5]) {
			await expect(
				service().updateSettings(treeId, { maxAliveYears: bad }, actors.manager.context)
			).rejects.toBeInstanceOf(ValidationError);
		}
	});
});

describe('the imported details of a fact', () => {
	const DETAILS = `2 AGNC Parish of St Mary
2 RELI Anglican
2 ADDR 12 High St
3 CONT York
2 PHON 0113 000
2 EMAIL old@example.test
2 FAX 0113 999
2 WWW https://example.test
2 PLAC York
3 MAP
4 LATI N53.8
4 LONG W1.5
2 RESN locked`;
	const DETAILED = `0 HEAD
0 @I1@ INDI
1 NAME Olda /Oldman/
1 BAPM
2 DATE 1850
${DETAILS}
0 @I2@ INDI
1 NAME Younga /Youngman/
1 BAPM
2 DATE 1990
${DETAILS}
0 TRLR`;
	const SECRETS = [
		'Parish of St Mary',
		'Anglican',
		'12 High St',
		'0113 000',
		'old@example.test',
		'0113 999',
		'https://example.test',
		'N53.8',
		'W1.5',
		'RESN locked'
	];
	let detailTree: string;
	let detailIds: Record<string, string>;

	beforeAll(async () => {
		detailTree = await createTestTree(t.db, actors.owner);
		await addTestMember(t.db, detailTree, actors.manager, 'manager');
		await addTestMember(t.db, detailTree, actors.viewer, 'viewer');
		await importGedcomToDb(t.d1, detailTree, DETAILED, 'Fact details');
		const rows = await t.db
			.select({ id: individuals.id, xref: individuals.xrefId })
			.from(individuals)
			.where(eq(individuals.treeId, detailTree));
		detailIds = Object.fromEntries(rows.map((r) => [r.xref, r.id]));
	}, 60_000);

	it('reach a manager of a living person and a viewer of an old one, and nobody else', async () => {
		const pages = new PersonPageService(t.db, () => NOW);
		const asManager = JSON.stringify(
			await pages.getPerson(detailTree, detailIds['@I2@']!, actors.manager.context)
		);
		for (const secret of SECRETS) expect(asManager).toContain(secret);

		const asViewerOld = JSON.stringify(
			await pages.getPerson(detailTree, detailIds['@I1@']!, actors.viewer.context)
		);
		for (const secret of SECRETS) expect(asViewerOld).toContain(secret);
	});

	it('answers a viewer of a living person as for a missing one, with none of the details', async () => {
		const pages = new PersonPageService(t.db, () => NOW);
		const asViewer = pages.getPerson(detailTree, detailIds['@I2@']!, actors.viewer.context);
		await expect(asViewer).rejects.toBeInstanceOf(NotFoundError);
		const message = await asViewer.catch((error: Error) => error.message);
		for (const secret of SECRETS) expect(message).not.toContain(secret);
	});
});
