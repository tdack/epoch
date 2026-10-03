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

export type GedcomVersion = '5.5.1' | '7.0';

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
}

export interface ParsedFamily {
	id: string; // e.g. @F1@ or F1
	husbandId?: string;
	wifeId?: string;
	children: { childId: string; pedigree?: Pedigree; parentPedigrees?: Record<string, Pedigree> }[];
	events: ParsedEvent[];
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
	/** `2 NOTE` */
	notes?: string;
	/** Every other line under the event, verbatim and in order (`gedcomExtra`). */
	extra?: string[];
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
 * Detect the GEDCOM version from the `GEDC.VERS` value in the header.
 * Defaults to 5.5.1 when the version cannot be determined.
 */
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

export function detectGedcomVersion(rawContent: string): GedcomVersion {
	const lines = rawContent.split(/\r?\n/);
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
				return vers[1].trim().startsWith('7') ? '7.0' : '5.5.1';
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

interface GedcomNode {
	level: number;
	tag: string;
	xref?: string;
	value?: string;
	rawLine: string;
	children: GedcomNode[];
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
 * Parse a GEDCOM line into tokens, supporting both 5.5.1 and 7.0 syntax.
 *
 * GEDCOM 7 payloads may contain unescaped `@` characters (e.g. email
 * addresses), so the xref is only captured when it appears immediately after
 * the level on a record-bearing line (`0 @I1@ INDI`). Custom tags may exceed
 * the alphanumeric set, so the tag pattern is widened to `[^\s]+`.
 */
function parseGedcomLine(
	line: string
): { level: number; xref?: string; tag: string; value?: string } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	const match = trimmed.match(/^(\d+)(?:\s+(@[^@]+@))?(?:\s+([^\s]+))?(?:\s+(.*))?$/);
	if (!match) return null;

	const level = parseInt(match[1], 10);
	const xref = match[2];
	const tag = match[3]?.toUpperCase();
	if (!tag) return null;

	return { level, xref, tag, value: match[4] };
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
	isPrimary: boolean
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
		extra: node.children
			.filter((c) => !MODELLED_NAME_TAGS.has(c.tag) && c !== changeNode)
			.flatMap(collect)
	};
}

/** A `_MARNM` value is "Given /Surname/" in some programs and just the surname in others. */
function parseLegacyMarriedName(value: string, primary: ParsedName | undefined): ParsedName {
	const hasSlashes = value.includes('/');
	const parts = hasSlashes
		? parseGedcomNameValue(value)
		: { givenName: primary?.givenName, surname: value.trim() || undefined };
	return { type: NAME_TYPES.MARRIED, gedcomType: LEGACY_MARRIED_NAME_TAG, ...parts, extra: [] };
}

/**
 * Parses raw GEDCOM string into hierarchical records
 */
export function parseGedcom(rawContent: string): ParsedGedcomData {
	const lines = rawContent.split(/\r?\n/);
	const rootNodes: GedcomNode[] = [];
	const stack: GedcomNode[] = [];

	for (const line of lines) {
		const parsed = parseGedcomLine(line);
		if (!parsed) continue;

		const node: GedcomNode = {
			level: parsed.level,
			tag: parsed.tag,
			xref: parsed.xref,
			value: parsed.value,
			rawLine: line,
			children: []
		};

		if (node.level === 0) {
			rootNodes.push(node);
			stack.length = 0;
			stack.push(node);
		} else {
			while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
				stack.pop();
			}
			if (stack.length > 0) {
				stack[stack.length - 1].children.push(node);
			}
			stack.push(node);
		}
	}

	const individuals: ParsedIndividual[] = [];
	const families: ParsedFamily[] = [];
	const preserved: ParsedGedcomData['preserved'] = [];
	let treeName = 'Imported Family Tree';

	const collectLines = (node: GedcomNode): string[] => {
		const out = [node.rawLine];
		for (const c of node.children) out.push(...collectLines(c));
		return out;
	};

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

