import { toGedcom551Lines, toGedcom7Lines } from './dialect';
import { escapedSingleLine, fieldLines, keptLines, LINE_BREAK, singleLine } from './evidence-lines';
import { canonicalNameValue } from './name-value';
import { levelOfLine } from './node';
import { ValidationError } from '../domain/errors';
import {
	DEFAULT_GEDCOM_FORMAT,
	EXTENSION_TAG_URIS,
	FAMILY_ALIAS_REFN_TYPE,
	type GedcomFormat,
	LEGACY_MARRIED_NAME_TAG,
	NAME_CHANGE_NOTE,
	nameChangeNote,
	PARENT_PEDIGREE_TAG,
	PRIVACY_PUBLIC_TAG,
	SEX_X_TAG
} from './tags';

/**
 * Shared payload shape consumed by both the 5.5.1 and 7.0 serializers.
 */
/** One name to write, as stored. The payload lists them preferred first, because GEDCOM's first `NAME` is the primary. */
interface ExportName {
	type: string;
	gedcomType?: string | null;
	givenName: string | null;
	surname: string | null;
	prefix?: string | null;
	suffix?: string | null;
	nickname?: string | null;
	surnamePrefix?: string | null;
	dateText?: string | null;
	/** The family the name came from, as its export XREF. */
	unionXref?: string | null;
	extra?: string[] | null;
	/** The `NAME` payload as imported, written while the parts still build `canonValue` (name-value.ts). */
	rawValue?: string;
	canonValue?: string;
	/** Imported with no `TYPE`: an `aka` that is not the first is then written without one. */
	isUntyped?: boolean;
	/** Imported with the name on the `NAME` line alone, so its parts are not written beneath it. */
	isLineOnly?: boolean;
	citations?: ExportCitation[];
	notes?: ExportNote[];
}

/**
 * One note on a structure as it is written: a pointer at a shared note, or the inline text, and the
 * lines kept under it (ADR-029). `pointerTag` is the tag a 7.0 file writes a pointer with; 5.5.1
 * has only `NOTE`.
 */
export interface ExportNote {
	/** The shared note's XREF, or the pointer the file named that is not a record here; null for inline. */
	pointer: string | null;
	pointerTag?: 'NOTE' | 'SNOTE';
	text?: string | null;
	layout?: Record<string, string[]> | null;
	extra?: string[] | null;
}

/** A shared note record as written. */
interface ExportSharedNote {
	xref: string;
	/** The root tag a 7.0 file writes the record with; 5.5.1 always writes `NOTE`. */
	tag: 'NOTE' | 'SNOTE';
	text?: string | null;
	mime?: string | null;
	language?: string | null;
	layout?: Record<string, string[]> | null;
	extra?: string[] | null;
}

/** One citation as it is written: its pointer, the fields the model holds, and the lines it keeps. */
export interface ExportCitation {
	/** The cited source's XREF, or the pointer the file named that is not a record here; null for none. */
	pointer: string | null;
	description?: string | null;
	page?: string | null;
	quality?: number | null;
	entryDate?: string | null;
	text?: string | null;
	layout?: Record<string, string[]> | null;
	extra?: string[] | null;
	notes?: ExportNote[];
}

/** A source record as written. */
interface ExportSource {
	xref: string;
	title?: string | null;
	author?: string | null;
	publication?: string | null;
	abbreviation?: string | null;
	text?: string | null;
	layout?: Record<string, string[]> | null;
	extra?: string[] | null;
	notes?: ExportNote[];
	/** `REPO` links in order: the pointer (or none), the call number, and the lines kept under the link. */
	repositories: Array<{
		pointer: string | null;
		callNumber?: string | null;
		extra?: string[] | null;
	}>;
}

/** A repository record as written. */
interface ExportRepository {
	xref: string;
	name?: string | null;
	address?: string | null;
	layout?: Record<string, string[]> | null;
	extra?: string[] | null;
	notes?: ExportNote[];
}

/**
 * The details an event carries beyond its date, place and text (see fact-details.ts). Each is
 * written only when present, so a fact without one exports as it did before the column existed.
 */
interface ExportFactDetails {
	classification?: string | null;
	address?: string | null;
	/** The file's own ADDR lines, written back only while they still say `address`. */
	addressLayout?: string[] | null;
	agency?: string | null;
	/** One value per line, as the import reads them. */
	phone?: string | null;
	email?: string | null;
	fax?: string | null;
	web?: string | null;
	latitude?: string | null;
	longitude?: string | null;
	/** The place's sub-lines other than MAP, verbatim with their levels. */
	placeExtra?: string[] | null;
	/** Sub-lines of the fact's DATE, CAUS and AGE, written right under each. */
	dateExtra?: string[] | null;
	causeExtra?: string[] | null;
	ageExtra?: string[] | null;
	religion?: string | null;
}

