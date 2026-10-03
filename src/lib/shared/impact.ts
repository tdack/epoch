/**
 * What a change did and what a preview says it will do, in terms a person can read. The server
 * writes these into the change log and its impact previews; the dialogs and the history read them.
 */

/** The name a table's rows go by in the log and in previews. */
export type EntityType = 'person' | 'name' | 'union' | 'partner' | 'link' | 'event' | 'media';

export const RECORD_ACTIONS = {
	CREATED: 'created',
	UPDATED: 'updated',
	DELETED: 'deleted'
} as const;
export type RecordAction = (typeof RECORD_ACTIONS)[keyof typeof RECORD_ACTIONS];

export interface FieldChange {
	field: string;
	before: unknown;
	after: unknown;
}

/** One record's change, in terms a person can read: the summary stored in `change_log.changes_json`. */
export interface RecordChange {
	entityType: EntityType;
	entityId: string;
	label: string;
	action: RecordAction;
	/** Only for updates: the fields whose value differs. */
	fields: FieldChange[];
}

export const PERSON_ROLES_IN_IMPACT = {
	DELETED: 'deleted',
	CREATED: 'created',
	AFFECTED: 'affected'
} as const;

export type ImpactPersonRole = (typeof PERSON_ROLES_IN_IMPACT)[keyof typeof PERSON_ROLES_IN_IMPACT];

interface ImpactPerson {
	id: string;
	name: string;
	role: ImpactPersonRole;
}

/** A record that stays and is regrouped under another partnership: shown as a move, not an edit. */
export interface ImpactMove {
	entityType: 'link' | 'event';
	entityId: string;
	label: string;
	from: string;
	to: string;
}

export interface ImpactSummary {
	/** One line: what is being done. */
	headline: string;
	/** Every record written, in the order a person would read them. */
	records: RecordChange[];
	/** Links and events that change partnership, so a merge reads "moved from X to Y". */
	moves: ImpactMove[];
	/** People deleted or created by the change, and people whose relationships or events change. */
	people: ImpactPerson[];
	/** True when the change deletes any record. */
	isDestructive: boolean;
}
