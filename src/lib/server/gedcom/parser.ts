import { parseDateValue } from '../../shared/date-value';
import type { Sex } from '../../shared/sex';
import { NAME_TYPES, type NameType } from '../domain/genealogy-model';
import {
	FAMILY_ALIAS_REFN_TYPE,
	PARENT_PEDIGREE_TAG,
	PRIVACY_PUBLIC_TAG,
	LEGACY_MARRIED_NAME_TAG,
	NAME_CHANGE_NOTE,
	SEX_X_TAG
} from './tags';
import { fromGedcom7Date } from './date-dialect';
import { buildGedcomTree, collectLines, type GedcomNode } from './node';
import { LINE_BREAK, normalizedNodeText } from './evidence-lines';
import {
	mergeCitations,
	parseCitation,
	parseRepositoryRecord,
	parseSourceRecord,
	type ParsedCitation,
	type ParsedRepository,
	type ParsedSource
} from './evidence-parse';

import {
	isNoteNode,
	mergeNoteLinks,
	parseNoteLink,
	parseNoteRecord,
	splitNotes,
	type ParsedNoteLink,
	type ParsedSharedNote
} from './note-parse';

export type { ParsedCitation } from './evidence-parse';
export { mergeCitations, mergeNoteLinks };

/** The dialects an import reads. 5.5 is read as 5.5.1, of which it is very nearly a subset. */
export type GedcomVersion = '5.5' | '5.5.1' | '7.0';

/**
 * A child's relationship to the parents of a family (`PEDI`). `sealing` and `other` have no
 * neutral parent-child type of their own; they are kept so export can write them back.
 */
type Pedigree = 'birth' | 'adopted' | 'foster' | 'sealing' | 'other';

/** A child's `FAMC` link with the pedigree it carries; `parentPedigrees` is Epoch's per-parent extension. */
interface ParsedFamcLink {
	familyId: string;
	pedigree?: Pedigree;
	/** Parent XREF to the pedigree that differs from `pedigree`, from `_PEDI_PARENT`. */
	parentPedigrees?: Record<string, Pedigree>;
	/** The `SOUR` citations under this `FAMC`. */
	citations: ParsedCitation[];
	/** The notes under this `FAMC`. */
	notes: ParsedNoteLink[];
}

/** `RESN` words that mean "keep this person from viewers": they become the private override. */
const RESTRICTING_RESN_WORDS = new Set(['privacy', 'confidential']);

/** One `NAME` record of an individual, in file order. The first is the primary name. */
interface ParsedName {
	type: NameType;
	/** The word of a free-text 5.5.1 TYPE (or a 7.0 PHRASE) under `other`; `_MARNM` for the legacy tag. */
	gedcomType?: string;
	givenName?: string;
	surname?: string;
	prefix?: string;
	suffix?: string;
	nickname?: string;
	surnamePrefix?: string;
	/** From an Epoch name-change `NOTE` (ADR-013): when the name came into use. */
	dateText?: string;
	/** From the same note: the family it came from, as the file's XREF. */
	unionXref?: string;
	/** That note's own line, kept so a family the file does not have leaves the note in place. */
	changeNoteLine?: string;
	/** Sub-structures with no column (NOTE, SOUR, FONE, ROMN, custom tags), verbatim, written back inside this NAME. */
	extra: string[];
	/** The `SOUR` citations under this `NAME`, in file order. */
	citations: ParsedCitation[];
	/** The notes under this `NAME`, in file order; Epoch's own name-change note is not one. */
	notes: ParsedNoteLink[];
}

interface ParsedIndividual {
	id: string; // e.g. @I1@ or I1
	/** The primary (first) name's given name and surname, kept for callers that want one name. */
	givenName?: string;
	surname?: string;
	names?: ParsedName[];
	sex?: Sex;
	/** From `RESN privacy` or `confidential` (private) or `_EPOCH_PRIVACY public`; absent means derive it. */
	privacy?: 'private' | 'public';
	famc?: string[]; // Family where person is child
	famcLinks?: ParsedFamcLink[];
	fams?: string[]; // Family where person is spouse
	events: ParsedEvent[];
	/** The `SOUR` citations on the person themself, in file order. */
	citations: ParsedCitation[];
	/** The notes on the person themself, in file order. */
	notes: ParsedNoteLink[];
}

