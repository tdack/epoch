/**
 * "Match places" over a real database (ADR-078): which places may be looked up, one run per tree,
 * the candidates kept, bulk accept, and who may do any of it.
 */

import type { Workflow } from '@cloudflare/workers-types';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { changeLog, placeLocations, placeMatchCandidates, placeMatchRuns } from '../db/schema';
import { ChangeLogService } from './change-log-service';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { GeoCandidate } from '../../shared/geo';
import { HIGH_MATCH_SCORE, MAX_PLACES_PER_MATCH_RUN } from '../../shared/place-match';
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
import type { PlaceMatchPayload } from '../workflows/place-match-workflow';
import { PlaceMatchRepository } from '../repositories/place-match-repository';
import { PlaceMatchService } from './place-match-service';
import { PlaceService } from './place-service';
import { SettingsService } from './settings-service';

const NOW = new Date('2026-10-01T12:00:00Z');

/** One dead person (born 1850) unless `extra` says otherwise. */
function person(n: number, place: string, extra = '', birth = '1850') {
	return `0 @I${n}@ INDI\n1 NAME P${n} /Match/\n1 BIRT\n2 DATE ${birth}\n2 PLAC ${place}\n${extra}`;
}

const FIXTURE = [
	'0 HEAD',
	// Allowed: a death, an old birth, a public living person, and a place shared with a living one.
	`${person(1, 'Ballarat, Victoria, Australia')}1 DEAT\n2 DATE 1900`,
	person(2, 'Geelong, Victoria'),
	person(13, 'Geelong, Victoria'),
	person(3, 'Perthville', '', '1990'),
	person(4, 'Publicton', '', '1995'),
	person(5, '12 High Street, Ballarat'),
	person(6, 'Hobart', '3 MAP\n4 LATI S42.88\n4 LONG E147.33\n'),
	person(7, 'Ignoredville'),
	person(8, 'Mixed Place'),
	person(9, 'Mixed Place', '', '1990'),
	person(10, 'Addressed', '2 ADDR 5 Foo Street\n'),
	person(11, 'Secretville'),
	person(12, 'Ab'),
	// Partnerships: a fact of a partnership needs every partner shown.
	'0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 PLAC Deadwed',
	'0 @F2@ FAM\n1 HUSB @I1@\n1 WIFE @I3@\n1 MARR\n2 PLAC Livingwed',
	'0 TRLR'
].join('\n');

/** Names a run may look up from the fixture, once the fixture's other rules have applied. */
const ALLOWED = [
	'Ballarat, Victoria, Australia',
	'Deadwed',
	'Geelong, Victoria',
	'Mixed Place',
	'Publicton'
];

const ballarat: GeoCandidate = {
	name: 'Ballarat',
	displayName: 'Ballarat, Victoria, Australia',
	latitude: -37.56,
	longitude: 143.85,
	osmType: 'R',
	osmId: 11,
	kind: 'city',
	country: 'Australia',
	state: 'Victoria',
	county: null,
	city: null
};
const farm: GeoCandidate = {
	...ballarat,
	name: 'Ballarat Farm',
	displayName: 'Ballarat Farm, Victoria, Australia',
	kind: 'farm',
	osmId: 12
};

let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const owner = () => actors.owner.context;
const places = () => new PlaceService(t.db, () => NOW);
const repo = () => new PlaceMatchRepository(t.db);

function service(answer: (text: string) => GeoCandidate[] = () => [ballarat, farm]) {
	const search = vi.fn(async (text: string) => answer(text));
	return { search, match: new PlaceMatchService(t.db, () => NOW, { search }) };
}

async function idOf(name: string): Promise<string> {
	const page = await places().list(treeId, { q: name, limit: 100 }, owner());
	return page.items.find((p) => p.name === name)!.id;
}
const candidateCount = async () =>
	(await t.db.select().from(placeMatchCandidates).where(eq(placeMatchCandidates.treeId, treeId)))
		.length;
const locationRows = () =>
	t.db.select().from(placeLocations).where(eq(placeLocations.treeId, treeId));
const changeCount = async () =>
	(await t.db.select().from(changeLog).where(eq(changeLog.treeId, treeId))).length;

