/**
 * The detail structures under an event (its `ADDR`, `TYPE`, `AGNC`, `RELI`, contacts and the
 * `PLAC` coordinates and sub-lines) that the model has columns for. The parser and the backfill
 * read them with this one function, so a tree imported today and one backfilled later hold the
 * same values for the same file.
 */

import { fieldLayout, logicalText } from './evidence-lines';
import { collectLines, type GedcomNode } from './node';

/** The model's columns for an event's details, as the parser reads them. */
export interface FactDetails {
	address?: string;
	/** The file's own ADDR lines, kept only while they still say `address`; see `fieldLayout`. */
	addressLayout?: string[];
	/** `TYPE`: the sub-type of an `EVEN` or `FACT`. */
	classification?: string;
	agency?: string;
	/** Every `PHON` value, one per line. */
	phone?: string;
	email?: string;
	fax?: string;
	web?: string;
	/** `MAP > LATI` and `LONG`, exactly as the file wrote them. */
	latitude?: string;
	longitude?: string;
	/** The `PLAC` sub-lines other than `MAP`, verbatim with their levels, in file order. */
	placeExtra?: string[];
	/** Sub-lines of `DATE` (a `TIME`), `CAUS` (a `CONT`) and `AGE` (a `PHRASE`), verbatim from level 3. */
	dateExtra?: string[];
	causeExtra?: string[];
	ageExtra?: string[];
	religion?: string;
}

export interface FactDetailExtraction {
	details: FactDetails;
	/**
	 * The event's children this read takes over, which therefore leave its extra lines. A child
	 * that is not returned (a second `TYPE`, a `PHON` with children) stays there, whole.
	 */
	consumed: Set<GedcomNode>;
}

/** A node with one value and nothing under it: the only shape a column can write back. */
const isPlainValue = (node: GedcomNode) =>
	node.children.length === 0 && (node.value ?? '').trim() !== '';

/**
 * `MAP` holds exactly one `LATI` and one `LONG`, each with a value and nothing under it. Anything
 * else (a second MAP, an extra child, a value on the MAP itself) is kept verbatim: the model could
 * not write it back exactly.
 */
function isCoordinatePair(map: GedcomNode): boolean {
	if ((map.value ?? '').trim() !== '' || map.children.length !== 2) return false;
	const lati = map.children.filter((c) => c.tag === 'LATI');
	const long = map.children.filter((c) => c.tag === 'LONG');
	return lati.length === 1 && long.length === 1 && isPlainValue(lati[0]) && isPlainValue(long[0]);
}

/**
 * The details of one event, read from its children.
 *
 * A `PLAC` with no text but with sub-lines is not taken: its sub-lines would have no place to go,
 * since the serializer writes them only under a place. A `PLAC` with no text and no sub-lines is
 * taken and dropped, as it always was, because it carries nothing.
 */
export function extractFactDetails(children: readonly GedcomNode[]): FactDetailExtraction {
	const details: FactDetails = {};
	const consumed = new Set<GedcomNode>();

	// The first ADDR with text is the address. An ADDR with no text stays whole, since its structured
	// children (CITY, POST) would otherwise be lost.
	const address = children.find((c) => c.tag === 'ADDR' && logicalText(c) !== '');
	if (address) {
		details.address = logicalText(address);
		const layout = fieldLayout(address, true);
		if (layout) details.addressLayout = layout;
		consumed.add(address);
	}

	// Only the first plain value of each is a column; a repeat is a second fact detail the model
	// cannot hold, so it stays in the extra lines.
	const single = (tag: 'TYPE' | 'AGNC' | 'RELI') => {
		const node = children.find((c) => c.tag === tag && isPlainValue(c));
		if (!node) return undefined;
		consumed.add(node);
		return node.value!.trim();
	};
	const classification = single('TYPE');
	if (classification) details.classification = classification;
	const agency = single('AGNC');
	if (agency) details.agency = agency;
	const religion = single('RELI');
	if (religion) details.religion = religion;

	// Contacts may repeat (the spec allows three of each), so every plain one is kept, in file order.
	const contacts = (tag: 'PHON' | 'EMAIL' | 'FAX' | 'WWW') => {
		const nodes = children.filter((c) => c.tag === tag && isPlainValue(c));
		if (nodes.length === 0) return undefined;
		for (const node of nodes) consumed.add(node);
		return nodes.map((node) => node.value!.trim()).join('\n');
	};
	const phone = contacts('PHON');
	if (phone) details.phone = phone;
	const email = contacts('EMAIL');
	if (email) details.email = email;
	const fax = contacts('FAX');
	if (fax) details.fax = fax;
	const web = contacts('WWW');
	if (web) details.web = web;

	const place = children.find((c) => c.tag === 'PLAC');
	if (place && ((place.value ?? '').trim() !== '' || place.children.length === 0)) {
		consumed.add(place);
		// Only the first MAP is read. If it is malformed the others are no more readable, so every
		// MAP stays in placeExtra with the other sub-lines.
		const map = place.children.find((c) => c.tag === 'MAP');
		const coordinates = map && isCoordinatePair(map) ? map : undefined;
		if (coordinates) {
			details.latitude = coordinates.children.find((c) => c.tag === 'LATI')!.value!.trim();
			details.longitude = coordinates.children.find((c) => c.tag === 'LONG')!.value!.trim();
		}
		const others = place.children.filter((c) => c !== coordinates).flatMap(collectLines);
		if (others.length > 0) details.placeExtra = others;
	}

	return { details, consumed };
}

/**
 * The columns a fact's details are written to. An absent detail is null, as every column is on a
 * row an import did not give one, so a fact without it reads the same either way.
 */
export function factDetailColumns(details: FactDetails) {
	const text = (value: string | undefined) => value || null;
	const lines = (value: string[] | undefined) => (value && value.length > 0 ? value : null);
	return {
		address: text(details.address),
		addressLayout: lines(details.addressLayout),
		classification: text(details.classification),
		agency: text(details.agency),
		phone: text(details.phone),
		email: text(details.email),
		fax: text(details.fax),
		web: text(details.web),
		latitude: text(details.latitude),
		longitude: text(details.longitude),
		placeExtra: lines(details.placeExtra),
		dateExtra: lines(details.dateExtra),
		causeExtra: lines(details.causeExtra),
		ageExtra: lines(details.ageExtra),
		religion: text(details.religion)
	};
}
