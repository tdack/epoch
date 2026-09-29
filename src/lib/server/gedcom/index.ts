import { parseDateValue } from '../domain/date-value';

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

export interface ParsedIndividual {
  id: string; // e.g. @I1@ or I1
  givenName?: string;
  surname?: string;
  sex?: 'M' | 'F' | 'X' | 'U';
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
  description?: string;
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
      let givenName: string | undefined;
      let surname: string | undefined;
      let sex: 'M' | 'F' | 'X' | 'U' = 'U';
      const famc: string[] = [];
      const famcLinks: ParsedFamcLink[] = [];
      const fams: string[] = [];
      const events: ParsedEvent[] = [];

      for (const child of node.children) {
        if (child.tag === 'NAME' && child.value) {
          ({ givenName, surname } = parseGedcomNameValue(child.value));
          // Check child nodes for GIVN and SURN (present in both 5.5.1 and 7.0)
          const givn = child.children.find((c) => c.tag === 'GIVN');
          const surn = child.children.find((c) => c.tag === 'SURN');
          if (givn?.value) givenName = givn.value.trim();
          if (surn?.value) surname = surn.value.trim();
        } else if (child.tag === 'SEX') {
          const val = child.value?.toUpperCase().trim();
          if (val === 'M' || val === 'F' || val === 'X') sex = val;
          else sex = 'U';
        } else if (child.tag === 'FAMC' && child.value) {
          const familyId = child.value.trim();
          famc.push(familyId);
          const parentPedigrees: Record<string, Pedigree> = {};
          for (const sub of child.children) {
            const parentPedigree = sub.tag === PARENT_PEDIGREE_TAG && sub.value ? parsePedigree(sub.children.find((c) => c.tag === 'PEDI')?.value) : undefined;
            if (parentPedigree) parentPedigrees[sub.value!.trim()] = parentPedigree;
          }
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
          const descNode = child.children.find((c) => c.tag === 'CAUS' || c.tag === 'NOTE');
          const { raw, sort, sortEnd } = normalizeGedcomDate(dateNode?.value);

          events.push({
            type: child.tag,
            dateRaw: raw,
            dateSort: sort,
            dateSortEnd: sortEnd,
            place: placNode?.value?.trim(),
            description: descNode?.value?.trim() || child.value?.trim()
          });
        } else {
          // Preserve unmodeled individual-level structures (CHAN, NOTE, SOUR,
          // OBJE, REFN, ASSO, custom tags, etc.) verbatim.
          preserved.push({ xref: id, lines: collectLines(child) });
        }
      }

      individuals.push({
        id,
        givenName,
        surname,
        sex,
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
export interface GedcomExportPayload {
  treeName?: string;
  individuals: Array<{
    id: string;
    givenName: string | null;
    surname: string | null;
    sex: string | null;
    events?: Array<{
      type: string;
      dateRaw: string | null;
      place: string | null;
      description: string | null;
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
function famcLines(familyId: string, childId: string, index: ReturnType<typeof pedigreeIndex>, format: GedcomFormat): string[] {
  const lines = [`1 FAMC ${asXref(familyId)}`];
  const link = index.get(`${familyId}|${childId}`);
  const pedigree = pedigreeToken(link?.pedigree, format);
  if (pedigree) lines.push(`2 PEDI ${pedigree}`);
  for (const [parentId, parentPedigree] of Object.entries(link?.parentPedigrees ?? {})) {
    const token = pedigreeToken(parentPedigree, format, true);
    if (token) lines.push(`2 ${PARENT_PEDIGREE_TAG} ${asXref(parentId)}`, `3 PEDI ${token}`);
  }
  return lines;
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
    if (entry.xref === ownerXref) {
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

    const given = ind.givenName || '';
    const sur = ind.surname || '';
    lines.push(`1 NAME ${given} /${sur}/`.trim());
    if (given) lines.push(`2 GIVN ${given}`);
    if (sur) lines.push(`2 SURN ${sur}`);
    if (ind.sex) lines.push(`1 SEX ${ind.sex}`);

    if (ind.events) {
      for (const ev of ind.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }

    if (ind.famc) {
      for (const f of ind.famc) {
        lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom551'));
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

    const given = ind.givenName || '';
    const sur = ind.surname || '';
    lines.push(`1 NAME ${given} /${sur}/`.trim());
    if (given) lines.push(`2 GIVN ${given}`);
    if (sur) lines.push(`2 SURN ${sur}`);
    if (ind.sex) lines.push(`1 SEX ${ind.sex}`);

    if (ind.events) {
      for (const ev of ind.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }

    if (ind.famc) {
      for (const f of ind.famc) {
        lines.push(...famcLines(f, ind.id, pedigrees, 'gedcom7'));
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