/** A fake workflow binding that records what it was asked to start. */
function fakeWorkflow(fail = false) {
	const create = vi.fn(async (_options: { id: string; params: PlaceMatchPayload }) => {
		if (fail) throw new Error('binding down');
		return {};
	});
	return { create, binding: { create } as unknown as Workflow<PlaceMatchPayload> };
}

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['manager', 'editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Matching');
	await t.d1.exec(
		`update individuals set privacy = 'public' where tree_id = '${treeId}' and given_name like 'P4%'`
	);
	await t.d1.exec(
		`update individuals set privacy = 'private' where tree_id = '${treeId}' and given_name like 'P11%'`
	);
	// Ignored by hand, as a reviewer would.
	await places().changeLocation(
		treeId,
		{ kind: 'ignore_place_location', placeId: await idOf('Ignoredville') },
		owner()
	);
});
afterAll(async () => {
	await t.dispose();
});

describe('which places a run looks up', () => {
	it('takes only places the living rule shows, with no location, address or street address', async () => {
		const { match } = service();
		const selection = await match.selectForRun(treeId, actors.manager.userId);
		expect(selection.places.map((p) => p.name).sort()).toEqual(ALLOWED);
	});

	it('leaves out places only a living or private person, or a living partner, uses', async () => {
		const names = (await service().match.selectForRun(treeId, actors.owner.userId)).places.map(
			(p) => p.name
		);
		for (const left of ['Perthville', 'Livingwed', 'Secretville'])
			expect(names).not.toContain(left);
	});

	it('leaves out located, ignored, short and street-address places and facts with an address', async () => {
		const names = (await service().match.selectForRun(treeId, actors.owner.userId)).places.map(
			(p) => p.name
		);
		for (const left of ['Hobart', 'Ignoredville', 'Ab', '12 High Street, Ballarat', 'Addressed'])
			expect(names).not.toContain(left);
	});

	it('uses the tree rule even on the public tree, where nobody counts as living', async () => {
		await t.d1.exec(`update trees set is_public = 1 where id = '${treeId}'`);
		try {
			const names = (await service().match.selectForRun(treeId, actors.owner.userId)).places.map(
				(p) => p.name
			);
			expect(names).not.toContain('Perthville');
			expect(names).toEqual(expect.arrayContaining(ALLOWED));
		} finally {
			await t.d1.exec(`update trees set is_public = 0 where id = '${treeId}'`);
		}
	});

	it('puts the most-used place first, and clears the last run candidates', async () => {
		const first = await service().match.selectForRun(treeId, actors.owner.userId);
		expect(first.places[0]).toMatchObject({ name: 'Geelong, Victoria' });
		// Only facts the rule shows are counted: the living person's at Mixed Place is not.
		expect(first.places.find((p) => p.name === 'Mixed Place')).toBeDefined();
		await repo().replaceCandidates(
			treeId,
			first.places[0]!.id,
			[
				{
					rank: 0,
					score: 0.9,
					latitude: 1,
					longitude: 1,
					osmType: null,
					osmId: null,
					displayName: 'Old',
					kind: null
				}
			],
			NOW
		);
		expect(await candidateCount()).toBe(1);
		await service().match.selectForRun(treeId, actors.owner.userId);
		expect(await candidateCount()).toBe(0);
	});

	it('refuses anyone who is not a manager, a job with no requester, and a switched-off install', async () => {
		const { match } = service();
		await expect(match.selectForRun(treeId, actors.editor.userId)).rejects.toThrow(
			UnauthorizedError
		);
		await expect(match.selectForRun(treeId, undefined)).rejects.toThrow(UnauthorizedError);
		await new SettingsService(t.db).updateSite(
			{ maps: { isGeocodingEnabled: false } },
			{ ...owner(), user: { ...owner().user, isInstallOwner: true } }
		);
		try {
			await expect(match.selectForRun(treeId, actors.manager.userId)).rejects.toThrow(
				ValidationError
			);
		} finally {
			await new SettingsService(t.db).updateSite(
				{ maps: null },
				{ ...owner(), user: { ...owner().user, isInstallOwner: true } }
			);
		}
	});

	it('records how many places the run will look up, and how many the cap left out', async () => {
		expect(MAX_PLACES_PER_MATCH_RUN).toBeGreaterThan(ALLOWED.length);
		const { match } = service();
		await match.start(treeId, owner(), fakeWorkflow().binding);
		await match.selectForRun(treeId, actors.owner.userId);
		expect(await repo().run(treeId)).toMatchObject({
			status: 'running',
			total: ALLOWED.length,
			skippedByCap: 0
		});
		await match.finish(treeId, 'done');
	});
});

