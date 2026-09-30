import { parseDateValue } from '../../shared/date-value';
import type { Sex } from '../../shared/sex';
import { NAME_TYPES, type NameType } from '../domain/genealogy-model';

export type GedcomVersion = '5.5.1' | '7.0';

/** Supported GEDCOM dialect labels used by the export `format` parameter. */
export type GedcomFormat = 'gedcom551' | 'gedcom7';

/**
 * A child's relationship to the parents of a family (`PEDI`). `sealing` and `other` have no
 * neutral parent-child type of their own; they are kept so export can write them back.
 */
export type Pedigree = 'birth' | 'adopted' | 'foster' | 'sealing' | 'other';

/** A child's `FAMC` link with the pedigree it carries; `parentPedigrees` is Epoch's per-parent extension. */
export interface ParsedFamcLink {
  familyId: string;
  pedigree?: Pedigree;
  /** Parent XREF to the pedigree that differs from `pedigree`, from `_PEDI_PARENT`. */
  parentPedigrees?: Record<string, Pedigree>;
}

/** Marks a `REFN` on a `FAM` as the XREF of a family that was merged into it. */
export const FAMILY_ALIAS_REFN_TYPE = 'epoch-merged-family';

/** Epoch's per-parent pedigree under `FAMC`; standard `PEDI` cannot differ between two parents. */
export const PARENT_PEDIGREE_TAG = '_PEDI_PARENT';

/** Carries an `X` sex through a GEDCOM 5.5.1 export, whose `SEX` cannot hold it (ADR-010). */
export const SEX_X_TAG = '_EPOCH_SEX';

/**
 * Marks a name that came from the legacy `_MARNM` tag (ADR-013). It is a married name in the model
 * and is written back as `_MARNM`, not as a second `NAME`, so a round trip does not double it.
 */
export const LEGACY_MARRIED_NAME_TAG = '_MARNM';

/** One `NAME` record of an individual, in file order. The first is the primary name. */
export interface ParsedName {
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

export interface ParsedIndividual {
  id: string; // e.g. @I1@ or I1
  /** The primary (first) name's given name and surname, kept for callers that want one name. */
  givenName?: string;
  surname?: string;
  names?: ParsedName[];
  sex?: Sex;
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
  'BIRT', 'CHR', 'DEAT', 'BURI', 'CREM', 'ADOP', 'BAPM', 'BARM', 'BASM', 'BLES',
  'CHRA', 'CONF', 'FCOM', 'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB', 'WILL',
  'GRAD', 'RETI', 'EVEN', 'DSCR', 'EDUC', 'IDNO', 'NCHI', 'NMR', 'OCCU', 'PROP',
  'RELI', 'RESI', 'SSN', 'TITL', 'FACT'
]);