export interface ParsedFamily {
	id: string; // e.g. @F1@ or F1
	husbandId?: string;
	wifeId?: string;
	children: {
		childId: string;
		pedigree?: Pedigree;
		parentPedigrees?: Record<string, Pedigree>;
		/** The citations under the child's own `FAMC` for this family. */
		citations?: ParsedCitation[];
		/** The notes under the child's own `FAMC` for this family. */
		notes?: ParsedNoteLink[];
	}[];
	events: ParsedEvent[];
	/** The `SOUR` citations on the family record. */
	citations: ParsedCitation[];
	/** The notes on the family record. */
	notes: ParsedNoteLink[];
	/** XREFs of families merged into this one, from `REFN` records typed `epoch-merged-family`. */
	aliases?: string[];
}

export interface ParsedEvent {
	id?: string;
	type: string;
	dateRaw?: string;
	dateSort?: string;
	dateSortEnd?: string | null;
	place?: string;
	/** Pre-fact-field text (CAUS, NOTE or line value in one). Family events still use it. */
	description?: string;
	/** Individual events only: the text on the event's own line (`1 OCCU Carpenter`). */
	value?: string;
	/** `2 CAUS` */
	cause?: string;
	/** `2 AGE` */
	age?: string;
	/** `2 NOTE`, read the way a tree imported before ADR-029 holds it: the first plain note's text. */
	notes?: string;
	/** The notes under the event, in file order, when notes are read into records. */
	noteLinks?: ParsedNoteLink[];
	/** Every other line under the event, verbatim and in order (`gedcomExtra`). */
	extra?: string[];
	/** The `SOUR` citations under the event, in file order. */
	citations?: ParsedCitation[];
}

export interface ParsedGedcomData {
	version: GedcomVersion;
	individuals: ParsedIndividual[];
	families: ParsedFamily[];
	treeName?: string;
	/**
	 * Raw lines of structures the parser does not yet model, preserved verbatim
	 * so they survive export. `xref` is the owning record's XREF (or null for
	 * tree/header-level records).
	 */
	preserved: Array<{ xref: string | null; lines: string[] }>;
	/** Root `SOUR` records (ADR-028). Empty when the file is read with `isEvidenceModelled` off. */
	sources: ParsedSource[];
	/** Root `REPO` records. */
	repositories: ParsedRepository[];
	/** Root `NOTE`/`SNOTE` records (ADR-029). Empty when the file is read with `isNotesModelled` off. */
	notes: ParsedSharedNote[];
}

export interface ParseOptions {
	/**
	 * Read sources, repositories and citations into records. Off keeps them as retained lines, as
	 * a tree imported before ADR-028 holds them; only the backfill's tests need that.
	 */
	isEvidenceModelled?: boolean;
	/**
	 * Read shared notes and the notes under structures into records (ADR-029). Off keeps them as
	 * retained lines, and a fact's first plain note in its own text, as a tree imported before
	 * this change holds them; only the backfill's tests need that.
	 */
	isNotesModelled?: boolean;
}

/** Individual-level event tags shared by GEDCOM 5.5.1 and 7.0. */
const INDIVIDUAL_EVENT_TAGS = new Set([
	'BIRT',
	'CHR',
	'DEAT',
	'BURI',
	'CREM',
	'ADOP',
	'BAPM',
	'BARM',
	'BASM',
	'BLES',
	'CHRA',
	'CONF',
	'FCOM',
	'ORDN',
	'NATU',
	'EMIG',
	'IMMI',
	'CENS',
	'PROB',
	'WILL',
	'GRAD',
	'RETI',
	'EVEN',
	'DSCR',
	'EDUC',
	'IDNO',
	'NCHI',
	'NMR',
	'OCCU',
	'PROP',
	'RELI',
	'RESI',
	'SSN',
	'TITL',
	'FACT'
]);

/** Family-level event tags shared by GEDCOM 5.5.1 and 7.0. */
const FAMILY_EVENT_TAGS = new Set([
	'MARR',
	'DIV',
	'ANUL',
	'CENS',
	'ENGA',
	'MARB',
	'MARC',
	'MARL',
	'MARS',
	'DIVF',
	'_PSTART',
	'_SEPR',
	'EVEN'
]);

/**
 * Split a GEDCOM `NAME` value ("Given /Surname/ Suffix") into parts. A lazy-prefix regex here
 * once matched an empty prefix and left the slashes inside the given name whenever the record
 * had no GIVN/SURN children.
 */