describe('one run per tree', () => {
	it('starts, refuses a second while running, and starts again once finished', async () => {
		const { match } = service();
		const { create, binding } = fakeWorkflow();
		const started = await match.start(treeId, actors.manager.context, binding);
		expect(started.instanceId).toMatch(new RegExp(`^placematch_${treeId}_\\d+$`));
		expect(create).toHaveBeenCalledWith({
			id: started.instanceId,
			params: { treeId, userId: actors.manager.userId }
		});
		await expect(match.start(treeId, actors.owner.context, binding)).rejects.toThrow(
			ConcurrencyConflictError
		);
		expect(create).toHaveBeenCalledTimes(1);

		await match.finish(treeId, 'done');
		await match.start(treeId, actors.owner.context, binding);
		expect(create).toHaveBeenCalledTimes(2);
		await match.finish(treeId, 'done');
	});

	it('gives the slot back when the workflow cannot be created', async () => {
		const { match } = service();
		await expect(match.start(treeId, owner(), fakeWorkflow(true).binding)).rejects.toThrow();
		expect((await repo().run(treeId))!.status).toBe('failed');
		await match.start(treeId, owner(), fakeWorkflow().binding);
		await match.finish(treeId, 'done');
	});

	it('replaces a run that has been going for too long', async () => {
		const { match } = service();
		await match.start(treeId, owner(), fakeWorkflow().binding);
		await t.db
			.update(placeMatchRuns)
			.set({ startedAt: new Date(NOW.getTime() - 7 * 3600 * 1000) })
			.where(eq(placeMatchRuns.treeId, treeId));
		await match.start(treeId, owner(), fakeWorkflow().binding);
		await match.finish(treeId, 'done');
	});

	it('refuses when the workflow is not bound, when geocoding is off, and non-managers', async () => {
		const { match } = service();
		await expect(match.start(treeId, owner(), undefined)).rejects.toThrow(/not available/);
		await expect(
			match.start(treeId, actors.editor.context, fakeWorkflow().binding)
		).rejects.toThrow(UnauthorizedError);
		const siteOwner = { ...owner(), user: { ...owner().user, isInstallOwner: true } };
		await new SettingsService(t.db).updateSite({ maps: { isGeocodingEnabled: false } }, siteOwner);
		try {
			const { create, binding } = fakeWorkflow();
			await expect(match.start(treeId, owner(), binding)).rejects.toThrow(ValidationError);
			expect(create).not.toHaveBeenCalled();
		} finally {
			await new SettingsService(t.db).updateSite({ maps: null }, siteOwner);
		}
		// Refused starts leave the slot free.
		expect((await repo().run(treeId))!.status).not.toBe('running');
	});
});

describe('candidates', () => {
	it('stores up to five scored candidates per place, best first, and counts the run', async () => {
		const { match, search } = service(() => [farm, ballarat]);
		await match.start(treeId, owner(), fakeWorkflow().binding);
		const selection = await match.selectForRun(treeId, owner().user.id);
		const done = await match.matchPlaces(treeId, selection.places.slice(0, 2), selection);
		expect(done).toEqual({ searched: 2, matched: 2 });
		expect(search).toHaveBeenCalledTimes(2);

		const stored = await repo().candidatesOf(treeId, [selection.places[0]!.id]);
		const list = stored.get(selection.places[0]!.id)!;
		expect(list.map((c) => c.rank)).toEqual([0, 1]);
		// The town that Photon listed second outranks the farm that it listed first.
		expect(list[0]!.displayName).toBe('Ballarat, Victoria, Australia');
		expect(list[0]!.osmType).toBe('relation');
		expect(list[0]!.score).toBeGreaterThan(list[1]!.score);
		expect((await repo().run(treeId))!).toMatchObject({ searched: 2, matched: 2 });
		await match.finish(treeId, 'done');
	});

	it('keeps at most five candidates', async () => {
		const many = Array.from({ length: 8 }, (_, i) => ({
			...farm,
			displayName: `Farm ${i}`,
			osmId: i + 100
		}));
		const { match } = service(() => many);
		const selection = await match.selectForRun(treeId, owner().user.id);
		await match.matchPlaces(treeId, selection.places.slice(0, 1), selection);
		expect(
			(await repo().candidatesOf(treeId, [selection.places[0]!.id])).get(selection.places[0]!.id)
		).toHaveLength(5);
	});

	it('replaces a place candidates on a new run, and keeps them when Photon answers nothing', async () => {
		const first = service(() => [ballarat]);
		const selection = await first.match.selectForRun(treeId, owner().user.id);
		const place = selection.places.slice(0, 1);
		await first.match.matchPlaces(treeId, place, selection);
		await service(() => [farm]).match.matchPlaces(treeId, place, selection);
		const kept = (await repo().candidatesOf(treeId, [place[0]!.id])).get(place[0]!.id)!;
		expect(kept.map((c) => c.displayName)).toEqual(['Ballarat Farm, Victoria, Australia']);
		expect(kept[0]!.kind).toBe('farm');
		const none = await service(() => []).match.matchPlaces(treeId, place, selection);
		expect(none.matched).toBe(0);
		expect((await repo().candidatesOf(treeId, [place[0]!.id])).get(place[0]!.id)).toHaveLength(1);
	});

	it('stops a batch when geocoding has been switched off, so nothing is written empty', async () => {
		const { match, search } = service();
		const selection = await match.selectForRun(treeId, owner().user.id);
		const siteOwner = { ...owner(), user: { ...owner().user, isInstallOwner: true } };
		await new SettingsService(t.db).updateSite({ maps: { isGeocodingEnabled: false } }, siteOwner);
		try {
			await expect(match.matchPlaces(treeId, selection.places, selection)).rejects.toThrow(
				ValidationError
			);
			expect(search).not.toHaveBeenCalled();
		} finally {
			await new SettingsService(t.db).updateSite({ maps: null }, siteOwner);
		}
	});

	it('biases the search toward the tree confirmed places', async () => {
		const { match, search } = service();
		const selection = await match.selectForRun(treeId, owner().user.id);
		expect(selection.centroid).toEqual({ latitude: -42.88, longitude: 147.33 });
		await match.matchPlaces(treeId, selection.places.slice(0, 1), selection);
		expect(search).toHaveBeenCalledWith(expect.any(String), {
			latitude: -42.88,
			longitude: 147.33
		});
	});
});

