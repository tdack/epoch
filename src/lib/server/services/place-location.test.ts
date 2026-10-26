/**
 * Place locations over a real database (ADR-078): the import seed and the migration backfill agree
 * with the parser, the three commands and their undo, and what a restricted viewer may learn.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { changeLog, placeLocations } from '../db/schema';
import {
	ConcurrencyConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import { parseGedcomCoordinate } from '../../shared/places-coordinates';
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
import migration from '../../../../drizzle/0048_place_locations.sql?raw';
import { ChangeLogService } from './change-log-service';
import { PlaceService } from './place-service';

/** One birth per person; `lat`/`lng` are the text as a file writes it. */
function person(n: number, place: string, lat?: string, lng?: string, extra = '') {
	const map =
		lat !== undefined
			? `3 MAP\n${lat ? `4 LATI ${lat}\n` : ''}${lng ? `4 LONG ${lng}\n` : ''}`
			: '';
	return `0 @I${n}@ INDI\n1 NAME P${n} /Dead/\n1 BIRT\n2 DATE 18${50 + n}\n2 PLAC ${place}\n${map}${extra}`;
}

const FIXTURE = [
	'0 HEAD',
	// Cork: the first fact is unparseable, the second is the one that counts, the third must not win.
	person(1, 'Cork', 'X1', 'W8'),
	person(2, 'Cork', 'N51.9', 'W8.47'),
	person(3, 'Cork', 'N10', 'E10'),
	person(4, 'Hobart', 'S42.88', 'E147.33'),
	person(5, 'Bare', '51.5', '-0.12'),
	person(6, 'TooFar', 'N91', 'E10'),
	person(7, 'Swapped', 'E10', 'N10'),
	person(8, 'Garbled', 'N18.1.2', 'E1'),
	person(9, 'LatOnly', 'N5', ''),
	person(10, 'Nowhere'),
	// A living person's place: seeded like any other, and hidden from restricted viewers by the reads.
	`0 @I11@ INDI\n1 NAME Livia /Aliveson/\n1 BIRT\n2 DATE 1990\n2 PLAC Perthville\n3 MAP\n4 LATI S31.95\n4 LONG E115.86`,
	'0 TRLR'
].join('\n');

const NOW = new Date('2026-10-01T12:00:00Z');
let t: TestDatabase;
let treeId: string;
const actors = {} as Record<TreeRole, TestActor>;
const places = () => new PlaceService(t.db, () => NOW);
const log = () => new ChangeLogService(t.db);

/** Place id by name, seen as the owner. */
async function idOf(name: string): Promise<string> {
	const page = await places().list(treeId, { q: name, limit: 100 }, actors.owner.context);
	return page.items.find((p) => p.name === name)!.id;
}
const locationOf = async (name: string) =>
	(await places().detail(treeId, name, {}, actors.owner.context)).location;

beforeAll(async () => {
	t = await createTestDatabase();
	actors.owner = await createTestUser(t.db, 'owner');
	treeId = await createTestTree(t.db, actors.owner);
	for (const role of ['editor', 'contributor', 'viewer'] as const) {
		actors[role] = await createTestUser(t.db, role);
		await addTestMember(t.db, treeId, actors[role], role);
	}
	await importGedcomToDb(t.d1, treeId, FIXTURE, 'Locations');
}, 60_000);
afterAll(async () => {
	await t.dispose();
});

