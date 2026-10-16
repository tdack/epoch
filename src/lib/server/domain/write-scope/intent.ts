import type { PersonRef, RelationshipIntent } from '../relationship-sentence';
import { seedOf, type ScopeSeed } from '../write-scope';

/** The id of a person who already exists; a person the intent creates has a placeholder id. */
function existing(ref: PersonRef): string[] {
	return ref.isNew ? [] : [ref.id];
}

/**
 * The records a relationship intent reads, or null when they cannot be named from the intent
 * (ADR-055). It covers the intent planner and the commands it expands into, so one snapshot serves
 * both and `execute` writes over the rows it planned over.
 *
 * A new person needs no seed: the planner never reads the row of someone it creates, and the id
 * comes from `clock.newId` (a UUID), so it cannot clash with a row that exists. The per-command
 * `create_person` seed names its id only because a command's id can come from a client.
 *
 * Null (whole tree), on purpose:
 * - `add_parent`: the parental family it joins is picked from the child's links, so the intent
 *   cannot name it, and its sentence counts the other partnerships of that pair. Those are
 *   partnerships of two people who may be neither the child nor the new parent, so no closure of
 *   the people the intent names brings them. `intent.test.ts` pins the mismatch.
 */
export function intentSeed(intent: RelationshipIntent): ScopeSeed | null {
	switch (intent.kind) {
		case 'add_parent':
			return null;
		// The cycle check walks every link, as `assert_parent_child` does. The partnership is one of
		// the parent's own, so its other partnerships of the same pair (which the label counts) share
		// the parent and come with them.
		case 'add_child':
			return seedOf({
				people: [...existing(intent.parent), ...existing(intent.child)],
				unions: [intent.unionId],
				wholeTables: ['parentChild']
			});
		// The sibling is filed under the person's own parents, named by `parentIds`; the planner
		// refuses any other id, and that refusal reads the person's links, which are whole.
		case 'add_sibling':
			return seedOf({
				people: [...existing(intent.person), ...existing(intent.sibling), ...intent.parentIds],
				wholeTables: ['parentChild']
			});
		// The partnership it fills or twins is one of the person's own.
		case 'add_partner':
			return seedOf({
				people: [...existing(intent.person), ...existing(intent.partner)],
				unions: [intent.unionId]
			});
		case 'change_link_type':
			return seedOf({
				people: [...existing(intent.parent), ...existing(intent.child)]
			});
		case 'record_death':
			return seedOf({ people: existing(intent.person) });
		// A person brings every partnership they are in, and each partnership's partners and its
		// twins (the same pair's other partnerships share the person), which the labeller counts.
		// The bare `end_union` command cannot be scoped because it names only the partnership.
		case 'end_union':
			return seedOf({ people: existing(intent.person), unions: [intent.unionId] });
	}
}