			for (const child of node.children) {
				if (child.tag === 'NAME') {
					names.push(parseNameNode(child, collectLines, names.length === 0));
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
					const extras = child.children.filter(
						(sub) => sub.tag !== 'PEDI' && sub.tag !== PARENT_PEDIGREE_TAG
					);
					if (extras.length > 0)
						preserved.push({ xref: id, lines: [child.rawLine, ...extras.flatMap(collectLines)] });
					famcLinks.push({
						familyId,
						pedigree: parsePedigree(child.children.find((c) => c.tag === 'PEDI')?.value),
						...(Object.keys(parentPedigrees).length > 0 ? { parentPedigrees } : {})
					});
				} else if (child.tag === 'FAMS' && child.value) {
					fams.push(child.value.trim());
				} else if (INDIVIDUAL_EVENT_TAGS.has(child.tag)) {
					const dateNode = child.children.find((c) => c.tag === 'DATE');
					const placNode = child.children.find((c) => c.tag === 'PLAC');
					const textOf = (tag: string) =>
						child.children.find((c) => c.tag === tag)?.value?.trim() || undefined;
					const { raw, sort, sortEnd } = normalizeGedcomDate(dateNode?.value);

					// The first plain NOTE is the fact's note. A note with continuation lines, a second note,
					// a citation, an OBJE or a custom tag has no column and is kept verbatim (ADR-023).
					const noteNode = child.children.find((c) => c.tag === 'NOTE' && c.children.length === 0);
					const modelled = new Set([
						dateNode,
						placNode,
						child.children.find((c) => c.tag === 'CAUS'),
						child.children.find((c) => c.tag === 'AGE'),
						noteNode
					]);
					const extra = child.children.filter((c) => !modelled.has(c)).flatMap(collectLines);

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
						...(extra.length > 0 ? { extra } : {})
					});
				} else {
					// Preserve unmodeled individual-level structures (CHAN, NOTE, SOUR,
					// OBJE, REFN, ASSO, custom tags, etc.) verbatim.
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
				events
			});
		} else if (node.tag === 'FAM') {
			const id = node.xref || crypto.randomUUID();
			let husbandId: string | undefined;
			let wifeId: string | undefined;
			const children: ParsedFamily['children'] = [];
			const aliases: string[] = [];
			const events: ParsedEvent[] = [];

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
					const { raw, sort, sortEnd } = normalizeGedcomDate(dateNode?.value);

					const extra = child.children
						.filter((c) => c !== dateNode && c !== placNode)
						.flatMap(collectLines);
					events.push({
						type: child.tag,
						dateRaw: raw,
						dateSort: sort,
						dateSortEnd: sortEnd,
						place: placNode?.value?.trim(),
						description: child.value?.trim(),
						...(extra.length > 0 ? { extra } : {})
					});
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
				...(aliases.length > 0 ? { aliases } : {})
			});
		} else if (node.tag !== 'TRLR') {
			// Preserve unrecognized root-level records (NOTE, SOUR, SUBM, REPO, OBJE,
			// custom records) so they are retained for export.
			preserved.push({ xref: node.xref ?? null, lines: collectLines(node) });
		}
	}

	// The child's own `FAMC` is where PEDI belongs, so it decides the pedigree of that child's link.
	const linkOf = new Map<string, ParsedFamcLink>();
	for (const ind of individuals)
		for (const link of ind.famcLinks ?? []) linkOf.set(`${ind.id}|${link.familyId}`, link);
	for (const fam of families) {
		for (const child of fam.children) {
			const link = linkOf.get(`${child.childId}|${fam.id}`);
			if (link?.pedigree) child.pedigree = link.pedigree;
			if (link?.parentPedigrees) child.parentPedigrees = link.parentPedigrees;
		}
	}

	return {
		version: detectGedcomVersion(rawContent),
		individuals,
		families,
		treeName,
		preserved
	};
}