describe('review and search again', () => {
	it('lists unlocated places that have candidates, best first, for managers only', async () => {
		const { match } = service((text) => (text.startsWith('Ballarat') ? [ballarat] : [farm]));
		const selection = await match.selectForRun(treeId, owner().user.id);
		await match.matchPlaces(treeId, selection.places, selection);
		const review = await match.review(treeId, {}, actors.manager.context);
		expect(review.places.map((p) => p.name).sort()).toEqual(ALLOWED);
		expect(review.places[0]!.name).toBe('Ballarat, Victoria, Australia');
		expect(review.places[0]!.candidates[0]!.score).toBeGreaterThanOrEqual(
			review.places.at(-1)!.candidates[0]!.score
		);
		expect(review.highCount).toBeGreaterThanOrEqual(1);
		await expect(match.review(treeId, {}, actors.editor.context)).rejects.toThrow(
			UnauthorizedError
		);
	});

	it('never lists a place that has since been located or ignored', async () => {
		const { match } = service();
		const id = await idOf('Geelong, Victoria');
		await places().changeLocation(treeId, { kind: 'ignore_place_location', placeId: id }, owner());
		const review = await match.review(treeId, {}, owner());
		expect(review.places.map((p) => p.name)).not.toContain('Geelong, Victoria');
		await places().changeLocation(treeId, { kind: 'clear_place_location', placeId: id }, owner());
	});

	it('searches again for edited text and replaces that place candidates', async () => {
		const { match, search } = service(() => [farm]);
		const id = await idOf('Publicton');
		const found = await match.searchAgain(
			treeId,
			id,
			'Ballarat Farm, Victoria',
			actors.manager.context
		);
		expect(search).toHaveBeenCalledWith('Ballarat Farm, Victoria', expect.anything());
		expect(found.map((c) => c.displayName)).toEqual(['Ballarat Farm, Victoria, Australia']);
		// Empty is an answer too when the reviewer asked for it.
		const none = await service(() => []).match.searchAgain(treeId, id, 'Nowhere at all', owner());
		expect(none).toEqual([]);
	});

	it('refuses text that may not be sent, an unknown place, and non-managers', async () => {
		const { match, search } = service();
		const id = await idOf('Publicton');
		await expect(match.searchAgain(treeId, id, '12 High Street', owner())).rejects.toThrow(
			ValidationError
		);
		await expect(match.searchAgain(treeId, 'nope', 'Ballarat', owner())).rejects.toThrow(
			NotFoundError
		);
		await expect(match.searchAgain(treeId, id, 'Ballarat', actors.editor.context)).rejects.toThrow(
			UnauthorizedError
		);
		expect(search).not.toHaveBeenCalled();
	});
});