describe('the import seed and the backfill', () => {
	it('seeds the first fact whose coordinates parse, as confirmed gedcom, and skips the rest', async () => {
		const found = await t.db.select().from(placeLocations);
		expect(found.every((l) => l.status === 'confirmed' && l.source === 'gedcom')).toBe(true);
		expect(await locationOf('Cork')).toMatchObject({
			latitude: 51.9,
			longitude: -8.47,
			version: 1
		});
		expect(await locationOf('Hobart')).toMatchObject({ latitude: -42.88, longitude: 147.33 });
		expect(await locationOf('Bare')).toMatchObject({ latitude: 51.5, longitude: -0.12 });
		for (const skipped of ['TooFar', 'Swapped', 'Garbled', 'LatOnly', 'Nowhere'])
			expect(await locationOf(skipped), skipped).toBeNull();
	});

	it('is what the migration backfill computes, statement for statement', async () => {
		const seeded = new Map((await t.db.select().from(placeLocations)).map((l) => [l.id, l]));
		await t.db.delete(placeLocations);
		const backfill = migration.split('--> statement-breakpoint').at(-1)!.trim();
		await t.d1.prepare(backfill).run();
		const again = await t.db.select().from(placeLocations);
		expect(again).toHaveLength(seeded.size);
		for (const row of again) {
			expect(row).toMatchObject({
				latitude: seeded.get(row.id)!.latitude,
				longitude: seeded.get(row.id)!.longitude,
				status: 'confirmed',
				source: 'gedcom'
			});
		}
	});

	it('gives the same answers as parseGedcomCoordinate', async () => {
		const cases: Array<[string, string]> = [
			['N18.150944', 'W0.1278'],
			['s37.5', 'e143'],
			[' 5 ', '-5'],
			['+5', '+5'],
			['.5', '5.'],
			['N90', 'E180'],
			['S90.1', 'E10'],
			['N5', 'N5'],
			['5e1', '1'],
			['', '1'],
			['N', 'E'],
			['-', '1']
		];
		const sqlOf = async (lat: string, lng: string) => {
			const treeFor = await createTestTree(t.db, actors.owner);
			const placeId = crypto.randomUUID();
			await t.d1.batch([
				t.d1
					.prepare('insert into places (id, tree_id, name_key) values (?, ?, ?)')
					.bind(placeId, treeFor, 'x'),
				t.d1
					.prepare(
						"insert into events (id, tree_id, entity_type, entity_id, type, place, place_id, latitude, longitude) values (?, ?, 'INDIVIDUAL', 'p', 'BIRT', 'x', ?, ?, ?)"
					)
					.bind(crypto.randomUUID(), treeFor, placeId, lat, lng)
			]);
			await t.d1.prepare(migration.split('--> statement-breakpoint').at(-1)!.trim()).run();
			const [row] = await t.db.select().from(placeLocations).where(eq(placeLocations.id, placeId));
			return row ? [row.latitude, row.longitude] : null;
		};
		for (const [lat, lng] of cases) {
			const la = parseGedcomCoordinate(lat, 'latitude');
			const lo = parseGedcomCoordinate(lng, 'longitude');
			expect(await sqlOf(lat, lng), `${lat} / ${lng}`).toEqual(
				la !== null && lo !== null ? [la, lo] : null
			);
		}
	});

	it('is safe to run again and never overwrites a location, of any status or source', async () => {
		const corkId = await idOf('Cork');
		await t.db.delete(placeLocations).where(eq(placeLocations.id, corkId));
		await places().changeLocation(
			treeId,
			{ kind: 'set_place_location', placeId: corkId, latitude: 1, longitude: 2, source: 'manual' },
			actors.owner.context
		);
		const hobartId = await idOf('Hobart');
		await places().changeLocation(
			treeId,
			{ kind: 'ignore_place_location', placeId: hobartId },
			actors.owner.context
		);
		const before = await t.db.select().from(placeLocations);
		await t.d1.prepare(migration.split('--> statement-breakpoint').at(-1)!.trim()).run();
		await t.d1.prepare(migration.split('--> statement-breakpoint').at(-1)!.trim()).run();
		expect(await t.db.select().from(placeLocations)).toEqual(before);
		expect(await locationOf('Cork')).toMatchObject({ latitude: 1, longitude: 2, source: 'manual' });
		expect(await locationOf('Hobart')).toMatchObject({ status: 'ignored', latitude: null });
	});
});

