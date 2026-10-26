/**
 * The facts a person can carry in the editor: GEDCOM's individual events and attributes. The list
 * is exactly the tags the importer reads as facts (`INDIVIDUAL_EVENT_TAGS`); anything else it
 * preserves as raw lines, so offering more here would create facts export cannot place.
 *
 * Browser-safe: the editor's type picker, the person page and the server's validation share it.
 */

export const FACT_KINDS = { EVENT: 'event', ATTRIBUTE: 'attribute' } as const;
export type FactKind = (typeof FACT_KINDS)[keyof typeof FACT_KINDS];

export interface FactTypeInfo {
	/** The GEDCOM tag, stored as the event's `type`. */
	code: string;
	label: string;
	/** Events happen (and have dates); attributes are something a person has (and carry a value). */
	kind: FactKind;
	/** A person has at most one of these, so a second one with different details is flagged. */
	isSingular: boolean;
}

const event = (code: string, label: string, isSingular = false): FactTypeInfo => ({
	code,
	label,
	kind: FACT_KINDS.EVENT,
	isSingular
});
const attribute = (code: string, label: string, isSingular = false): FactTypeInfo => ({
	code,
	label,
	kind: FACT_KINDS.ATTRIBUTE,
	isSingular
});

export const FACT_TYPE_LIST: readonly FactTypeInfo[] = [
	event('BIRT', 'Birth', true),
	event('CHR', 'Christening', true),
	event('BAPM', 'Baptism', true),
	event('DEAT', 'Death', true),
	event('BURI', 'Burial', true),
	event('CREM', 'Cremation', true),
	event('ADOP', 'Adoption'),
	event('BARM', 'Bar mitzvah'),
	event('BASM', 'Bat mitzvah'),
	event('BLES', 'Blessing'),
	event('CHRA', 'Adult christening'),
	event('CONF', 'Confirmation'),
	event('FCOM', 'First communion'),
	event('ORDN', 'Ordination'),
	event('NATU', 'Naturalisation'),
	event('EMIG', 'Emigration'),
	event('IMMI', 'Immigration'),
	event('CENS', 'Census'),
	event('PROB', 'Probate'),
	event('WILL', 'Will'),
	event('GRAD', 'Graduation'),
	event('RETI', 'Retirement'),
	// Not a GEDCOM tag, but the one other programs (Legacy, Family Tree Maker) write.
	event('_MILT', 'Military service'),
	event('EVEN', 'Other event'),
	attribute('OCCU', 'Occupation'),
	attribute('RESI', 'Residence'),
	attribute('EDUC', 'Education'),
	attribute('RELI', 'Religion'),
	attribute('TITL', 'Title'),
	attribute('NATI', 'Nationality'),
	attribute('CAST', 'Caste'),
	attribute('PROP', 'Property'),
	attribute('DSCR', 'Physical description'),
	attribute('IDNO', 'Identification number', true),
	attribute('SSN', 'Social security number', true),
	attribute('NCHI', 'Number of children'),
	attribute('NMR', 'Number of marriages'),
	attribute('FACT', 'Other fact')
];

const BY_CODE = new Map(FACT_TYPE_LIST.map((info) => [info.code, info]));

export function isFactType(code: string): boolean {
	return BY_CODE.has(code);
}

export function factTypeInfo(code: string): FactTypeInfo | null {
	return BY_CODE.get(code) ?? null;
}

/** The label for a tag, or the tag itself for one this list does not know. */
export function factLabel(code: string): string {
	return BY_CODE.get(code)?.label ?? code;
}

/** What a fact form sends. `type` is a GEDCOM tag from {@link FACT_TYPE_LIST}. */
export interface FactInput {
	type: string;
	/** The date as typed; kept verbatim, with the structured columns derived from it. */
	dateText: string | null;
	/** A place as text. A place record (`place_ref`) is a later slice. */
	place: string | null;
	/** The text on the event's own line: `Carpenter` in `1 OCCU Carpenter`. */
	value: string | null;
	cause: string | null;
	/** As GEDCOM writes it: `79y`, `2y 3m`, `CHILD`. */
	age: string | null;
	notes: string | null;
	/*
	 * Imported details. Optional so a form that predates them still type-checks; an absent field is
	 * left as stored. The editor passes them through so a save never erases what an import brought.
	 * The stored `place_extra` and `address_layout` are deliberately absent: they are not editable,
	 * and the server's schema strips them from a request so a client cannot forge or clear them.
	 */
	/** The address as one logical text; line breaks are CONT lines in GEDCOM. */
	address?: string | null;
	/** `TYPE`: the sub-type of an event or fact, e.g. `Baptism at home`. */
	classification?: string | null;
	/** `AGNC`: the agency that carried out the event. */
	agency?: string | null;
	/** `PHON`, `EMAIL`, `FAX`, `WWW`: one value per line when a fact has several. */
	phone?: string | null;
	email?: string | null;
	fax?: string | null;
	web?: string | null;
	/** `MAP` > `LATI`/`LONG` as written, e.g. `N18.150944`. Only written with a place. */
	latitude?: string | null;
	longitude?: string | null;
	/** `RELI`: the religion an event or attribute refers to. */
	religion?: string | null;
}

/**
 * Most people one group fact or bulk citation may name. One change writes a row (and its log
 * record) per person, and D1 allows 1,000 queries an invocation, so a larger group is refused.
 */
export const MAX_GROUP_FACT_PEOPLE = 50;

/** Someone a new fact can also be added to, with how they relate, for the "Also add to…" list. */
export interface FactRelative {
	id: string;
	name: string;
	relation: string;
}