/** Family-level event tags shared by GEDCOM 5.5.1 and 7.0. */
const FAMILY_EVENT_TAGS = new Set([
  'MARR', 'DIV', 'ANUL', 'CENS', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF', '_PSTART', '_SEPR',
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
  return { givenName: given || undefined, surname: value.slice(open + 1, close).trim() || undefined };
}

export function detectGedcomVersion(rawContent: string): GedcomVersion {
  const lines = rawContent.split(/\r?\n/);
  let inGedc = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^1\s+GEDC$/.test(trimmed)) {
      inGedc = true;
      continue;
    }
    if (inGedc) {
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
export function parsePedigree(value: string | undefined): Pedigree | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  return text === 'birth' || text === 'adopted' || text === 'foster' || text === 'sealing' ? text : 'other';
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
function parseGedcomLine(line: string): { level: number; xref?: string; tag: string; value?: string } | null {
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


const NAME_TYPE_BY_WORD: Record<string, NameType> = Object.fromEntries(Object.values(NAME_TYPES).map((t) => [t, t]));

/** `TYPE` is lowercase in 5.5.1 and uppercase in 7.0; a word that is neither of the known ones is free text. */
export function parseNameType(value: string | undefined, phrase?: string): { type: NameType; gedcomType?: string } {
  const word = value?.trim();
  if (!word) return { type: NAME_TYPES.OTHER };
  const known = NAME_TYPE_BY_WORD[word.toLowerCase()];
  if (known === NAME_TYPES.OTHER) return { type: known, ...(phrase?.trim() ? { gedcomType: phrase.trim() } : {}) };
  if (known) return { type: known };
  return { type: NAME_TYPES.OTHER, gedcomType: word };
}

/**
 * The note Epoch writes under a `NAME` to say when it came into use and from which family (ADR-013).
 * GEDCOM has no date on a name, so this is the standard place that still reads as prose in any program.
 */
export function nameChangeNote(dateText: string | null | undefined, unionXref: string | null | undefined): string | null {
  if (!dateText && !unionXref) return null;
  return `Name in use${dateText ? ` from ${dateText}` : ''}${unionXref ? `${dateText ? ',' : ''} through family ${unionXref}` : ''}.`;
}

const NAME_CHANGE_NOTE = /^Name in use(?: from (.+?))?(?:,? through family (@[^@\s]+@))?\.$/;

const MODELLED_NAME_TAGS = new Set(['TYPE', 'NPFX', 'GIVN', 'NICK', 'SPFX', 'SURN', 'NSFX']);

/**
 * Read one `NAME` record. The line's value supplies what the sub-tags do not; the sub-tags win.
 * A suffix on the line is kept in the given name when there is no `NSFX`, as it always was. An
 * untyped name is birth when it is the first and `aka` after that: GEDCOM says nothing, and a
 * second name is not the one the person was born with.
 */
function parseNameNode(node: GedcomNode, collect: (n: GedcomNode) => string[], isPrimary: boolean): ParsedName {
  const sub = (tag: string) => node.children.find((c) => c.tag === tag)?.value?.trim() || undefined;
  const value = node.value ?? '';
  const open = value.indexOf('/');
  const close = open === -1 ? -1 : value.indexOf('/', open + 1);
  let { givenName, surname } = parseGedcomNameValue(value);
  if (sub('NSFX') && close !== -1) {
    givenName = value.slice(0, open).replace(/\s+/g, ' ').trim() || undefined;
  }
  const prefix = sub('NPFX');
  if (prefix && givenName?.startsWith(`${prefix} `)) givenName = givenName.slice(prefix.length + 1).trim() || undefined;
  const typeNode = node.children.find((c) => c.tag === 'TYPE');
  const surn = sub('SURN');
  const spfx = sub('SPFX');
  // The line writes the surname prefix inside the slashes ("/de la Cruz/"); the column holds it apart.
  if (spfx && !surn && surname?.startsWith(`${spfx} `)) surname = surname.slice(spfx.length + 1).trim() || undefined;
  const changeNode = node.children.find((c) => c.tag === 'NOTE' && c.children.length === 0 && c.value && NAME_CHANGE_NOTE.test(c.value.trim()));
  const change = changeNode ? NAME_CHANGE_NOTE.exec(changeNode.value!.trim()) : null;
  return {
    ...(typeNode ? parseNameType(typeNode.value, typeNode.children.find((c) => c.tag === 'PHRASE')?.value) : { type: isPrimary ? NAME_TYPES.BIRTH : NAME_TYPES.AKA }),
    givenName: sub('GIVN') ?? givenName,
    surname: surn ?? surname,
    prefix,
    suffix: sub('NSFX') ?? undefined,
    nickname: sub('NICK'),
    surnamePrefix: spfx,
    ...(change?.[1] ? { dateText: change[1] } : {}),
    ...(change?.[2] ? { unionXref: change[2] } : {}),
    ...(changeNode ? { changeNoteLine: changeNode.rawLine } : {}),
    extra: node.children.filter((c) => !MODELLED_NAME_TAGS.has(c.tag) && c !== changeNode).flatMap(collect)
  };
}

/** A `_MARNM` value is "Given /Surname/" in some programs and just the surname in others. */
function parseLegacyMarriedName(value: string, primary: ParsedName | undefined): ParsedName {
  const hasSlashes = value.includes('/');
  const parts = hasSlashes ? parseGedcomNameValue(value) : { givenName: primary?.givenName, surname: value.trim() || undefined };
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
        } else if (child.tag === 'FAMC' && child.value) {
          const familyId = child.value.trim();
          famc.push(familyId);
          const parentPedigrees: Record<string, Pedigree> = {};
          for (const sub of child.children) {
            const parentPedigree = sub.tag === PARENT_PEDIGREE_TAG && sub.value ? parsePedigree(sub.children.find((c) => c.tag === 'PEDI')?.value) : undefined;
            if (parentPedigree) parentPedigrees[sub.value!.trim()] = parentPedigree;
          }
          // STAT, NOTE and the like under FAMC have no model. Keep them, headed by their FAMC line,
          // so export writes them back under the same link (ADR-009).
          const extras = child.children.filter((sub) => sub.tag !== 'PEDI' && sub.tag !== PARENT_PEDIGREE_TAG);
          if (extras.length > 0) preserved.push({ xref: id, lines: [child.rawLine, ...extras.flatMap(collectLines)] });
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
          const textOf = (tag: string) => child.children.find((c) => c.tag === tag)?.value?.trim() || undefined;
          const { raw, sort, sortEnd } = normalizeGedcomDate(dateNode?.value);

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
            notes: textOf('NOTE')
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
          const pedigree = parsePedigree(child.children.find((c) => c.tag === 'PEDI')?.value) ?? 'birth';
          children.push({ childId: child.value.trim(), pedigree });
        } else if (child.tag === 'REFN' && child.value && child.children.some((c) => c.tag === 'TYPE' && c.value?.trim() === FAMILY_ALIAS_REFN_TYPE)) {
          const alias = child.value.trim();
          aliases.push(alias.startsWith('@') ? alias : `@${alias}@`);
        } else if (FAMILY_EVENT_TAGS.has(child.tag)) {
          const dateNode = child.children.find((c) => c.tag === 'DATE');
          const placNode = child.children.find((c) => c.tag === 'PLAC');
          const { raw, sort, sortEnd } = normalizeGedcomDate(dateNode?.value);

          events.push({
            type: child.tag,
            dateRaw: raw,
            dateSort: sort,
            dateSortEnd: sortEnd,
            place: placNode?.value?.trim(),
            description: child.value?.trim()
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
  for (const ind of individuals) for (const link of ind.famcLinks ?? []) linkOf.set(`${ind.id}|${link.familyId}`, link);
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

/**
 * Shared payload shape consumed by both the 5.5.1 and 7.0 serializers.
 */
/** One name to write, as stored. The payload lists them preferred first, because GEDCOM's first `NAME` is the primary. */
export interface ExportName {
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
    events?: Array<{
      type: string;
      dateRaw: string | null;
      place: string | null;
      description: string | null;
      value?: string | null;
      cause?: string | null;
      age?: string | null;
      notes?: string | null;
    }>;
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
    }>;
    /** XREFs of families merged into this one; each is written as a typed `REFN`. */
    aliases?: string[];
    events?: Array<{
      type: string;
      dateRaw: string | null;
      place: string | null;
      description: string | null;
    }>;
  }>;
  /** Unmodeled GEDCOM structures to re-emit verbatim, keyed by owner XREF. */
  preserved?: Array<{ xref: string | null; lines: string[] }>;
}

/**
 * An individual's event as GEDCOM lines. The line value goes on the event's own line, and a legacy
 * `description` is written as a note only when the fact has no note of its own, so a fact edited
 * after import does not gain a second `NOTE`.
 */
function individualEventLines(ev: NonNullable<GedcomExportPayload['individuals'][number]['events']>[number]): string[] {
  const lines = [ev.value ? `1 ${ev.type} ${ev.value}` : `1 ${ev.type}`];
  if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
  if (ev.place) lines.push(`2 PLAC ${ev.place}`);
  if (ev.cause) lines.push(`2 CAUS ${ev.cause}`);
  if (ev.age) lines.push(`2 AGE ${ev.age}`);
  const note = ev.notes ?? ev.description;
  if (note) lines.push(`2 NOTE ${note}`);
  return lines;
}


/** The `TYPE` payload of a name, and the `PHRASE` a 7.0 file needs to say a free-text type. */
function nameTypeTokens(name: ExportName, format: GedcomFormat): { token: string; phrase: string | null } {
  if (name.type === 'other' && name.gedcomType) {
    return format === 'gedcom7' ? { token: 'OTHER', phrase: name.gedcomType } : { token: name.gedcomType, phrase: null };
  }
  return { token: format === 'gedcom7' ? name.type.toUpperCase() : name.type, phrase: null };
}

/**
 * The `NAME` records of an individual. `birth` is the default TYPE and is left out of the first
 * (primary) name only: on any later name an untyped record would be read back as `aka`. A name that
 * came from the legacy `_MARNM` tag goes back out as that tag, so a re-read does not see it twice.
 */
function nameLines(ind: GedcomExportPayload['individuals'][number], format: GedcomFormat): string[] {
  const names: ExportName[] = ind.names && ind.names.length > 0 ? ind.names : [{ type: 'birth', givenName: ind.givenName, surname: ind.surname }];
  const lines: string[] = [];
  const line = (name: ExportName) => {
    const given = [name.prefix, name.givenName].filter(Boolean).join(' ');
    const surname = [name.surnamePrefix, name.surname].filter(Boolean).join(' ');
    return `${given} /${surname}/${name.suffix ? ` ${name.suffix}` : ''}`.trim();
  };
  let isFirst = true;
  for (const name of names) {
    if (name.type === 'married' && name.gedcomType === LEGACY_MARRIED_NAME_TAG) {
      lines.push(`1 ${LEGACY_MARRIED_NAME_TAG} ${line({ ...name, prefix: null, surnamePrefix: null, suffix: null })}`);
      continue;
    }
    lines.push(`1 NAME ${line(name)}`);
    if (!(isFirst && name.type === 'birth')) {
      const { token, phrase } = nameTypeTokens(name, format);
      lines.push(`2 TYPE ${token}`);
      if (phrase) lines.push(`3 PHRASE ${phrase}`);
    }
    if (name.prefix) lines.push(`2 NPFX ${name.prefix}`);
    if (name.givenName) lines.push(`2 GIVN ${name.givenName}`);
    if (name.nickname) lines.push(`2 NICK ${name.nickname}`);
    if (name.surnamePrefix) lines.push(`2 SPFX ${name.surnamePrefix}`);
    if (name.surname) lines.push(`2 SURN ${name.surname}`);
    if (name.suffix) lines.push(`2 NSFX ${name.suffix}`);
    const note = nameChangeNote(name.dateText, name.unionXref);
    if (note) lines.push(`2 NOTE ${note}`);
    lines.push(...(name.extra ?? []));
    isFirst = false;
  }
  return lines;
}

function asXref(id: string): string {
  return id.startsWith('@') ? id : `@${id}@`;
}


/** Where the pedigree of `childId` in `familyId` lives: the family's child entry. */
function pedigreeIndex(data: GedcomExportPayload) {
  const index = new Map<string, NonNullable<GedcomExportPayload['families'][number]['children']>[number]>();
  for (const fam of data.families) for (const child of fam.children ?? []) index.set(`${fam.id}|${child.childId}`, child);
  return index;
}

/**
 * The `PEDI` payload for a pedigree, or null to write none. `birth` is the default and is left
 * out unless `isExplicit`; 5.5.1 has no value for `other`, so it is left out there.
 */
function pedigreeToken(pedigree: string | null | undefined, format: GedcomFormat, isExplicit = false): string | null {
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
  if (pedigree) lines.push(`2 PEDI ${pedigree}`);
  for (const [parentId, parentPedigree] of Object.entries(link?.parentPedigrees ?? {})) {
    const token = pedigreeToken(parentPedigree, format, true);
    if (token) lines.push(`2 ${PARENT_PEDIGREE_TAG} ${asXref(parentId)}`, `3 PEDI ${token}`);
  }
  // A child linked to a merged family once per copy has several blocks for one link; write each line once.
  const written = new Set<string>();
  for (const entry of preserved ?? []) {
    if (entry.xref !== childId || !isFamcExtra(entry) || asXref(famcTarget(entry)) !== asXref(familyId)) continue;
    for (const line of entry.lines.slice(1)) {
      if (written.has(line)) continue;
      written.add(line);
      lines.push(line);
    }
  }
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
  return (aliases ?? []).flatMap((alias) => [`1 REFN ${alias.replace(/^@|@$/g, '')}`, `2 TYPE ${FAMILY_ALIAS_REFN_TYPE}`]);
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
      for (const l of entry.lines) lines.push(l);
    }
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
    lines.push(`1 NOTE Tree: ${data.treeName}`);
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
    } else if (ind.sex) lines.push(`1 SEX ${ind.sex}`);

    if (ind.events) {
      for (const ev of ind.events) lines.push(...individualEventLines(ev));
    }

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
      for (const ev of fam.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }
    appendPreserved(lines, data.preserved, xref);
  }

  appendPreserved(lines, data.preserved, null);

  // Trailer
  lines.push('0 TRLR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Builds GEDCOM 7.0 text output.
 *
 * GEDCOM 7 differences honored here: `GEDC.VERS` is `7.0`, the header omits
 * `CHAR` (UTF-8 is mandatory) and uses the `SCHMA` tag, and `SEX` permits the
 * `X` (non-binary) value. Records and structure otherwise mirror 5.5.1.
 */
export function buildGedcom7String(data: GedcomExportPayload): string {
  const lines: string[] = [];
  const pedigrees = pedigreeIndex(data);

  // Header
  lines.push('0 HEAD');
  lines.push('1 GEDC');
  lines.push('2 VERS 7.0');
  lines.push('1 SCHMA');
  lines.push('2 TAG FAM');
  lines.push('2 TAG INDI');
  lines.push('1 SOUR EPOCH_GENEALOGY');
  lines.push('2 VERS 1.0');
  if (data.treeName) {
    lines.push(`1 NOTE Tree: ${data.treeName}`);
  }

  // Individuals
  for (const ind of data.individuals) {
    const xref = asXref(ind.id);
    lines.push(`0 ${xref} INDI`);

    lines.push(...nameLines(ind, 'gedcom7'));
    if (ind.sex) lines.push(`1 SEX ${ind.sex}`);

    if (ind.events) {
      for (const ev of ind.events) lines.push(...individualEventLines(ev));
    }

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
      for (const ev of fam.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }
    appendPreserved(lines, data.preserved, xref);
  }

  appendPreserved(lines, data.preserved, null);

  // Trailer
  lines.push('0 TRLR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Serialize export payload using the requested GEDCOM format.
 */
export function buildGedcomString(data: GedcomExportPayload, format: GedcomFormat = 'gedcom551'): string {
  return format === 'gedcom7' ? buildGedcom7String(data) : buildGedcom551String(data);
}