export function parseGedcomNameValue(value: string): { givenName?: string; surname?: string } {
	const open = value.indexOf('/');
	const close = open === -1 ? -1 : value.indexOf('/', open + 1);
	if (open === -1 || close === -1) {
		// No complete surname delimiters; drop a stray slash rather than keep it in the name.
		return { givenName: value.replace(/\//g, ' ').replace(/\s+/g, ' ').trim() || undefined };
	}
	const before = value.slice(0, open);
	const after = value.slice(close + 1);
	const given = `${before} ${after}`.replace(/\s+/g, ' ').trim();
	return {
		givenName: given || undefined,
		surname: value.slice(open + 1, close).trim() || undefined
	};
}

/**
 * Detect the GEDCOM version from the `GEDC.VERS` value in the header.
 * Defaults to 5.5.1 when the version cannot be determined.
 */
export function detectGedcomVersion(rawContent: string): GedcomVersion {
	const lines = rawContent.split(LINE_BREAK);
	let isInGedc = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^1\s+GEDC$/.test(trimmed)) {
			isInGedc = true;
			continue;
		}
		if (isInGedc) {
			const vers = trimmed.match(/^2\s+VERS\s+(.+)$/);
			if (vers) {
				const version = vers[1].trim();
				if (version.startsWith('7')) return '7.0';
				return version === '5.5' ? '5.5' : '5.5.1';
			}
			if (/^\d+\s+\S/.test(trimmed)) break;
		}
	}
	return '5.5.1';
}

/** `PEDI` payloads are lowercase in 5.5.1 and uppercase in 7.0; anything else is `other`. */
function parsePedigree(value: string | undefined): Pedigree | undefined {
	const text = value?.trim().toLowerCase();
	if (!text) return undefined;
	return text === 'birth' || text === 'adopted' || text === 'foster' || text === 'sealing'
		? text
		: 'other';
}

/**
 * Standardize a GEDCOM date into sortable bounds without fabricating exact
 * days from partial dates. Delegates to the domain date parser so that
 * `1900` yields year-precision bounds and `ABT 1900` keeps its qualifier.
 */
export function normalizeGedcomDate(dateStr?: string): {
	raw?: string;
	sort?: string;
	sortEnd?: string | null;
} {
	if (!dateStr || !dateStr.trim()) return {};
	const value = parseDateValue(dateStr);
	return {
		raw: value.raw || undefined,
		sort: value.sortStart ?? undefined,
		sortEnd: value.sortEnd ?? null
	};
}

/**
 * The date text of a `DATE` node as Epoch stores it. A 7.0 date's `PHRASE` is folded into the
 * text the 5.5.1 way, so the phrase is not lost and a 7.0 export splits it out again.
 */
function dateTextOf(dateNode: GedcomNode | undefined, version: GedcomVersion): string | undefined {
	if (!dateNode || version !== '7.0') return dateNode?.value;
	return fromGedcom7Date(dateNode.value, dateNode.children.find((c) => c.tag === 'PHRASE')?.value);
}

/**
 * Normalise the parsed values in place: drop the code points GEDCOM forbids in text, and put back a
 * leading `@` the file escaped as `@@` (7.0's way of saying "text, not a pointer"). Applies to both
 * dialects, because a 5.5.1 file can carry the same `@@` text even though the standard never named
 * it. Kept lines are not touched: they are written back exactly as the file had them.
 */
export function normalizeModelText(nodes: GedcomNode[]): void {
	for (const node of nodes) {
		if (node.value !== undefined) node.value = normalizedNodeText(node);
		normalizeModelText(node.children);
	}
}

const NAME_TYPE_BY_WORD: Record<string, NameType> = Object.fromEntries(
	Object.values(NAME_TYPES).map((t) => [t, t])
);

/** `TYPE` is lowercase in 5.5.1 and uppercase in 7.0; a word that is neither of the known ones is free text. */
function parseNameType(
	value: string | undefined,
	phrase?: string
): { type: NameType; gedcomType?: string } {
	const word = value?.trim();
	if (!word) return { type: NAME_TYPES.OTHER };
	const known = NAME_TYPE_BY_WORD[word.toLowerCase()];
	if (known === NAME_TYPES.OTHER)
		return { type: known, ...(phrase?.trim() ? { gedcomType: phrase.trim() } : {}) };
	if (known) return { type: known };
	return { type: NAME_TYPES.OTHER, gedcomType: word };
}