export interface GedcomExportPayload {
	treeName?: string;
	individuals: Array<{
		id: string;
		givenName: string | null;
		surname: string | null;
		/** Every stored name; when absent or empty the single `givenName`/`surname` pair is written. */
		names?: ExportName[];
		sex: string | null;
		/** The person's privacy override; `auto` (or absent) writes nothing. */
		privacy?: string | null;
		events?: Array<
			ExportFactDetails & {
				type: string;
				dateRaw: string | null;
				place: string | null;
				description: string | null;
				value?: string | null;
				cause?: string | null;
				age?: string | null;
				notes?: string | null;
				/** Lines with no column, written back inside the fact. */
				gedcomExtra?: string[] | null;
				citations?: ExportCitation[];
				/** The notes under the fact, written before its citations. */
				noteLinks?: ExportNote[];
			}
		>;
		/** Citations of the person themself. */
		citations?: ExportCitation[];
		/** Notes on the person themself. */
		notes?: ExportNote[];
		famc?: string[];
		fams?: string[];
	}>;
	families: Array<{
		id: string;
		husbandId: string | null;
		wifeId: string | null;
		children?: Array<{
			childId: string;
			pedigree: string | null;
			/** Parent XREF to a pedigree that differs from `pedigree`; written under the child's `FAMC`. */
			parentPedigrees?: Record<string, string>;
			/** Citations of the link, written under the child's `FAMC`. */
			citations?: ExportCitation[];
			/** Notes of the link, written under the child's `FAMC`. */
			notes?: ExportNote[];
		}>;
		/** XREFs of families merged into this one; each is written as a typed `REFN`. */
		aliases?: string[];
		events?: Array<
			ExportFactDetails & {
				type: string;
				dateRaw: string | null;
				place: string | null;
				description: string | null;
				gedcomExtra?: string[] | null;
				citations?: ExportCitation[];
				noteLinks?: ExportNote[];
			}
		>;
		/** Citations of the family record. */
		citations?: ExportCitation[];
		/** Notes on the family record. */
		notes?: ExportNote[];
	}>;
	/** Root `SOUR`, `REPO` and shared note records, written after the last family. */
	sources?: ExportSource[];
	repositories?: ExportRepository[];
	notes?: ExportSharedNote[];
	/** Unmodeled GEDCOM structures to re-emit verbatim, keyed by owner XREF. */
	preserved?: Array<{ xref: string | null; lines: string[] }>;
	/** The tree's submitter (ADR-075). A 7.0 file names one only when `name` is set; 5.5.1 always does. */
	submitter?: { name?: string | null; email?: string | null; www?: string | null } | null;
	/** When the export was made, for `HEAD.DATE`; now when absent. */
	exportedAt?: Date;
	/**
	 * Header structures an import kept (`LANG`, `PLAC`, `SCHMA`), one block each, verbatim with their
	 * levels. Only the first `LANG` and `PLAC` are written; the `SCHMA` blocks merge with Epoch's own.
	 */
	headerBlocks?: string[][];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The `HEAD.DATE` structure, in UTC. 7.0 marks the time as UTC with `Z`; 5.5.1 has no such mark. */
function headerDateLines(at: Date, format: GedcomFormat): string[] {
	const pad = (n: number) => String(n).padStart(2, '0');
	const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
	return [
		`1 DATE ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`,
		`2 TIME ${time}${format === 'gedcom7' ? 'Z' : ''}`
	];
}

/**
 * The tag it is written under in the file, with a name no kept record can hold, so the numbering in
 * `renumberXrefs` gives it the next free `@U1@`.
 */
const SUBMITTER_PLACEHOLDER_XREF = '@epoch-submitter@';

/** The submitter's name, or null for a 7.0 file with none; 5.5.1 requires one and says `Unknown`. */
function submitterName(data: GedcomExportPayload, format: GedcomFormat): string | null {
	return data.submitter?.name?.trim() || (format === 'gedcom551' ? 'Unknown' : null);
}

function submitterRecord(data: GedcomExportPayload, format: GedcomFormat): string[] {
	const name = submitterName(data, format);
	if (!name) return [];
	const lines = [`0 ${SUBMITTER_PLACEHOLDER_XREF} SUBM`, `1 NAME ${escapedSingleLine(name)}`];
	if (data.submitter?.name?.trim()) {
		if (data.submitter.email) lines.push(`1 EMAIL ${escapedSingleLine(data.submitter.email)}`);
		if (data.submitter.www) lines.push(`1 WWW ${escapedSingleLine(data.submitter.www)}`);
	}
	return lines;
}

/** The first kept header block that starts with `tag`, folded to single lines. */
function keptHeaderBlock(data: GedcomExportPayload, tag: string): string[] {
	const block = (data.headerBlocks ?? []).find((b) => new RegExp(`^1 ${tag}\\b`).test(b[0] ?? ''));
	return foldLines(block);
}

/**
 * `RESN` for a private person and the custom line for an explicit public one; nothing for `auto`.
 */
function privacyLines(privacy: string | null | undefined, restrictionWord: string): string[] {
	if (privacy === 'private') return [`1 RESN ${restrictionWord}`];
	if (privacy === 'public') return [`1 ${PRIVACY_PUBLIC_TAG} public`];
	return [];
}

/**
 * A GEDCOM tag or pointer is a single token. A terminator in one would forge a line — `BIRT\n0 @X@ INDI`
 * would read as a new record — so it is refused rather than folded into a plausible-looking tag.
 */
function requireSingleLineToken(token: string, what: string): string {
	if (singleLine(token) !== token) {
		throw new ValidationError(
			`${what} must be a single GEDCOM token, got ${JSON.stringify(token)}`
		);
	}
	return token;
}

/** Kept lines are one line each; a terminator inside one is corrupt, so it folds rather than splits. */
function foldLines(lines: readonly string[] | null | undefined): string[] {
	return (lines ?? []).map((line) => singleLine(line) ?? '');
}

/**
 * Kept lines that hang under a structure: the first sits at `firstLevel`, and no later line may rise
 * to `floor` or above, since a stored `1 DEAT` or `0 @X@ INDI` would otherwise read as a sibling of
 * the structure or a new record. `keptLines` only moves a block as a whole, so the floor is what
 * stops a line that started deeper from escaping.
 */
function keptUnder(
	firstLevel: number,
	floor: number,
	lines: readonly string[] | null | undefined
): string[] {
	return keptLines(firstLevel, foldLines(lines)).map((line, i) => {
		const own = levelOfLine(line);
		if (i === 0 || own === null || own >= floor) return line;
		return line.replace(/^(\s*)\d+/, `$1${floor}`);
	});
}

/**
 * A place and what hangs under it. The place's sub-lines and coordinates are written only while the
 * place has text: the coordinates belong to a place, and a sub-line with no `PLAC` to sit under
 * would be read back as a fact detail of the event.
 */
function placeLines(ev: ExportFactDetails & { place: string | null }): string[] {
	if (!ev.place) return [];
	const lines = [`2 PLAC ${escapedSingleLine(ev.place)}`, ...keptUnder(3, 3, ev.placeExtra)];
	if (ev.latitude || ev.longitude) {
		lines.push('3 MAP');
		if (ev.latitude) lines.push(`4 LATI ${escapedSingleLine(ev.latitude)}`);
		if (ev.longitude) lines.push(`4 LONG ${escapedSingleLine(ev.longitude)}`);
	}
	return lines;
}

/**
 * The address, contacts, agency and religion of a fact, in the order the spec lists them. Each
 * contact value is written on a line of its own: a repeated tag is one fact detail per line, not one
 * value that could span lines.
 */
function addressAndContactLines(ev: ExportFactDetails): string[] {
	const lines = fieldLines(
		2,
		'ADDR',
		ev.address,
		ev.addressLayout ? keptUnder(2, 3, ev.addressLayout) : null
	);
	const contacts: Array<[string, string | null | undefined]> = [
		['PHON', ev.phone],
		['EMAIL', ev.email],
		['FAX', ev.fax],
		['WWW', ev.web]
	];
	for (const [tag, values] of contacts) {
		for (const value of (values ?? '').split(LINE_BREAK)) {
			if (value.trim() !== '') lines.push(`2 ${tag} ${escapedSingleLine(value)}`);
		}
	}
	if (ev.agency) lines.push(`2 AGNC ${escapedSingleLine(ev.agency)}`);
	if (ev.religion) lines.push(`2 RELI ${escapedSingleLine(ev.religion)}`);
	return lines;
}

/**
 * An individual's event as GEDCOM lines. The line value goes on the event's own line, and a legacy
 * `description` is written as a note only when the fact has no note of its own, so a fact edited
 * after import does not gain a second `NOTE`.
 */
function individualEventLines(
	ev: NonNullable<GedcomExportPayload['individuals'][number]['events']>[number],
	format: GedcomFormat
): string[] {
	const tag = requireSingleLineToken(ev.type, 'An event type');
	const lines = [ev.value ? `1 ${tag} ${escapedSingleLine(ev.value)}` : `1 ${tag}`];
	if (ev.classification) lines.push(`2 TYPE ${escapedSingleLine(ev.classification)}`);
	if (ev.dateRaw) lines.push(`2 DATE ${singleLine(ev.dateRaw)}`, ...keptUnder(3, 3, ev.dateExtra));
	lines.push(...placeLines(ev));
	lines.push(...addressAndContactLines(ev));
	if (ev.cause)
		lines.push(`2 CAUS ${escapedSingleLine(ev.cause)}`, ...keptUnder(3, 3, ev.causeExtra));
	if (ev.age) lines.push(`2 AGE ${escapedSingleLine(ev.age)}`, ...keptUnder(3, 3, ev.ageExtra));
	// A tree that has not had its notes backfilled still holds a fact's note in `notes`; it stays
	// written until the backfill moves it, so no export loses it. The legacy description stands in for
	// a note only when the fact has none of its own. Both are text and may span lines.
	const hasNoteRecords = (ev.noteLinks?.length ?? 0) > 0;
	const note = ev.notes ?? (hasNoteRecords ? null : ev.description);
	if (note) lines.push(...fieldLines(2, 'NOTE', note));
	lines.push(...citationLines(2, ev.citations, format));
	lines.push(...foldLines(ev.gedcomExtra));
	lines.push(...noteLines(2, ev.noteLinks, format));
	return lines;
}

/**
 * A family event's lines. The type is a tag and is refused if it carries a terminator; the
 * description is the fact's text and may span lines, so it goes through `fieldLines`.
 */
function familyEventLines(
	ev: NonNullable<GedcomExportPayload['families'][number]['events']>[number],
	format: GedcomFormat
): string[] {
	const tag = requireSingleLineToken(ev.type, 'An event type');
	const lines = [ev.value ? `1 ${tag} ${escapedSingleLine(ev.value)}` : `1 ${tag}`];
	if (ev.classification) lines.push(`2 TYPE ${escapedSingleLine(ev.classification)}`);
	if (ev.dateRaw) lines.push(`2 DATE ${singleLine(ev.dateRaw)}`, ...keptUnder(3, 3, ev.dateExtra));
	lines.push(...placeLines(ev));
	lines.push(...addressAndContactLines(ev));
	if (ev.description) lines.push(...fieldLines(2, 'NOTE', ev.description));
	lines.push(...citationLines(2, ev.citations, format));
	lines.push(...foldLines(ev.gedcomExtra));
	lines.push(...noteLines(2, ev.noteLinks, format));
	return lines;
}

/**
 * Notes at `level`, in order. A pointer is written with the tag the format has for one (`SNOTE` in
 * 7.0, `NOTE` in 5.5.1); an inline note carries its text, with the file's own line split while it
 * still says the same text.
 */
function noteLines(
	level: number,
	notes: ExportNote[] | undefined | null,
	format: GedcomFormat
): string[] {
	const lines: string[] = [];
	for (const n of notes ?? []) {
		if (n.pointer) {
			const tag = format === 'gedcom7' ? (singleLine(n.pointerTag ?? 'SNOTE') ?? 'SNOTE') : 'NOTE';
			lines.push(`${level} ${tag} ${singleLine(n.pointer)}`);
		} else {
			lines.push(...fieldLines(level, 'NOTE', n.text, n.layout?.NOTE));
		}
		lines.push(...keptLines(level + 1, foldLines(n.extra)));
	}
	return lines;
}

/** A shared note record: its text, `MIME` and `LANG`, then every line kept beside them. */
function sharedNoteLines(note: ExportSharedNote, format: GedcomFormat): string[] {
	const tag = format === 'gedcom7' ? (singleLine(note.tag) ?? 'SNOTE') : 'NOTE';
	// The text is written at level 0 as `NOTE` and the line's tag and XREF put in after, so the
	// file's own continuation split survives whichever tag a format has.
	const body = fieldLines(0, 'NOTE', note.text, note.layout?.NOTE);
	const xref = singleLine(note.xref);
	const head = body[0]?.replace(/^0 \S+/, `0 ${xref} ${tag}`) ?? `0 ${xref} ${tag}`;
	return [
		head,
		...body.slice(1),
		...(note.mime ? [`1 MIME ${escapedSingleLine(note.mime)}`] : []),
		...(note.language ? [`1 LANG ${escapedSingleLine(note.language)}`] : []),
		...keptLines(1, foldLines(note.extra))
	];
}

/**
 * Citations as `SOUR` lines at `level`, in order. A pointer is written as it is; a citation with no
 * pointer carries its inline text. The `DATA` structure is written only when it has something to say.
 */
function citationLines(
	level: number,
	citations: ExportCitation[] | undefined,
	format: GedcomFormat
): string[] {
	const lines: string[] = [];
	for (const c of citations ?? []) {
		if (c.pointer) lines.push(`${level} SOUR ${singleLine(c.pointer)}`);
		else
			lines.push(
				...(c.description
					? fieldLines(level, 'SOUR', c.description, c.layout?.SOUR)
					: [`${level} SOUR`])
			);
		lines.push(...fieldLines(level + 1, 'PAGE', c.page, c.layout?.PAGE));
		if (c.entryDate || c.text) {
			lines.push(`${level + 1} DATA`);
			if (c.entryDate) lines.push(`${level + 2} DATE ${singleLine(c.entryDate)}`);
			lines.push(...fieldLines(level + 2, 'TEXT', c.text, c.layout?.TEXT));
		}
		if (c.quality !== null && c.quality !== undefined) lines.push(`${level + 1} QUAY ${c.quality}`);
		lines.push(...keptLines(level + 1, foldLines(c.extra)));
		lines.push(...noteLines(level + 1, c.notes, format));
	}
	return lines;
}

/** A source record: its fields, its `REPO` links, then every line kept beside them. */
function sourceRecordLines(source: ExportSource, format: GedcomFormat): string[] {
	const lines = [`0 ${singleLine(source.xref)} SOUR`];
	lines.push(...fieldLines(1, 'TITL', source.title, source.layout?.TITL));
	lines.push(...fieldLines(1, 'AUTH', source.author, source.layout?.AUTH));
	lines.push(...fieldLines(1, 'PUBL', source.publication, source.layout?.PUBL));
	lines.push(...fieldLines(1, 'ABBR', source.abbreviation, source.layout?.ABBR));
	lines.push(...fieldLines(1, 'TEXT', source.text, source.layout?.TEXT));
	for (const link of source.repositories) {
		lines.push(link.pointer ? `1 REPO ${singleLine(link.pointer)}` : '1 REPO');
		if (link.callNumber) lines.push(`2 CALN ${escapedSingleLine(link.callNumber)}`);
		lines.push(...foldLines(link.extra));
	}
	lines.push(...foldLines(source.extra));
	lines.push(...noteLines(1, source.notes, format));
	return lines;
}

function repositoryRecordLines(repository: ExportRepository, format: GedcomFormat): string[] {
	return [
		`0 ${singleLine(repository.xref)} REPO`,
		...fieldLines(1, 'NAME', repository.name, repository.layout?.NAME),
		...fieldLines(1, 'ADDR', repository.address, repository.layout?.ADDR),
		...foldLines(repository.extra),
		...noteLines(1, repository.notes, format)
	];
}

/** The `TYPE` payload of a name, and the `PHRASE` a 7.0 file needs to say a free-text type. */
function nameTypeTokens(
	name: ExportName,
	format: GedcomFormat
): { token: string; phrase: string | null } {
	if (name.type === 'other' && name.gedcomType) {
		return format === 'gedcom7'
			? { token: 'OTHER', phrase: name.gedcomType }
			: { token: name.gedcomType, phrase: null };
	}
	return { token: format === 'gedcom7' ? name.type.toUpperCase() : name.type, phrase: null };
}

/**
 * The `NAME` records of an individual. `birth` is the default TYPE and is left out of the first
 * (primary) name only: on any later name an untyped record would be read back as `aka`. A name that
 * came from the legacy `_MARNM` tag goes back out as that tag, so a re-read does not see it twice.
 */
function nameLines(
	ind: GedcomExportPayload['individuals'][number],
	format: GedcomFormat
): string[] {
	// A person with no name at all is written with none; `NAME //` would be a name nobody gave.
	const names: ExportName[] =
		ind.names && ind.names.length > 0
			? ind.names
			: ind.givenName || ind.surname
				? [{ type: 'birth', givenName: ind.givenName, surname: ind.surname }]
				: [];
	const lines: string[] = [];
	const line = (name: ExportName) => {
		const canonical = canonicalNameValue(name);
		return name.rawValue !== undefined && name.canonValue === canonical ? name.rawValue : canonical;
	};
	let isFirst = true;
	for (const name of names) {
		if (name.type === 'married' && name.gedcomType === LEGACY_MARRIED_NAME_TAG) {
			lines.push(
				`1 ${LEGACY_MARRIED_NAME_TAG} ${escapedSingleLine(
					line({ ...name, prefix: null, surnamePrefix: null, suffix: null })
				)}`
			);
			continue;
		}
		const value = line(name);
		// A name the file gave on its line alone has no part sub-lines to put back, while its line is kept.
		const isLineOnly = name.isLineOnly && value === name.rawValue;
		lines.push(`1 NAME ${escapedSingleLine(value)}`);
		const isDefaultType =
			(isFirst && name.type === 'birth') || (!isFirst && name.isUntyped && name.type === 'aka');
		if (!isDefaultType) {
			const { token, phrase } = nameTypeTokens(name, format);
			lines.push(`2 TYPE ${escapedSingleLine(token)}`);
			if (phrase) lines.push(`3 PHRASE ${escapedSingleLine(phrase)}`);
		}
		if (name.prefix && !isLineOnly) lines.push(`2 NPFX ${escapedSingleLine(name.prefix)}`);
		if (name.givenName && !isLineOnly) lines.push(`2 GIVN ${escapedSingleLine(name.givenName)}`);
		if (name.nickname) lines.push(`2 NICK ${escapedSingleLine(name.nickname)}`);
		if (name.surnamePrefix && !isLineOnly)
			lines.push(`2 SPFX ${escapedSingleLine(name.surnamePrefix)}`);
		if (name.surname && !isLineOnly) lines.push(`2 SURN ${escapedSingleLine(name.surname)}`);
		if (name.suffix && !isLineOnly) lines.push(`2 NSFX ${escapedSingleLine(name.suffix)}`);
		// A family made in Epoch has a bare id; unwrapped, the note's pointer could not be read back.
		const note = nameChangeNote(name.dateText, name.unionXref ? asXref(name.unionXref) : null);
		if (note) lines.push(`2 NOTE ${escapedSingleLine(note)}`);
		lines.push(...citationLines(2, name.citations, format));
		lines.push(...foldLines(name.extra));
		lines.push(...noteLines(2, name.notes, format));
		isFirst = false;
	}
	return lines;
}

function asXref(id: string): string {
	const pointer = id.startsWith('@') ? id : `@${id}@`;
	// A pointer is a single token; a terminator in an id would forge a line, so it folds to a space.
	return singleLine(pointer) ?? '';
}

/** Where the pedigree of `childId` in `familyId` lives: the family's child entry. */
function pedigreeIndex(data: GedcomExportPayload) {
	const index = new Map<
		string,
		NonNullable<GedcomExportPayload['families'][number]['children']>[number]
	>();
	for (const fam of data.families)
		for (const child of fam.children ?? []) index.set(`${fam.id}|${child.childId}`, child);
	return index;
}

/**
 * The `PEDI` payload for a pedigree, or null to write none. `birth` is the default and is left
 * out unless `isExplicit`; 5.5.1 has no value for `other`, so it is left out there.
 */
function pedigreeToken(
	pedigree: string | null | undefined,
	format: GedcomFormat,
	isExplicit = false
): string | null {
	if (!pedigree || (pedigree === 'birth' && !isExplicit)) return null;
	if (format === 'gedcom7') return pedigree.toUpperCase();
	return pedigree === 'other' ? null : pedigree;
}

/**
 * `1 FAMC` with the child's pedigree beneath it, which is where `PEDI` belongs in both versions.
 * A parent whose pedigree differs from the family's is written as `_PEDI_PARENT`, because a single
 * `PEDI` cannot say "birth to one parent, adopted by the other".
 */
function famcLines(
	familyId: string,
	childId: string,
	index: ReturnType<typeof pedigreeIndex>,
	format: GedcomFormat,
	preserved: PreservedByOwner,
	written: Set<object>
): string[] {
	const lines = [`1 FAMC ${asXref(familyId)}`];
	const link = index.get(`${familyId}|${childId}`);
	const pedigree = pedigreeToken(link?.pedigree, format);
	if (pedigree) lines.push(`2 PEDI ${singleLine(pedigree)}`);
	for (const [parentId, parentPedigree] of Object.entries(link?.parentPedigrees ?? {})) {
		const token = pedigreeToken(parentPedigree, format, true);
		if (token)
			lines.push(`2 ${PARENT_PEDIGREE_TAG} ${asXref(parentId)}`, `3 PEDI ${singleLine(token)}`);
	}
	lines.push(...citationLines(2, link?.citations, format));
	// A child linked to a merged family once per copy has several blocks for one link; write each line once.
	const seen = new Set<string>();
	for (const entry of preserved.get(childId) ?? []) {
		if (!isFamcExtra(entry) || asXref(famcTarget(entry)) !== asXref(familyId)) continue;
		written.add(entry);
		for (const line of entry.lines.slice(1)) {
			const folded = singleLine(line) ?? '';
			if (seen.has(folded)) continue;
			seen.add(folded);
			lines.push(folded);
		}
	}
	lines.push(...noteLines(2, link?.notes, format));
	return lines;
}

/** Preserved lines under a `FAMC`, headed by that `FAMC` line; written inside the link, not after the record. */
function isFamcExtra(entry: { lines: string[] }): boolean {
	return /^1 FAMC\s+\S+/.test(entry.lines[0] ?? '');
}

function famcTarget(entry: { lines: string[] }): string {
	return entry.lines[0].trim().split(/\s+/)[2];
}

/** Each merged-away XREF, kept on the surviving family as a typed `REFN`. */
function aliasLines(aliases: string[] | undefined): string[] {
	return (aliases ?? []).flatMap((alias) => [
		`1 REFN ${escapedSingleLine(alias.replace(/^@|@$/g, ''))}`,
		`2 TYPE ${FAMILY_ALIAS_REFN_TYPE}`
	]);
}

type PreservedByOwner = Map<string | null, NonNullable<GedcomExportPayload['preserved']>>;

/** Grouped once per export: scanning the whole list per record is quadratic on a large import. */
function indexPreserved(preserved: GedcomExportPayload['preserved']): PreservedByOwner {
	const byOwner: PreservedByOwner = new Map();
	for (const entry of preserved ?? []) {
		const group = byOwner.get(entry.xref);
		if (group) group.push(entry);
		else byOwner.set(entry.xref, [entry]);
	}
	return byOwner;
}

/**
 * Append preserved (unmodeled) GEDCOM structures to the output.
 * Structures owned by a specific record are emitted immediately after that
 * record; tree/header-level records are emitted before the trailer.
 *
 * A retained `FAMC` is written inside its link by `famcLines` when the person has one. The rest
 * (a `FAMC @VOID@`, a `FAMC` at a family that is not there or lists no parent) have no link to sit
 * in, so they are written here, under their person, as the file had them.
 */
function appendPreserved(
	lines: string[],
	preserved: PreservedByOwner,
	ownerXref: string | null,
	written: ReadonlySet<object>
): void {
	for (const entry of preserved.get(ownerXref) ?? []) {
		if (!(ownerXref !== null && isFamcExtra(entry) && written.has(entry))) {
			lines.push(...foldLines(entry.lines));
		}
	}
}

/**
 * Root records the file carried that Epoch has no model for (a source, a repository, a shared note,
 * a media record, a submitter), each starting at level 0 with its own XREF. They belong to no
 * person or family, so they are written after the last record, where a reader expects them.
 */
function appendRootRecords(lines: string[], data: GedcomExportPayload, format: GedcomFormat): void {
	for (const source of data.sources ?? []) lines.push(...sourceRecordLines(source, format));
	for (const repository of data.repositories ?? [])
		lines.push(...repositoryRecordLines(repository, format));
	for (const note of data.notes ?? []) lines.push(...sharedNoteLines(note, format));
	for (const entry of data.preserved ?? []) {
		if (entry.xref !== null && entry.lines[0]?.startsWith('0 '))
			lines.push(...foldLines(entry.lines));
	}
}

/** The letter an exported record's xref starts with, by its tag; any other record kind takes `X`. */
const XREF_LETTER_BY_TAG: Readonly<Record<string, string>> = {
	INDI: 'I',
	FAM: 'F',
	SOUR: 'S',
	REPO: 'R',
	NOTE: 'N',
	SNOTE: 'N',
	SUBM: 'U',
	OBJE: 'O'
};

/**
 * What both dialects accept as an xref: upper-case letters, digits and `_` (7.0), at most 20
 * characters (5.5.1). `VOID` is reserved for a pointer at nothing.
 */
const LEGAL_XREF = /^@(?!VOID@)[A-Z0-9_]{1,20}@$/;

const POINTER_PAYLOAD = /^@[^@\s#][^@\s]*@$/;
const RECORD_LINE = /^0 (@[^@\s]+@) (\S+)/;

/**
 * Rewrites every xref in `lines` to one both dialects accept, and every pointer through the same map.
 *
 * It runs over the finished lines, which is the one place that sees all of them: the ids the
 * payload names (a UUID for a record made in Epoch), the pointers inside lines kept verbatim, and
 * a record the file wrote with no xref at all. An xref that is already legal is kept, so a tree
 * imported from `@I500@` exports as `@I500@`; the rest are numbered per record kind (`@I1@`,
 * `@F1@`, `@S1@` ...) in the order the records are written, skipping any number a kept xref holds,
 * so the same tree always exports the same way.
 *
 * A pointer at a record this file does not have is `@VOID@` in 7.0. 5.5.1 has no such value, so it
 * is left as it was. A pointer is told from text by its being the whole payload: model text that
 * begins with `@` is escaped to `@@`, so it can never look like one (ADR-042).
 */
function renumberXrefs(lines: readonly string[], format: GedcomFormat): string[] {
	const defined: Array<{ index: number; xref: string; tag: string }> = [];
	lines.forEach((line, index) => {
		const m = RECORD_LINE.exec(line);
		if (m) defined.push({ index, xref: m[1], tag: m[2] });
	});
	const map = new Map<string, string>();
	const assigned = new Map<number, string>();
	const used = new Set<string>();
	for (const { index, xref } of defined) {
		if (!LEGAL_XREF.test(xref) || used.has(xref)) continue;
		used.add(xref);
		assigned.set(index, xref);
		map.set(xref, xref);
	}
	const counters = new Map<string, number>();
	for (const { index, xref, tag } of defined) {
		if (assigned.has(index)) continue;
		const letter = XREF_LETTER_BY_TAG[tag] ?? 'X';
		let next = counters.get(letter) ?? 0;
		let candidate: string;
		do candidate = `@${letter}${++next}@`;
		while (used.has(candidate));
		counters.set(letter, next);
		used.add(candidate);
		assigned.set(index, candidate);
		// The first record to carry an xref is the one a pointer means.
		if (!map.has(xref)) map.set(xref, candidate);
	}
	// An extension tag's pointer is left as the file wrote it even when nothing here answers to it: the
	// extension may mean a record this file does not carry, and `@VOID@` would change what it says.
	const target = (pointer: string, tag: string) =>
		pointer === '@VOID@' || tag.startsWith('_')
			? (map.get(pointer) ?? pointer)
			: (map.get(pointer) ?? (format === 'gedcom7' ? '@VOID@' : pointer));
	return lines.map((line, index) => {
		const own = assigned.get(index);
		if (own) return line.replace(RECORD_LINE, (_, __, tag) => `0 ${own} ${tag}`);
		const m = /^(\d+) (\S+) (.*)$/.exec(line);
		if (!m || m[2] === 'CONT' || m[2] === 'CONC') return line;
		if (POINTER_PAYLOAD.test(m[3])) return `${m[1]} ${m[2]} ${target(m[3], m[2])}`;
		// The note under a name that says which family it came through names it by its xref.
		if (m[2] === 'NOTE') {
			const change = NAME_CHANGE_NOTE.exec(m[3]);
			if (change?.[2] && map.has(change[2])) return line.replace(change[2], map.get(change[2])!);
		}
		return line;
	});
}

/**
 * Builds GEDCOM 5.5.1 standard text output from tree database models
 */
export function buildGedcom551String(data: GedcomExportPayload): string {
	const lines: string[] = [];
	const pedigrees = pedigreeIndex(data);
	const preserved = indexPreserved(data.preserved);
	const written = new Set<object>();

	// Header
	lines.push('0 HEAD');
	lines.push('1 SOUR EPOCH_GENEALOGY');
	lines.push('2 NAME Epoch Family Genealogy Repository');
	lines.push('2 VERS 1.0');
	lines.push('1 GEDC');
	lines.push('2 VERS 5.5.1');
	lines.push('2 FORM LINEAGE-LINKED');
	lines.push(...headerDateLines(data.exportedAt ?? new Date(), 'gedcom551'));
	if (submitterName(data, 'gedcom551')) lines.push(`1 SUBM ${SUBMITTER_PLACEHOLDER_XREF}`);
	lines.push('1 CHAR UTF-8');
	lines.push(...keptHeaderBlock(data, 'PLAC'));
	if (data.treeName) {
		lines.push(...fieldLines(1, 'NOTE', `Tree: ${data.treeName}`));
	}
	lines.push(...submitterRecord(data, 'gedcom551'));

	// Individuals
	for (const ind of data.individuals) {
		const xref = asXref(ind.id);
		lines.push(`0 ${xref} INDI`);

		lines.push(...nameLines(ind, 'gedcom551'));
		// 5.5.1 has no X. U is the honest standard value, and the custom line lets Epoch read X back.
		if (ind.sex === 'X') {
			lines.push('1 SEX U');
			lines.push(`1 ${SEX_X_TAG} X`);
		} else if (ind.sex) lines.push(`1 SEX ${singleLine(ind.sex)}`);
		lines.push(...privacyLines(ind.privacy, 'privacy'));

		if (ind.events) {
			for (const ev of ind.events) lines.push(...individualEventLines(ev, 'gedcom551'));
		}
		lines.push(...citationLines(1, ind.citations, 'gedcom551'));

		if (ind.famc) {
			for (const f of ind.famc) {
				lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom551', preserved, written));
			}
		}

		if (ind.fams) {
			for (const f of ind.fams) {
				lines.push(`1 FAMS ${asXref(f)}`);
			}
		}
		appendPreserved(lines, preserved, xref, written);
		lines.push(...noteLines(1, ind.notes, 'gedcom551'));
	}

	// Families
	for (const fam of data.families) {
		const xref = asXref(fam.id);
		lines.push(`0 ${xref} FAM`);
		if (fam.husbandId) {
			lines.push(`1 HUSB ${asXref(fam.husbandId)}`);
		}
		if (fam.wifeId) {
			lines.push(`1 WIFE ${asXref(fam.wifeId)}`);
		}
		if (fam.children) {
			for (const child of fam.children) {
				lines.push(`1 CHIL ${asXref(child.childId)}`);
			}
		}
		lines.push(...aliasLines(fam.aliases));
		if (fam.events) {
			for (const ev of fam.events) lines.push(...familyEventLines(ev, 'gedcom551'));
		}
		lines.push(...citationLines(1, fam.citations, 'gedcom551'));
		appendPreserved(lines, preserved, xref, written);
		lines.push(...noteLines(1, fam.notes, 'gedcom551'));
	}

	appendPreserved(lines, preserved, null, written);
	appendRootRecords(lines, data, 'gedcom551');

	// Trailer
	lines.push('0 TRLR');
	return toGedcom551Lines(renumberXrefs(lines, 'gedcom551')).join('\r\n') + '\r\n';
}

/**
 * Builds GEDCOM 7.0 text output.
 *
 * GEDCOM 7 differences honored here: `GEDC.VERS` is `7.0`, the header omits
 * `CHAR` (UTF-8 is mandatory) and documents Epoch's extension tags in `SCHMA`,
 * and `SEX` permits the `X` (non-binary) value. Records and structure otherwise
 * mirror 5.5.1; `toGedcom7Lines` then converts what 7.0 changed at the line
 * level (`CONC`, dates, `@` escaping), in kept lines as much as built ones.
 */
export function buildGedcom7String(data: GedcomExportPayload): string {
	const lines: string[] = [];
	const pedigrees = pedigreeIndex(data);
	const preserved = indexPreserved(data.preserved);
	const written = new Set<object>();

	// Header
	lines.push('0 HEAD');
	lines.push('1 GEDC');
	lines.push('2 VERS 7.0');
	lines.push('1 SOUR EPOCH_GENEALOGY');
	lines.push('2 VERS 1.0');
	lines.push('2 NAME Epoch Family Genealogy Repository');
	lines.push(...headerDateLines(data.exportedAt ?? new Date(), 'gedcom7'));
	if (submitterName(data, 'gedcom7')) lines.push(`1 SUBM ${SUBMITTER_PLACEHOLDER_XREF}`);
	lines.push(...keptHeaderBlock(data, 'LANG'));
	lines.push(...keptHeaderBlock(data, 'PLAC'));
	if (data.treeName) {
		lines.push(...fieldLines(1, 'NOTE', `Tree: ${data.treeName}`));
	}
	lines.push(...submitterRecord(data, 'gedcom7'));

	// Individuals
	for (const ind of data.individuals) {
		const xref = asXref(ind.id);
		lines.push(`0 ${xref} INDI`);

		lines.push(...nameLines(ind, 'gedcom7'));
		if (ind.sex) lines.push(`1 SEX ${singleLine(ind.sex)}`);
		lines.push(...privacyLines(ind.privacy, 'PRIVACY'));

		if (ind.events) {
			for (const ev of ind.events) lines.push(...individualEventLines(ev, 'gedcom7'));
		}
		lines.push(...citationLines(1, ind.citations, 'gedcom7'));

		if (ind.famc) {
			for (const f of ind.famc) {
				lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom7', preserved, written));
			}
		}

		if (ind.fams) {
			for (const f of ind.fams) {
				lines.push(`1 FAMS ${asXref(f)}`);
			}
		}
		appendPreserved(lines, preserved, xref, written);
		lines.push(...noteLines(1, ind.notes, 'gedcom7'));
	}

	// Families
	for (const fam of data.families) {
		const xref = asXref(fam.id);
		lines.push(`0 ${xref} FAM`);
		if (fam.husbandId) {
			lines.push(`1 HUSB ${asXref(fam.husbandId)}`);
		}
		if (fam.wifeId) {
			lines.push(`1 WIFE ${asXref(fam.wifeId)}`);
		}
		if (fam.children) {
			for (const child of fam.children) {
				lines.push(`1 CHIL ${asXref(child.childId)}`);
			}
		}
		lines.push(...aliasLines(fam.aliases));
		if (fam.events) {
			for (const ev of fam.events) lines.push(...familyEventLines(ev, 'gedcom7'));
		}
		lines.push(...citationLines(1, fam.citations, 'gedcom7'));
		appendPreserved(lines, preserved, xref, written);
		lines.push(...noteLines(1, fam.notes, 'gedcom7'));
	}

	appendPreserved(lines, preserved, null, written);
	appendRootRecords(lines, data, 'gedcom7');

	// Trailer
	lines.push('0 TRLR');
	const converted = renumberXrefs(toGedcom7Lines(lines), 'gedcom7');
	// After `GEDC`, which is lines 1 and 2.
	converted.splice(3, 0, ...schemaLines(converted, data.headerBlocks));
	return converted.join('\r\n') + '\r\n';
}

/**
 * `SCHMA` for the extension tags the file defines: the ones an import kept, in the order it had
 * them, then the Epoch tags these lines use. Epoch's URI wins for its own tag. None when there are
 * none.
 */
function schemaLines(lines: readonly string[], kept: readonly string[][] = []): string[] {
	// A tag may be documented at several URIs, so every pair is kept, not one per tag.
	const entries = new Map<string, [string, string]>();
	for (const block of kept) {
		if (!/^1 SCHMA\b/.test(block[0] ?? '')) continue;
		for (const line of block) {
			const m = /^2 TAG (\S+) (\S.*)$/.exec(singleLine(line) ?? '');
			if (m) entries.set(`${m[1]} ${m[2]}`, [m[1], m[2]]);
		}
	}
	const used = new Set<string>();
	for (const line of lines) {
		const tag = line.match(/^\d+ (?:@[^@\s]+@ )?(_\S+)/)?.[1];
		if (tag && EXTENSION_TAG_URIS[tag]) used.add(tag);
	}
	for (const tag of [...used].sort()) {
		for (const [key, [keptTag]] of [...entries]) if (keptTag === tag) entries.delete(key);
		entries.set(`${tag} ${EXTENSION_TAG_URIS[tag]}`, [tag, EXTENSION_TAG_URIS[tag]]);
	}
	if (entries.size === 0) return [];
	return ['1 SCHMA', ...[...entries.values()].map(([tag, uri]) => `2 TAG ${tag} ${uri}`)];
}

/**
 * Serialize export payload using the requested GEDCOM format.
 */
export function buildGedcomString(
	data: GedcomExportPayload,
	format: GedcomFormat = DEFAULT_GEDCOM_FORMAT
): string {
	return format === 'gedcom7' ? buildGedcom7String(data) : buildGedcom551String(data);
}