describe('bulk accept', () => {
	async function prepare() {
		const { match } = service((text) => (text.startsWith('Ballarat') ? [ballarat] : [farm]));
		const selection = await match.selectForRun(treeId, owner().user.id);
		await match.matchPlaces(treeId, selection.places, selection);
		return match;
	}

	it('accepts every top candidate at or above the score as one change, and only those', async () => {
		const match = await prepare();
		const before = await changeCount();
		const top = await repo().topCandidatesAtOrAbove(treeId, HIGH_MATCH_SCORE, 100);
		expect(top.length).toBeGreaterThanOrEqual(1);
		const lowNames = (await match.review(treeId, {}, owner())).places.filter(
			(p) => p.candidates[0]!.score < HIGH_MATCH_SCORE
		);

		const result = await match.acceptMatches(treeId, HIGH_MATCH_SCORE, actors.manager.context);
		expect(result).toMatchObject({ accepted: top.length, remaining: 0 });
		expect(result.change).not.toBeNull();
		expect(await changeCount()).toBe(before + 1);

		const rows = await locationRows();
		for (const c of top) {
			const row = rows.find((r) => r.id === c.placeId)!;
			expect(row).toMatchObject({ status: 'confirmed', source: 'photon', osmType: 'relation' });
		}
		// Low-scoring places stay unlocated, with their candidates for review.
		for (const low of lowNames) expect(rows.find((r) => r.id === low.id)).toBeUndefined();
	});

	it('undoes in one step', async () => {
		const before = (await locationRows()).length;
		const match = await prepare();
		await match.acceptMatches(treeId, 0.5, owner());
		const after = (await locationRows()).length;
		expect(after).toBeGreaterThan(before);
		await new ChangeLogService(t.db).undoLast(treeId, owner());
		expect((await locationRows()).length).toBe(before);
	});

	const candidate = (score: number, name: string) => ({
		rank: 0,
		score,
		latitude: -37.5,
		longitude: 143.8,
		osmType: null,
		osmId: null,
		displayName: name,
		kind: 'city'
	});

	it('skips a place that was located, or lost its facts, since the run', async () => {
		const { match } = service();
		const located = await idOf('Publicton');
		const mixed = await idOf('Mixed Place');
		const renamed = await idOf('Deadwed');
		await repo().clearCandidates(treeId);
		for (const id of [located, mixed, renamed])
			await repo().replaceCandidates(treeId, id, [candidate(0.9, 'Candidate')], NOW);

		// A hand-set pin, and a rename that moves every fact off the place the run looked up.
		await places().changeLocation(
			treeId,
			{
				kind: 'set_place_location',
				placeId: located,
				latitude: 10,
				longitude: 20,
				source: 'manual'
			},
			owner()
		);
		await places().rewrite(treeId, renamed, 'Deadwed Church', owner());

		const result = await match.acceptMatches(treeId, 0.8, owner());
		expect(result).toMatchObject({ accepted: 1, remaining: 0 });
		const rows = await locationRows();
		expect(rows.find((r) => r.id === located)).toMatchObject({
			latitude: 10,
			longitude: 20,
			source: 'manual'
		});
		expect(rows.find((r) => r.id === mixed)).toMatchObject({ source: 'photon' });
		expect(rows.find((r) => r.id === renamed)).toBeUndefined();
	});

	it('writes no change when nothing qualifies, and refuses scores below Medium', async () => {
		const match = service().match;
		const before = await changeCount();
		expect(await match.acceptMatches(treeId, 1, owner())).toMatchObject({
			accepted: 0,
			change: null
		});
		expect(await changeCount()).toBe(before);
		await expect(match.acceptMatches(treeId, 0.2, owner())).rejects.toThrow(ValidationError);
		await expect(match.acceptMatches(treeId, Number.NaN, owner())).rejects.toThrow(ValidationError);
	});

	it('is a manager action: editors and below are refused before anything is read', async () => {
		const match = service().match;
		for (const role of ['editor', 'contributor', 'viewer'] as const)
			await expect(match.acceptMatches(treeId, 0.8, actors[role].context)).rejects.toThrow(
				UnauthorizedError
			);
		const [{ n }] = await t.db.all<{ n: number }>(
			sql`select count(*) as n from place_locations where tree_id = ${treeId} and source = 'photon' and display_name is null`
		);
		expect(n).toBe(0);
	});

	it('takes the best-scoring places first when a batch cannot hold them all', async () => {
		const ids = [await idOf('Geelong, Victoria'), await idOf('Deadwed Church')];
		await repo().clearCandidates(treeId);
		await repo().replaceCandidates(treeId, ids[0]!, [candidate(0.8, 'Lower')], NOW);
		await repo().replaceCandidates(treeId, ids[1]!, [candidate(0.95, 'Higher')], NOW);
		const [first] = await repo().topCandidatesAtOrAbove(treeId, 0.5, 1);
		expect(first).toMatchObject({ placeId: ids[1], displayName: 'Higher' });
		expect(await repo().countAtOrAbove(treeId, 0.5)).toBe(2);
	});
});