const MODELLED_NAME_TAGS = new Set(['TYPE', 'NPFX', 'GIVN', 'NICK', 'SPFX', 'SURN', 'NSFX']);

/**
 * Read one `NAME` record. The line's value supplies what the sub-tags do not; the sub-tags win.
 * A suffix on the line is kept in the given name when there is no `NSFX`, as it always was. An
 * untyped name is birth when it is the first and `aka` after that: GEDCOM says nothing, and a
 * second name is not the one the person was born with.
 */
function parseNameNode(
	node: GedcomNode,
	collect: (n: GedcomNode) => string[],
	isPrimary: boolean,
	isEvidenceModelled: boolean,
	isNotesModelled: boolean
): ParsedName {
	const sub = (tag: string) => node.children.find((c) => c.tag === tag)?.value?.trim() || undefined;
	const value = node.value ?? '';
	const open = value.indexOf('/');
	const close = open === -1 ? -1 : value.indexOf('/', open + 1);
	let { givenName, surname } = parseGedcomNameValue(value);
	if (sub('NSFX') && close !== -1) {
		givenName = value.slice(0, open).replace(/\s+/g, ' ').trim() || undefined;
	}
	const prefix = sub('NPFX');
	if (prefix && givenName?.startsWith(`${prefix} `))
		givenName = givenName.slice(prefix.length + 1).trim() || undefined;
	const typeNode = node.children.find((c) => c.tag === 'TYPE');
	const surn = sub('SURN');
	const spfx = sub('SPFX');
	// The line writes the surname prefix inside the slashes ("/de la Cruz/"); the column holds it apart.
	if (spfx && !surn && surname?.startsWith(`${spfx} `))
		surname = surname.slice(spfx.length + 1).trim() || undefined;
	const changeNode = node.children.find(
		(c) =>
			c.tag === 'NOTE' &&
			c.children.length === 0 &&
			c.value &&
			NAME_CHANGE_NOTE.test(c.value.trim())
	);
	const change = changeNode ? NAME_CHANGE_NOTE.exec(changeNode.value!.trim()) : null;
	// Epoch's own name-change note (ADR-013) is never a user's note; any other note is.
	const { notes, others } = splitNotes(node.children, isNotesModelled, (c) => c === changeNode);
	return {
		...(typeNode
			? parseNameType(typeNode.value, typeNode.children.find((c) => c.tag === 'PHRASE')?.value)
			: { type: isPrimary ? NAME_TYPES.BIRTH : NAME_TYPES.AKA }),
		givenName: sub('GIVN') ?? givenName,
		surname: surn ?? surname,
		prefix,
		suffix: sub('NSFX') ?? undefined,
		nickname: sub('NICK'),
		surnamePrefix: spfx,
		...(change?.[1] ? { dateText: change[1] } : {}),
		...(change?.[2] ? { unionXref: change[2] } : {}),
		...(changeNode ? { changeNoteLine: changeNode.rawLine } : {}),
		extra: others
			.filter(
				(c) =>
					!MODELLED_NAME_TAGS.has(c.tag) &&
					c !== changeNode &&
					!(isEvidenceModelled && c.tag === 'SOUR')
			)
			.flatMap(collect),
		citations: isEvidenceModelled
			? node.children.filter((c) => c.tag === 'SOUR').map((c) => parseCitation(c, isNotesModelled))
			: [],
		notes
	};
}

/** A `_MARNM` value is "Given /Surname/" in some programs and just the surname in others. */
function parseLegacyMarriedName(value: string, primary: ParsedName | undefined): ParsedName {
	const hasSlashes = value.includes('/');
	const parts = hasSlashes
		? parseGedcomNameValue(value)
		: { givenName: primary?.givenName, surname: value.trim() || undefined };
	return {
		type: NAME_TYPES.MARRIED,
		gedcomType: LEGACY_MARRIED_NAME_TAG,
		...parts,
		extra: [],
		citations: [],
		notes: []
	};
}

/**
 * Parses raw GEDCOM string into hierarchical records
 */
