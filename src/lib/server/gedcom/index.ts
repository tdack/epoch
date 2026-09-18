import { parseDateValue } from '../domain/date-value';

export type GedcomVersion = '5.5.1' | '7.0';

/** Supported GEDCOM dialect labels used by the export `format` parameter. */
export type GedcomFormat = 'gedcom551' | 'gedcom7';

export interface ParsedIndividual {
  id: string; // e.g. @I1@ or I1
  givenName?: string;
  surname?: string;
  sex?: 'M' | 'F' | 'X' | 'U';
  famc?: string[]; // Family where person is child
  fams?: string[]; // Family where person is spouse
  events: ParsedEvent[];
}

export interface ParsedFamily {
  id: string; // e.g. @F1@ or F1
  husbandId?: string;
  wifeId?: string;
  children: { childId: string; pedigree?: 'birth' | 'adopted' | 'foster' }[];
  events: ParsedEvent[];
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
  'MARR', 'DIV', 'ANUL', 'CENS', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF',
  'EVEN'
]);

/**
 * Detect the GEDCOM version from the `GEDC.VERS` value in the header.
 * Defaults to 5.5.1 when the version cannot be determined.
 */
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

interface GedcomNode {
  level: number;
  tag: string;
  xref?: string;
  value?: string;
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
  let treeName = 'Imported Family Tree';

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
      const fams: string[] = [];
      const events: ParsedEvent[] = [];

      for (const child of node.children) {
        if (child.tag === 'NAME' && child.value) {
          // GEDCOM format: Given /Surname/
          const slashMatch = child.value.match(/^(.*?)(?:\/([^/]*)\/)?(.*)$/);
          if (slashMatch) {
            givenName = (slashMatch[1] + (slashMatch[3] ? ' ' + slashMatch[3] : '')).trim() || undefined;
            surname = slashMatch[2]?.trim() || undefined;
          } else {
            givenName = child.value.trim();
          }
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
          famc.push(child.value.trim());
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
        }
      }

      individuals.push({
        id,
        givenName,
        surname,
        sex,
        famc,
        fams,
        events
      });
    } else if (node.tag === 'FAM') {
      const id = node.xref || crypto.randomUUID();
      let husbandId: string | undefined;
      let wifeId: string | undefined;
      const children: { childId: string; pedigree?: 'birth' | 'adopted' | 'foster' }[] = [];
      const events: ParsedEvent[] = [];

      for (const child of node.children) {
        if (child.tag === 'HUSB' && child.value) {
          husbandId = child.value.trim();
        } else if (child.tag === 'WIFE' && child.value) {
          wifeId = child.value.trim();
        } else if (child.tag === 'CHIL' && child.value) {
          const pedNode = child.children.find((c) => c.tag === 'PEDI');
          let pedigree: 'birth' | 'adopted' | 'foster' = 'birth';
          const pVal = pedNode?.value?.toLowerCase().trim();
          if (pVal === 'adopted' || pVal === 'foster') pedigree = pVal;

          children.push({ childId: child.value.trim(), pedigree });
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
        }
      }

      families.push({
        id,
        husbandId,
        wifeId,
        children,
        events
      });
    }
  }

  return {
    version: detectGedcomVersion(rawContent),
    individuals,
    families,
    treeName
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
    children?: Array<{ childId: string; pedigree: string | null }>;
    events?: Array<{
      type: string;
      dateRaw: string | null;
      place: string | null;
      description: string | null;
    }>;
  }>;
}

function asXref(id: string): string {
  return id.startsWith('@') ? id : `@${id}@`;
}

/**
 * Builds GEDCOM 5.5.1 standard text output from tree database models
 */
export function buildGedcom551String(data: GedcomExportPayload): string {
  const lines: string[] = [];

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
        lines.push(`1 FAMC ${asXref(f)}`);
      }
    }

    if (ind.fams) {
      for (const f of ind.fams) {
        lines.push(`1 FAMS ${asXref(f)}`);
      }
    }
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
        if (child.pedigree && child.pedigree !== 'birth') {
          lines.push(`2 PEDI ${child.pedigree}`);
        }
      }
    }
    if (fam.events) {
      for (const ev of fam.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }
  }

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
        lines.push(`1 FAMC ${asXref(f)}`);
      }
    }

    if (ind.fams) {
      for (const f of ind.fams) {
        lines.push(`1 FAMS ${asXref(f)}`);
      }
    }
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
        if (child.pedigree && child.pedigree !== 'birth') {
          lines.push(`2 PEDI ${child.pedigree}`);
        }
      }
    }
    if (fam.events) {
      for (const ev of fam.events) {
        lines.push(`1 ${ev.type}`);
        if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
        if (ev.place) lines.push(`2 PLAC ${ev.place}`);
        if (ev.description) lines.push(`2 NOTE ${ev.description}`);
      }
    }
  }

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
