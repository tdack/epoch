import {
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
		events?: Array<{
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
			gedcomExtra?: string[] | null;
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
/** `RESN` for a private person and the custom line for an explicit public one; nothing for `auto`. */
function privacyLines(privacy: string | null | undefined, restrictionWord: string): string[] {
	if (privacy === 'private') return [`1 RESN ${restrictionWord}`];
	if (privacy === 'public') return [`1 ${PRIVACY_PUBLIC_TAG} public`];
	return [];
}

function individualEventLines(
	ev: NonNullable<GedcomExportPayload['individuals'][number]['events']>[number]
): string[] {
	const lines = [ev.value ? `1 ${ev.type} ${ev.value}` : `1 ${ev.type}`];
	if (ev.dateRaw) lines.push(`2 DATE ${ev.dateRaw}`);
	if (ev.place) lines.push(`2 PLAC ${ev.place}`);
	if (ev.cause) lines.push(`2 CAUS ${ev.cause}`);
	if (ev.age) lines.push(`2 AGE ${ev.age}`);
	const note = ev.notes ?? ev.description;
	if (note) lines.push(`2 NOTE ${note}`);
	lines.push(...(ev.gedcomExtra ?? []));
	return lines;
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
				`1 ${LEGACY_MARRIED_NAME_TAG} ${line({ ...name, prefix: null, surnamePrefix: null, suffix: null })}`
			);
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
	if (pedigree) lines.push(`2 PEDI ${pedigree}`);
	for (const [parentId, parentPedigree] of Object.entries(link?.parentPedigrees ?? {})) {
		const token = pedigreeToken(parentPedigree, format, true);
		if (token) lines.push(`2 ${PARENT_PEDIGREE_TAG} ${asXref(parentId)}`, `3 PEDI ${token}`);
	}
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
	return (aliases ?? []).flatMap((alias) => [
		`1 REFN ${alias.replace(/^@|@$/g, '')}`,
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
			for (const l of entry.lines) lines.push(l);
		}
	}
}

/**
 * Root records the file carried that Epoch has no model for (a source, a repository, a shared note,
 * a media record, a submitter), each starting at level 0 with its own XREF. They belong to no
 * person or family, so they are written after the last record, where a reader expects them.
 */
function appendRootRecords(
	lines: string[],
	preserved: Array<{ xref: string | null; lines: string[] }> | undefined
): void {
	for (const entry of preserved ?? []) {
		if (entry.xref !== null && entry.lines[0]?.startsWith('0 ')) lines.push(...entry.lines);
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
		lines.push(...privacyLines(ind.privacy, 'privacy'));

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
				lines.push(...(ev.gedcomExtra ?? []));
			}
		}
		appendPreserved(lines, data.preserved, xref);
	}

	appendPreserved(lines, data.preserved, null);
	appendRootRecords(lines, data.preserved);

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
		lines.push(...privacyLines(ind.privacy, 'PRIVACY'));

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
				lines.push(...(ev.gedcomExtra ?? []));
			}
		}
		appendPreserved(lines, data.preserved, xref);
	}

	appendPreserved(lines, data.preserved, null);
	appendRootRecords(lines, data.preserved);

	// Trailer
	lines.push('0 TRLR');
	return lines.join('\r\n') + '\r\n';
}

/**
 * Serialize export payload using the requested GEDCOM format.
 */
export function buildGedcomString(
	data: GedcomExportPayload,
	format: GedcomFormat = 'gedcom551'
): string {
	return format === 'gedcom7' ? buildGedcom7String(data) : buildGedcom551String(data);
}
