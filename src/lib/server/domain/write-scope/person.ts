import { seedOf } from '../write-scope';
import type { ScopeTable } from './types';

/*
 * Seeds for commands about people, their names, facts and files (ADR-055). Each names the records
 * the planner reads by id; the closure brings the person's names and events, partnerships, partners,
 * links and attached evidence, which is everything the cascades and the privacy mask look at.
 *
 * A command that names several ids seeds all of them, including ones that may belong to someone
 * else: the planner refuses those with a specific error, and that error must come from the same rows.
 */

export const FACT_SCOPES: ScopeTable = {
	create_fact: (c) => seedOf({ people: [c.personId], events: [c.factId] }),
	update_fact: (c) => seedOf({ events: [c.factId] }),
	delete_fact: (c) => seedOf({ events: [c.factId] }),
	reorder_facts: (c) => seedOf({ people: [c.personId], events: c.orderedFactIds })
};

/** A name linked to a partnership needs that partnership's partner rows to check the link. */
export const NAME_SCOPES: ScopeTable = {
	create_name: (c) => seedOf({ people: [c.personId], names: [c.nameId], unions: [c.name.unionId] }),
	update_name: (c) => seedOf({ names: [c.nameId], unions: [c.name.unionId] }),
	delete_name: (c) => seedOf({ names: [c.nameId] }),
	reorder_names: (c) => seedOf({ people: [c.personId], names: c.orderedNameIds }),
	set_preferred_name: (c) => seedOf({ people: [c.personId], names: [c.nameId] })
};

/**
 * `create_person` reads nothing, but its id is seeded so a clash with an existing row is seen.
 *
 * `delete_person` reads the person's names, links, facts, files and partnerships, then each
 * partnership's other partners, facts and files and the links filed under it; the closure of a
 * loaded person brings all of those, and the evidence hanging off them.
 */
export const PERSON_COMMAND_SCOPES: ScopeTable = {
	create_person: (c) => seedOf({ people: [c.personId] }),
	delete_person: (c) => seedOf({ people: [c.personId] }),
	update_person: (c) => seedOf({ people: [c.personId] }),
	set_person_privacy: (c) => seedOf({ people: [c.personId] }),
	record_death: (c) => seedOf({ people: [c.personId] })
};

/**
 * A file brings its links; the target of a link is a person, a union or a source. A seeded record
 * also brings the links to it, which is how a delete or merge finds the ones to remove or move.
 */
export const MEDIA_SCOPES: ScopeTable = {
	rename_media: (c) => seedOf({ media: [c.mediaId] }),
	unlink_media: (c) => seedOf({ media: [c.mediaId] }),
	link_media: (c) =>
		seedOf({
			media: [c.mediaId],
			people: [c.entityId],
			unions: [c.entityId],
			sources: [c.entityId]
		})
};

/** Seeds for commands about people, their names and facts. */
export const PERSON_SCOPES: ScopeTable = {
	...FACT_SCOPES,
	...NAME_SCOPES,
	...PERSON_COMMAND_SCOPES,
	...MEDIA_SCOPES
};