export function parseGedcom(rawContent: string, options: ParseOptions = {}): ParsedGedcomData {
	const isEvidenceModelled = options.isEvidenceModelled ?? true;
	const isNotesModelled = options.isNotesModelled ?? true;
	const version = detectGedcomVersion(rawContent);
	const rootNodes = buildGedcomTree(rawContent.split(LINE_BREAK));
	normalizeModelText(rootNodes);

	const individuals: ParsedIndividual[] = [];
	const families: ParsedFamily[] = [];
	const sources: ParsedSource[] = [];
	const repositories: ParsedRepository[] = [];
	const sharedNotes: ParsedSharedNote[] = [];
	const preserved: ParsedGedcomData['preserved'] = [];
	let treeName = 'Imported Family Tree';

	/** The citations among these nodes, or none when the file is read the retained way. */
	const citationsOf = (nodes: GedcomNode[]) =>
		isEvidenceModelled
			? nodes.filter((n) => n.tag === 'SOUR').map((n) => parseCitation(n, isNotesModelled))
			: [];
	const isCitation = (n: GedcomNode) => isEvidenceModelled && n.tag === 'SOUR';

	for (const node of rootNodes) {
		if (node.tag === 'HEAD') {
			const fileNode = node.children.find((c) => c.tag === 'FILE');
			if (fileNode?.value) {
				treeName = fileNode.value;
			}
		} else if (node.tag === 'INDI') {
			const id = node.xref || crypto.randomUUID();
			const names: ParsedName[] = [];
			const legacyMarried: string[] = [];
			let sex: Sex = 'U';
			let isSexXFallback = false;
			let privacy: 'private' | 'public' | undefined;
			const famc: string[] = [];
			const famcLinks: ParsedFamcLink[] = [];
			const fams: string[] = [];
			const events: ParsedEvent[] = [];
			const citations: ParsedCitation[] = [];
			const notes: ParsedNoteLink[] = [];

			for (const child of node.children) {
				if (child.tag === 'NAME') {
					names.push(
						parseNameNode(
							child,
							collectLines,
							names.length === 0,
							isEvidenceModelled,
							isNotesModelled
						)
					);
				} else if (child.tag === LEGACY_MARRIED_NAME_TAG && child.value?.trim()) {
					legacyMarried.push(child.value);
				} else if (child.tag === 'SEX') {
					const val = child.value?.toUpperCase().trim();
					if (val === 'M' || val === 'F' || val === 'X') sex = val;
					else sex = 'U';
				} else if (child.tag === SEX_X_TAG && child.value?.trim().toUpperCase() === 'X') {
					isSexXFallback = true;
				} else if (
					child.tag === 'RESN' &&
					child.value?.split(',').some((w) => RESTRICTING_RESN_WORDS.has(w.trim().toLowerCase()))
				) {
					// The restriction becomes the override, so there is one source of truth. A `LOCKED` beside it
					// has no meaning to Epoch and is kept under its own `RESN` line.
					privacy = 'private';
					const rest = child.value
						.split(',')
						.map((w) => w.trim())
						.filter((w) => w && !RESTRICTING_RESN_WORDS.has(w.toLowerCase()));
					if (rest.length > 0)
						preserved.push({ xref: id, lines: [`${child.level} RESN ${rest.join(', ')}`] });
				} else if (
					child.tag === PRIVACY_PUBLIC_TAG &&
					child.value?.trim().toLowerCase() === 'public'
				) {
					privacy = 'public';
				} else if (child.tag === 'FAMC' && child.value) {
					const familyId = child.value.trim();
					famc.push(familyId);
					const parentPedigrees: Record<string, Pedigree> = {};
					for (const sub of child.children) {
						const parentPedigree =
							sub.tag === PARENT_PEDIGREE_TAG && sub.value
								? parsePedigree(sub.children.find((c) => c.tag === 'PEDI')?.value)
								: undefined;
						if (parentPedigree) parentPedigrees[sub.value!.trim()] = parentPedigree;
					}
					// STAT, NOTE and the like under FAMC have no model. Keep them, headed by their FAMC line,
					// so export writes them back under the same link (ADR-009).
					const { notes: linkNotes, others: linkOthers } = splitNotes(
						child.children,
						isNotesModelled
					);
					const extras = linkOthers.filter(
						(sub) => sub.tag !== 'PEDI' && sub.tag !== PARENT_PEDIGREE_TAG && !isCitation(sub)
					);
					if (extras.length > 0)
						preserved.push({ xref: id, lines: [child.rawLine, ...extras.flatMap(collectLines)] });
					famcLinks.push({
						familyId,
						pedigree: parsePedigree(child.children.find((c) => c.tag === 'PEDI')?.value),
						...(Object.keys(parentPedigrees).length > 0 ? { parentPedigrees } : {}),
						citations: citationsOf(child.children),
						notes: linkNotes
					});
				} else if (child.tag === 'FAMS' && child.value) {
					fams.push(child.value.trim());
				} else if (INDIVIDUAL_EVENT_TAGS.has(child.tag)) {
					const dateNode = child.children.find((c) => c.tag === 'DATE');
					const placNode = child.children.find((c) => c.tag === 'PLAC');
					const textOf = (tag: string) =>
						child.children.find((c) => c.tag === tag)?.value?.trim() || undefined;
					const { raw, sort, sortEnd } = normalizeGedcomDate(dateTextOf(dateNode, version));

					// The first plain NOTE is the fact's note. A note with continuation lines, a second note,
					// a citation, an OBJE or a custom tag has no column and is kept verbatim (ADR-023).
					// With notes read into records every note under the fact is one, in file order, and the
					// column's text is not used; the old reading is kept for the backfill's tests.
					const noteNode = isNotesModelled
						? undefined
						: child.children.find((c) => c.tag === 'NOTE' && c.children.length === 0);
					const { notes: noteLinks, others: factOthers } = splitNotes(
						child.children,
						isNotesModelled
					);
					const modelled = new Set([
						dateNode,
						placNode,
						child.children.find((c) => c.tag === 'CAUS'),
						child.children.find((c) => c.tag === 'AGE'),
						noteNode
					]);
					const extra = factOthers
						.filter((c) => !modelled.has(c) && !isCitation(c))
						.flatMap(collectLines);

					// Each piece keeps its own column, so a cause is not written back as a note and a
					// repeated fact stays a fact. `description` is left for family events and old rows.
					events.push({
						type: child.tag,
						dateRaw: raw,
						dateSort: sort,
						dateSortEnd: sortEnd,
						place: placNode?.value?.trim(),
						value: child.value?.trim() || undefined,
						cause: textOf('CAUS'),
						age: textOf('AGE'),
						notes: noteNode?.value?.trim() || undefined,
						...(isNotesModelled ? { noteLinks } : {}),
						...(extra.length > 0 ? { extra } : {}),
						citations: citationsOf(child.children)
					});
				} else if (isCitation(child)) {
					citations.push(parseCitation(child, isNotesModelled));
				} else if (isNotesModelled && isNoteNode(child) && parseNoteLink(child)) {
					notes.push(parseNoteLink(child)!);
				} else {
					// Preserve unmodeled individual-level structures (CHAN, NOTE, OBJE, REFN, ASSO, custom
					// tags, etc.) verbatim. A citation is one only while evidence is read the retained way.
					preserved.push({ xref: id, lines: collectLines(child) });
				}
			}

			// A legacy `_MARNM` follows the file's real names, so the first `NAME` stays the primary one.
			for (const value of legacyMarried) names.push(parseLegacyMarriedName(value, names[0]));
			individuals.push({
				id,
				givenName: names[0]?.givenName,
				surname: names[0]?.surname,
				names,
				// A 5.5.1 export cannot say X, so it writes U and `_EPOCH_SEX X`; put the X back.
				sex: sex === 'U' && isSexXFallback ? 'X' : sex,
				...(privacy ? { privacy } : {}),
				famc,
				famcLinks,
				fams,
				events,
				citations,
				notes
			});
		} else if (node.tag === 'FAM') {
			const id = node.xref || crypto.randomUUID();
			let husbandId: string | undefined;
			let wifeId: string | undefined;
			const children: ParsedFamily['children'] = [];
			const aliases: string[] = [];
			const events: ParsedEvent[] = [];
			const citations: ParsedCitation[] = [];
			const notes: ParsedNoteLink[] = [];

			for (const child of node.children) {
				if (child.tag === 'HUSB' && child.value) {
					husbandId = child.value.trim();
				} else if (child.tag === 'WIFE' && child.value) {
					wifeId = child.value.trim();
				} else if (child.tag === 'CHIL' && child.value) {
					// `PEDI` under `CHIL` is not standard; files Epoch used to export carry it there, so it is
					// still read, but the child's own `FAMC` takes precedence below.
					const pedigree =
						parsePedigree(child.children.find((c) => c.tag === 'PEDI')?.value) ?? 'birth';
					children.push({ childId: child.value.trim(), pedigree });
				} else if (
					child.tag === 'REFN' &&
					child.value &&
					child.children.some((c) => c.tag === 'TYPE' && c.value?.trim() === FAMILY_ALIAS_REFN_TYPE)
				) {
					const alias = child.value.trim();
					aliases.push(alias.startsWith('@') ? alias : `@${alias}@`);
				} else if (FAMILY_EVENT_TAGS.has(child.tag)) {
					const dateNode = child.children.find((c) => c.tag === 'DATE');
					const placNode = child.children.find((c) => c.tag === 'PLAC');
					const { raw, sort, sortEnd } = normalizeGedcomDate(dateTextOf(dateNode, version));

					const { notes: noteLinks, others: factOthers } = splitNotes(
						child.children,
						isNotesModelled
					);
					const extra = factOthers
						.filter((c) => c !== dateNode && c !== placNode && !isCitation(c))
						.flatMap(collectLines);
					events.push({
						type: child.tag,
						dateRaw: raw,
						dateSort: sort,
						dateSortEnd: sortEnd,
						place: placNode?.value?.trim(),
						description: child.value?.trim(),
						...(isNotesModelled ? { noteLinks } : {}),
						...(extra.length > 0 ? { extra } : {}),
						citations: citationsOf(child.children)
					});
				} else if (isCitation(child)) {
					citations.push(parseCitation(child, isNotesModelled));
				} else if (isNotesModelled && isNoteNode(child) && parseNoteLink(child)) {
					notes.push(parseNoteLink(child)!);
				} else {
					// Preserve unmodeled family-level structures verbatim.
					preserved.push({ xref: id, lines: collectLines(child) });
				}
			}

			families.push({
				id,
				husbandId,
				wifeId,
				children,
				events,
				citations,
				notes,
				...(aliases.length > 0 ? { aliases } : {})
			});
		} else if (isEvidenceModelled && node.tag === 'SOUR' && node.xref) {
			sources.push(parseSourceRecord(node, isNotesModelled));
		} else if (isEvidenceModelled && node.tag === 'REPO' && node.xref) {
			repositories.push(parseRepositoryRecord(node, isNotesModelled));
		} else if (isNotesModelled && isNoteNode(node) && node.xref) {
			sharedNotes.push(parseNoteRecord(node));
		} else if (node.tag !== 'TRLR') {
			// Preserve unrecognized root-level records (NOTE, SUBM, OBJE, custom records) so they are
			// retained for export. A root SOUR or REPO without an XREF cannot be pointed at, so it stays too.
			preserved.push({ xref: node.xref ?? null, lines: collectLines(node) });
		}
	}

	// The child's own `FAMC` is where PEDI belongs, so it decides the pedigree of that child's link.
	const linkOf = new Map<string, ParsedFamcLink>();
	for (const ind of individuals)
		for (const link of ind.famcLinks ?? []) linkOf.set(`${ind.id}|${link.familyId}`, link);
	const attached = new Set<ParsedFamcLink>();
	for (const fam of families) {
		for (const child of fam.children) {
			const link = linkOf.get(`${child.childId}|${fam.id}`);
			if (link?.pedigree) child.pedigree = link.pedigree;
			if (link?.parentPedigrees) child.parentPedigrees = link.parentPedigrees;
			if (link && link.citations.length > 0) {
				child.citations = link.citations;
				attached.add(link);
			}
			if (link && link.notes.length > 0) {
				child.notes = link.notes;
				attached.add(link);
			}
		}
	}
	// A `FAMC` whose family does not list the child has nowhere to hang its citations in the model.
	// They stay under the link as retained lines, as a link's other extras always have (ADR-009).
	for (const ind of individuals) {
		for (const link of ind.famcLinks ?? []) {
			if ((link.citations.length === 0 && link.notes.length === 0) || attached.has(link)) continue;
			preserved.push({
				xref: ind.id,
				lines: [
					`1 FAMC ${link.familyId}`,
					...link.citations.flatMap((c) => c.raw),
					...link.notes.flatMap((n) => n.raw)
				]
			});
		}
	}

	return {
		version,
		individuals,
		families,
		treeName,
		preserved,
		sources,
		repositories,
		notes: sharedNotes
	};
}
