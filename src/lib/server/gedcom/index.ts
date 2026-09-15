export interface ParsedIndividual {
  id: string; // e.g. @I1@ or I1
  givenName?: string;
  surname?: string;
  sex?: 'M' | 'F' | 'U';
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
  type: 'BIRT' | 'DEAT' | 'MARR' | 'DIV' | 'BAPM' | 'BURI';
  dateRaw?: string;
  dateSort?: string;
  place?: string;
  description?: string;
}

export interface ParsedGedcomData {
  individuals: ParsedIndividual[];
  families: ParsedFamily[];
  treeName?: string;
}

interface GedcomNode {
  level: number;
  tag: string;
  xref?: string;
  value?: string;
  children: GedcomNode[];
}

/**
 * Standardize dates into YYYY-MM-DD for indexing if possible
 */
export function normalizeGedcomDate(dateStr?: string): { raw?: string; sort?: string } {
  if (!dateStr || !dateStr.trim()) return {};
  const raw = dateStr.trim();

  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
  };

  // e.g. 15 JAN 1920 or JAN 1920 or 1920 or ABT 1920
  const clean = raw.toUpperCase().replace(/(ABT|BEF|AFT|BET|AND|FROM|TO|CAL|EST)\s+/g, '');
  const dayMonthYear = clean.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})$/);
  if (dayMonthYear) {
    const day = dayMonthYear[1].padStart(2, '0');
    const month = months[dayMonthYear[2]] || '01';
    const year = dayMonthYear[3].padStart(4, '0');
    return { raw, sort: `${year}-${month}-${day}` };
  }

  const monthYear = clean.match(/^([A-Z]{3})\s+(\d{3,4})$/);
  if (monthYear) {
    const month = months[monthYear[1]] || '01';
    const year = monthYear[2].padStart(4, '0');
    return { raw, sort: `${year}-${month}-01` };
  }

  const yearOnly = clean.match(/(\d{3,4})/);
  if (yearOnly) {
    const year = yearOnly[1].padStart(4, '0');
    return { raw, sort: `${year}-01-01` };
  }

  return { raw };
}

/**
 * Parse GEDCOM 5.5.1 / 7 line into tokens
 */
function parseGedcomLine(line: string): { level: number; xref?: string; tag: string; value?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Regex handles:
  // 0 HEAD
  // 0 @I1@ INDI
  // 1 NAME John /Doe/
  // 2 DATE 12 JAN 1900
  const match = trimmed.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s+(.*))?$/);
  if (!match) return null;

  return {
    level: parseInt(match[1], 10),
    xref: match[2],
    tag: match[3].toUpperCase(),
    value: match[4]
  };
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
      let sex: 'M' | 'F' | 'U' = 'U';
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
          // Check child nodes for GIVN and SURN
          const givn = child.children.find((c) => c.tag === 'GIVN');
          const surn = child.children.find((c) => c.tag === 'SURN');
          if (givn?.value) givenName = givn.value.trim();
          if (surn?.value) surname = surn.value.trim();
        } else if (child.tag === 'SEX') {
          const val = child.value?.toUpperCase().trim();
          if (val === 'M' || val === 'F') sex = val;
          else sex = 'U';
        } else if (child.tag === 'FAMC' && child.value) {
          famc.push(child.value.trim());
        } else if (child.tag === 'FAMS' && child.value) {
          fams.push(child.value.trim());
        } else if (['BIRT', 'DEAT', 'BAPM', 'BURI'].includes(child.tag)) {
          const dateNode = child.children.find((c) => c.tag === 'DATE');
          const placNode = child.children.find((c) => c.tag === 'PLAC');
          const descNode = child.children.find((c) => c.tag === 'CAUS' || c.tag === 'NOTE');
          const { raw, sort } = normalizeGedcomDate(dateNode?.value);

          events.push({
            type: child.tag as any,
            dateRaw: raw,
            dateSort: sort,
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
        } else if (['MARR', 'DIV'].includes(child.tag)) {
          const dateNode = child.children.find((c) => c.tag === 'DATE');
          const placNode = child.children.find((c) => c.tag === 'PLAC');
          const { raw, sort } = normalizeGedcomDate(dateNode?.value);

          events.push({
            type: child.tag as any,
            dateRaw: raw,
            dateSort: sort,
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
    individuals,
    families,
    treeName
  };
}

/**
 * Builds GEDCOM 5.5.1 standard text output from tree database models
 */
export function buildGedcom551String(data: {
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
}): string {
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
    const xref = ind.id.startsWith('@') ? ind.id : `@${ind.id}@`;
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
        const fXref = f.startsWith('@') ? f : `@${f}@`;
        lines.push(`1 FAMC ${fXref}`);
      }
    }

    if (ind.fams) {
      for (const f of ind.fams) {
        const fXref = f.startsWith('@') ? f : `@${f}@`;
        lines.push(`1 FAMS ${fXref}`);
      }
    }
  }

  // Families
  for (const fam of data.families) {
    const xref = fam.id.startsWith('@') ? fam.id : `@${fam.id}@`;
    lines.push(`0 ${xref} FAM`);
    if (fam.husbandId) {
      const hXref = fam.husbandId.startsWith('@') ? fam.husbandId : `@${fam.husbandId}@`;
      lines.push(`1 HUSB ${hXref}`);
    }
    if (fam.wifeId) {
      const wXref = fam.wifeId.startsWith('@') ? fam.wifeId : `@${fam.wifeId}@`;
      lines.push(`1 WIFE ${wXref}`);
    }
    if (fam.children) {
      for (const child of fam.children) {
        const cXref = child.childId.startsWith('@') ? child.childId : `@${child.childId}@`;
        lines.push(`1 CHIL ${cXref}`);
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
