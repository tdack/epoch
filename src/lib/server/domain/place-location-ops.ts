/**
 * Row operations for where a place is (ADR-078): set, ignore and clear a place record's location.
 *
 * The row is keyed by the place record's id, so an op's `id` is the id a refusal names. A refusal
 * never carries the place's text (ADR-019): the caller may not be allowed to see it.
 */

import type { PlaceLocationRow, RowOp, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { factsAtPlace } from './place-ops';
import { COMMAND_LOCATION_SOURCES, OSM_TYPES } from '../../shared/places';

const MAX_DISPLAY_NAME_LENGTH = 500;

export type PlaceLocationCommand =
	| {
			kind: 'set_place_location';
			placeId: string;
			/** The place's key (`placeKey`), resolved by the service from the record, to find its facts. */
			placeKey: string;
			latitude: number;
			longitude: number;
			source: (typeof COMMAND_LOCATION_SOURCES)[number];
			osmType?: (typeof OSM_TYPES)[number] | null;
			osmId?: number | null;
			displayName?: string | null;
			expectedVersion?: number;
	  }
	| { kind: 'ignore_place_location'; placeId: string; placeKey: string; expectedVersion?: number }
	| { kind: 'clear_place_location'; placeId: string; expectedVersion?: number };

interface PlaceLocationContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
}

function checkVersion(location: PlaceLocationRow, expected: number | undefined): void {
	if (expected === undefined || location.version === expected) return;
	throw new ConcurrencyConflictError(
		`This place's location was changed by someone else (you had version ${expected}, it is now ${location.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'place_location',
			id: location.id,
			expectedVersion: expected,
			currentVersion: location.version,
			current: {
				latitude: location.latitude,
				longitude: location.longitude,
				status: location.status,
				source: location.source
			}
		}
	);
}

/** A place with no fact is a record nobody can see or name, so it takes no location. */
function requirePlaceWithFacts(rows: TreeRows, placeId: string, placeKey: string): void {
	if (factsAtPlace(rows, placeKey).length === 0) throw new NotFoundError('Place', placeId);
}

function validate(command: Extract<PlaceLocationCommand, { kind: 'set_place_location' }>): void {
	const { latitude, longitude, osmType, osmId, displayName } = command;
	if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
		throw new ValidationError('A latitude is between -90 and 90 degrees.');
	if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
		throw new ValidationError('A longitude is between -180 and 180 degrees.');
	if (!COMMAND_LOCATION_SOURCES.includes(command.source))
		throw new ValidationError('A location is set by a place search or by hand.');
	const hasOsmType = osmType != null;
	const hasOsmId = osmId != null;
	if (hasOsmType !== hasOsmId)
		throw new ValidationError('An OpenStreetMap reference needs both a type and an id.');
	if (hasOsmType && !OSM_TYPES.includes(osmType))
		throw new ValidationError('An OpenStreetMap type is node, way or relation.');
	if (hasOsmId && !(Number.isSafeInteger(osmId) && osmId > 0))
		throw new ValidationError('An OpenStreetMap id is a positive whole number.');
	if (displayName != null && displayName.length > MAX_DISPLAY_NAME_LENGTH)
		throw new ValidationError(`A location name is at most ${MAX_DISPLAY_NAME_LENGTH} characters.`);
}

/** The op that makes `next` the location of the place, a create when there is none yet. */
function writeOp(
	before: PlaceLocationRow | undefined,
	next: Omit<PlaceLocationRow, 'id' | 'treeId' | 'version' | 'createdAt' | 'updatedAt'>,
	placeId: string,
	ctx: PlaceLocationContext
): RowOp[] {
	if (!before) {
		const after: PlaceLocationRow = {
			id: placeId,
			treeId: ctx.treeId,
			...next,
			version: 1,
			createdAt: ctx.now,
			updatedAt: ctx.now
		};
		return [{ table: 'place_locations', id: placeId, before: null, after }];
	}
	const changed = { ...before, ...next };
	if (JSON.stringify(changed) === JSON.stringify(before)) return [];
	return [
		{
			table: 'place_locations',
			id: placeId,
			before,
			after: { ...changed, version: before.version + 1, updatedAt: ctx.now }
		}
	];
}

export function buildPlaceLocationOps(
	rows: TreeRows,
	command: PlaceLocationCommand,
	ctx: PlaceLocationContext
): RowOp[] {
	const before = rows.placeLocations.find((l) => l.id === command.placeId);
	if (before) checkVersion(before, command.expectedVersion);
	switch (command.kind) {
		case 'set_place_location': {
			requirePlaceWithFacts(rows, command.placeId, command.placeKey);
			validate(command);
			return writeOp(
				before,
				{
					latitude: command.latitude,
					longitude: command.longitude,
					status: 'confirmed',
					source: command.source,
					osmType: command.osmType ?? null,
					osmId: command.osmId ?? null,
					displayName: command.displayName?.trim() || null
				},
				command.placeId,
				ctx
			);
		}
		case 'ignore_place_location': {
			requirePlaceWithFacts(rows, command.placeId, command.placeKey);
			return writeOp(
				before,
				{
					latitude: null,
					longitude: null,
					status: 'ignored',
					source: 'manual',
					osmType: null,
					osmId: null,
					displayName: null
				},
				command.placeId,
				ctx
			);
		}
		case 'clear_place_location': {
			if (!before) throw new NotFoundError('Place location', command.placeId);
			return [{ table: 'place_locations', id: before.id, before, after: null }];
		}
	}
}
