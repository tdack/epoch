/**
 * Row operations for renaming or merging a place (ADR-019).
 *
 * A place is the text its facts carry, so changing a place is rewriting that text on every fact
 * that has it; the record follows from the text (the change store points each written fact at the
 * record for its new text). That is why a merge needs no op of its own: facts that take the text of
 * another place land on its record, the emptied record stays (so an undo, which restores the old
 * text, finds it again with the same id), and one undo reverts the whole change.
 */

import type { EventRow, RowOp, TreeRows } from './change-log';
import { NotFoundError, ValidationError } from './errors';
import { MAX_PLACE_REWRITE_FACTS, placeKey } from '../../shared/places';

export type PlaceCommand = {
	kind: 'rewrite_place';
	/** The record of the place to change; what a refusal names, so it never echoes the text of a place the caller may not see. */
	placeId: string;
	/** The place to change, as the key its record is found by (`placeKey`). */
	fromKey: string;
	/** The text every fact at that place will carry. */
	to: string;
};

interface PlaceContext {
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
}

/** Vitals are on the person form too, so changing one must make a stale form conflict (as `update_fact` does). */
const VITAL_TYPES = new Set(['BIRT', 'DEAT']);

/** The facts of the tree whose place is this one, in the order the tree stores them. */
export function factsAtPlace(rows: TreeRows, key: string): EventRow[] {
	return rows.events.filter((e) => e.place !== null && placeKey(e.place) === key);
}

export function buildPlaceOps(rows: TreeRows, command: PlaceCommand, ctx: PlaceContext): RowOp[] {
	const to = command.to.trim();
	if (to === '') throw new ValidationError('A place needs a name');
	const facts = factsAtPlace(rows, command.fromKey);
	if (facts.length === 0) throw new NotFoundError('Place', command.placeId);
	// One change is one atomic batch and one log row (see the limit's comment), so a place too big for
	// one is refused rather than half done.
	if (facts.length > MAX_PLACE_REWRITE_FACTS) {
		throw new ValidationError(
			`This place is on ${facts.length} facts; renaming or merging works on at most ${MAX_PLACE_REWRITE_FACTS} at a time`
		);
	}

	const ops: RowOp[] = [];
	const bumped = new Set<string>();
	for (const fact of facts) {
		if (fact.place === to) continue;
		ops.push({
			table: 'events',
			id: fact.id,
			before: fact,
			after: { ...fact, place: to, version: fact.version + 1, updatedAt: ctx.now }
		});
		const person =
			fact.entityType === 'INDIVIDUAL' && VITAL_TYPES.has(fact.type)
				? rows.individuals.find((p) => p.id === fact.entityId)
				: undefined;
		if (person && !bumped.has(person.id)) {
			bumped.add(person.id);
			ops.push({
				table: 'individuals',
				id: person.id,
				before: person,
				after: { ...person, version: person.version + 1, updatedAt: ctx.now }
			});
		}
	}
	return ops;
}
