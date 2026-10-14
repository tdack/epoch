import { toGedcom551Lines, toGedcom7Lines } from './dialect';
import { escapedSingleLine, fieldLines, keptLines, LINE_BREAK, singleLine } from './evidence-lines';
import { levelOfLine } from './node';
import { ValidationError } from '../domain/errors';
import {
	DEFAULT_GEDCOM_FORMAT,
	EXTENSION_TAG_URIS,
	FAMILY_ALIAS_REFN_TYPE,
	type GedcomFormat,
	LEGACY_MARRIED_NAME_TAG,
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
	if (ev.dateRaw) lines.push(`2 DATE ${singleLine(ev.dateRaw)}`);
	lines.push(...placeLines(ev));
	lines.push(...addressAndContactLines(ev));
	if (ev.cause) lines.push(`2 CAUS ${escapedSingleLine(ev.cause)}`);
	if (ev.age) lines.push(`2 AGE ${escapedSingleLine(ev.age)}`);
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
	const lines = [`1 ${requireSingleLineToken(ev.type, 'An event type')}`];
	if (ev.classification) lines.push(`2 TYPE ${escapedSingleLine(ev.classification)}`);
	if (ev.dateRaw) lines.push(`2 DATE ${singleLine(ev.dateRaw)}`);
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
	const names: ExportName[] =
		ind.names && ind.names.length > 0
			? ind.names
			: [{ type: 'birth', givenName: ind.givenName, surname: ind.surname }];
	const lines: string[] = [];
	const line = (name: ExportName) => {
		const given = [name.prefix, name.givenName].filter(Boolean).join(' ');
		const surname = [name.surnamePrefix, name.surname].filter(Boolean).join(' ');
		return `${given} /${surname}/${name.suffix ? ` ${name.suffix}` : ''}`.trim();
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
		lines.push(`1 NAME ${escapedSingleLine(line(name))}`);
		if (!(isFirst && name.type === 'birth')) {
			const { token, phrase } = nameTypeTokens(name, format);
			lines.push(`2 TYPE ${escapedSingleLine(token)}`);
			if (phrase) lines.push(`3 PHRASE ${escapedSingleLine(phrase)}`);
		}
		if (name.prefix) lines.push(`2 NPFX ${escapedSingleLine(name.prefix)}`);
		if (name.givenName) lines.push(`2 GIVN ${escapedSingleLine(name.givenName)}`);
		if (name.nickname) lines.push(`2 NICK ${escapedSingleLine(name.nickname)}`);
		if (name.surnamePrefix) lines.push(`2 SPFX ${escapedSingleLine(name.surnamePrefix)}`);
		if (name.surname) lines.push(`2 SURN ${escapedSingleLine(name.surname)}`);
		if (name.suffix) lines.push(`2 NSFX ${escapedSingleLine(name.suffix)}`);
		const note = nameChangeNote(name.dateText, name.unionXref);
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
	preserved: GedcomExportPayload['preserved']
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
	const written = new Set<string>();
	for (const entry of preserved ?? []) {
		if (
			entry.xref !== childId ||
			!isFamcExtra(entry) ||
			asXref(famcTarget(entry)) !== asXref(familyId)
		)
			continue;
		for (const line of entry.lines.slice(1)) {
			const folded = singleLine(line) ?? '';
			if (written.has(folded)) continue;
			written.add(folded);
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

/**
 * Append preserved (unmodeled) GEDCOM structures to the output.
 * Structures owned by a specific record are emitted immediately after that
 * record; tree/header-level records are emitted before the trailer.
 */
function appendPreserved(
	lines: string[],
	preserved: Array<{ xref: string | null; lines: string[] }> | undefined,
	ownerXref: string | null
): void {
	if (!preserved) return;
	for (const entry of preserved) {
		if (entry.xref === ownerXref && !(ownerXref !== null && isFamcExtra(entry))) {
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

/**
 * Builds GEDCOM 5.5.1 standard text output from tree database models
 */
export function buildGedcom551String(data: GedcomExportPayload): string {
	const lines: string[] = [];
	const pedigrees = pedigreeIndex(data);

	// Header
	lines.push('0 HEAD');
	lines.push('1 SOUR EPOCH_GENEALOGY');
	lines.push('2 NAME Epoch Family Genealogy Repository');
	lines.push('2 VERS 1.0');
	lines.push('1 GEDC');
	lines.push('2 VERS 5.5.1');
	lines.push('2 FORM LINEAGE-LINKED');
	lines.push('1 CHAR UTF-8');
	if (data.treeName) {
		lines.push(...fieldLines(1, 'NOTE', `Tree: ${data.treeName}`));
	}

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
				lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom551', data.preserved));
			}
		}

		if (ind.fams) {
			for (const f of ind.fams) {
				lines.push(`1 FAMS ${asXref(f)}`);
			}
		}
		appendPreserved(lines, data.preserved, xref);
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
		appendPreserved(lines, data.preserved, xref);
		lines.push(...noteLines(1, fam.notes, 'gedcom551'));
	}

	appendPreserved(lines, data.preserved, null);
	appendRootRecords(lines, data, 'gedcom551');

	// Trailer
	lines.push('0 TRLR');
	return toGedcom551Lines(lines).join('\r\n') + '\r\n';
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

	// Header
	lines.push('0 HEAD');
	lines.push('1 GEDC');
	lines.push('2 VERS 7.0');
	lines.push('1 SOUR EPOCH_GENEALOGY');
	lines.push('2 VERS 1.0');
	if (data.treeName) {
		lines.push(...fieldLines(1, 'NOTE', `Tree: ${data.treeName}`));
	}

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
				lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom7', data.preserved));
			}
		}

		if (ind.fams) {
			for (const f of ind.fams) {
				lines.push(`1 FAMS ${asXref(f)}`);
			}
		}
		appendPreserved(lines, data.preserved, xref);
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
		appendPreserved(lines, data.preserved, xref);
		lines.push(...noteLines(1, fam.notes, 'gedcom7'));
	}

	appendPreserved(lines, data.preserved, null);
	appendRootRecords(lines, data, 'gedcom7');

	// Trailer
	lines.push('0 TRLR');
	const converted = toGedcom7Lines(lines);
	// After `GEDC`, which is lines 1 and 2.
	converted.splice(3, 0, ...schemaLines(converted));
	return converted.join('\r\n') + '\r\n';
}

/** `SCHMA` for the extension tags Epoch defines that these lines use; none when they use none. */
function schemaLines(lines: readonly string[]): string[] {
	const used = new Set<string>();
	for (const line of lines) {
		const tag = line.match(/^\d+ (?:@[^@\s]+@ )?(_\S+)/)?.[1];
		if (tag && EXTENSION_TAG_URIS[tag]) used.add(tag);
	}
	if (used.size === 0) return [];
	return ['1 SCHMA', ...[...used].sort().map((tag) => `2 TAG ${tag} ${EXTENSION_TAG_URIS[tag]}`)];
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