describe('the commands', () => {
	it('sets a location for a place, logs it, and undoes it', async () => {
		const id = await idOf('Nowhere');
		expect(await locationOf('Nowhere')).toBeNull();
		const { change } = await places().changeLocation(
			treeId,
			{
				kind: 'set_place_location',
				placeId: id,
				latitude: -33.87,
				longitude: 151.21,
				source: 'photon',
				osmType: 'relation',
				osmId: 5750005,
				displayName: ' Sydney, Australia '
			},
			actors.owner.context
		);
		expect(change?.summary).toBe('Set the location of the place Nowhere');
		const [row] = await t.db.select().from(placeLocations).where(eq(placeLocations.id, id));
		expect(row).toMatchObject({
			status: 'confirmed',
			source: 'photon',
			osmType: 'relation',
			osmId: 5750005,
			displayName: 'Sydney, Australia',
			version: 1,
			treeId
		});

		await log().undoLast(treeId, actors.owner.context);
		expect(await locationOf('Nowhere')).toBeNull();
	});

	it('sets a location only when the place has none, whatever the version', async () => {
		const set = (placeId: string, actor: TestActor) =>
			places().changeLocation(
				treeId,
				{
					kind: 'set_place_location',
					placeId,
					latitude: 1,
					longitude: 2,
					source: 'photon',
					shouldSkipIfLocated: true
				},
				actor.context
			);
		// Left off maps by an earlier test: an ignored location counts as one too.
		const { change } = await set(await idOf('Hobart'), actors.owner);
		expect(change).toBeNull();
		expect(await locationOf('Hobart')).toMatchObject({ status: 'ignored', latitude: null });

		const id = await idOf('Nowhere');
		await expect(set(id, actors.contributor)).rejects.toBeInstanceOf(UnauthorizedError);
		expect(await locationOf('Nowhere')).toBeNull();
		await set(id, actors.owner);
		expect(await locationOf('Nowhere')).toMatchObject({ latitude: 1, source: 'photon' });
		await log().undoLast(treeId, actors.owner.context);
		expect(await locationOf('Nowhere')).toBeNull();
	});

	it('changes a location, bumping its version, and undo restores the earlier one', async () => {
		const id = await idOf('Bare');
		await places().changeLocation(
			treeId,
			{
				kind: 'set_place_location',
				placeId: id,
				latitude: 10,
				longitude: 20,
				source: 'manual',
				expectedVersion: 1
			},
			actors.owner.context
		);
		expect(await locationOf('Bare')).toMatchObject({
			latitude: 10,
			longitude: 20,
			version: 2,
			source: 'manual'
		});
		await log().undoLast(treeId, actors.owner.context);
		expect(await locationOf('Bare')).toMatchObject({
			latitude: 51.5,
			longitude: -0.12,
			// An undo is a write, so the version moves on rather than going back.
			source: 'gedcom'
		});
	});

	it('ignores a place, clears the coordinates, and undoes it', async () => {
		const id = await idOf('Bare');
		await places().changeLocation(
			treeId,
			{ kind: 'ignore_place_location', placeId: id },
			actors.owner.context
		);
		expect(await locationOf('Bare')).toMatchObject({
			status: 'ignored',
			latitude: null,
			longitude: null,
			source: 'manual'
		});
		await log().undoLast(treeId, actors.owner.context);
		expect(await locationOf('Bare')).toMatchObject({ status: 'confirmed', latitude: 51.5 });
	});

	it('clears a location and undoes it', async () => {
		const id = await idOf('Bare');
		await places().changeLocation(
			treeId,
			{ kind: 'clear_place_location', placeId: id },
			actors.owner.context
		);
		expect(await locationOf('Bare')).toBeNull();
		await log().undoLast(treeId, actors.owner.context);
		expect(await locationOf('Bare')).toMatchObject({ latitude: 51.5, source: 'gedcom' });
	});

	it('logs nothing for a change that changes nothing', async () => {
		const id = await idOf('Bare');
		const before = (await t.db.select().from(changeLog).where(eq(changeLog.treeId, treeId))).length;
		await places().changeLocation(
			treeId,
			{
				kind: 'set_place_location',
				placeId: id,
				latitude: 51.5,
				longitude: -0.12,
				source: 'manual'
			},
			actors.owner.context
		);
		// The source differs from the file's, so that one is a real change; undo it, then repeat the ignore.
		await log().undoLast(treeId, actors.owner.context);
		await places().changeLocation(
			treeId,
			{ kind: 'ignore_place_location', placeId: id },
			actors.owner.context
		);
		const afterIgnore = (await t.db.select().from(changeLog).where(eq(changeLog.treeId, treeId)))
			.length;
		await places().changeLocation(
			treeId,
			{ kind: 'ignore_place_location', placeId: id },
			actors.owner.context
		);
		expect((await t.db.select().from(changeLog).where(eq(changeLog.treeId, treeId))).length).toBe(
			afterIgnore
		);
		expect(afterIgnore).toBeGreaterThan(before);
		await log().undoLast(treeId, actors.owner.context);
	});

	it('refuses a stale version with a conflict', async () => {
		const id = await idOf('Bare');
		await expect(
			places().changeLocation(
				treeId,
				{ kind: 'clear_place_location', placeId: id, expectedVersion: 7 },
				actors.owner.context
			)
		).rejects.toBeInstanceOf(ConcurrencyConflictError);
	});

	it('refuses out-of-range and malformed values', async () => {
		const id = await idOf('Nowhere');
		const set = (extra: Record<string, unknown>) =>
			places().changeLocation(
				treeId,
				{
					kind: 'set_place_location',
					placeId: id,
					latitude: 1,
					longitude: 1,
					source: 'manual',
					...extra
				} as never,
				actors.owner.context
			);
		for (const bad of [
			{ latitude: 90.1 },
			{ latitude: Number.NaN },
			{ longitude: -180.1 },
			{ source: 'gedcom' },
			{ osmType: 'node' },
			{ osmType: 'street', osmId: 1 },
			{ osmType: 'node', osmId: 1.5 },
			{ displayName: 'x'.repeat(501) }
		])
			await expect(set(bad), JSON.stringify(bad)).rejects.toBeInstanceOf(ValidationError);
		expect(await locationOf('Nowhere')).toBeNull();
	});

	it('refuses a place that does not exist or has no fact, and names its id and not its text', async () => {
		const missing = await places()
			.changeLocation(
				treeId,
				{ kind: 'clear_place_location', placeId: 'no-such-place' },
				actors.owner.context
			)
			.catch((e) => e);
		expect(missing).toBeInstanceOf(NotFoundError);
		expect(missing.message).toContain('no-such-place');
		const noLocation = await places()
			.changeLocation(
				treeId,
				{ kind: 'clear_place_location', placeId: await idOf('Nowhere') },
				actors.owner.context
			)
			.catch((e) => e);
		expect(noLocation).toBeInstanceOf(NotFoundError);
		expect(noLocation.message).toContain(await idOf('Nowhere'));
		expect(noLocation.message).not.toContain('Nowhere');
	});

	it('needs an editor: a contributor and a viewer are refused, an editor is not', async () => {
		const id = await idOf('Nowhere');
		for (const who of ['contributor', 'viewer'] as const)
			await expect(
				places().changeLocation(
					treeId,
					{ kind: 'set_place_location', placeId: id, latitude: 1, longitude: 1, source: 'manual' },
					actors[who].context
				),
				who
			).rejects.toBeInstanceOf(UnauthorizedError);
		expect(await locationOf('Nowhere')).toBeNull();
		await places().changeLocation(
			treeId,
			{ kind: 'set_place_location', placeId: id, latitude: 1, longitude: 1, source: 'manual' },
			actors.editor.context
		);
		await log().undoLast(treeId, actors.editor.context);
	});
});

describe.each(['viewer', 'contributor'] as const)('for a %s', (role) => {
	it('carries the location of a place they may see, on the list and on the page', async () => {
		const list = await places().list(treeId, { q: 'Cork', limit: 100 }, actors[role].context);
		expect(list.items[0]!.location).toMatchObject({ latitude: 1, longitude: 2 });
		const page = await places().detail(treeId, 'Cork', {}, actors[role].context);
		expect(page.location).toMatchObject({ latitude: 1, longitude: 2, source: 'manual' });
	});

	it('learns nothing of the location of a place only a private person gives', async () => {
		const list = await places().list(treeId, { limit: 100 }, actors[role].context);
		expect(JSON.stringify(list)).not.toMatch(/Perthville|31\.95|115\.86/);
		await expect(
			places().detail(treeId, 'Perthville', {}, actors[role].context)
		).rejects.toBeInstanceOf(NotFoundError);
		// The owner sees both.
		expect(await locationOf('Perthville')).toMatchObject({ latitude: -31.95, longitude: 115.86 });
	});
});
