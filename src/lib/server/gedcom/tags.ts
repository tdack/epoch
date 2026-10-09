/**
 * The vocabulary the parser and the serializer share: the dialect labels and the custom tags and
 * note wording Epoch writes and reads back. One home, so the two directions cannot drift apart.
 */

/** Supported GEDCOM dialect labels used by the export `format` parameter. */
export type GedcomFormat = 'gedcom551' | 'gedcom7';

/** What an export writes when no format is asked for. 5.5.1 is kept for programs that cannot read 7.0. */
export const DEFAULT_GEDCOM_FORMAT: GedcomFormat = 'gedcom7';

/** Marks a `REFN` on a `FAM` as the XREF of a family that was merged into it. */
export const FAMILY_ALIAS_REFN_TYPE = 'epoch-merged-family';

/** Epoch's per-parent pedigree under `FAMC`; standard `PEDI` cannot differ between two parents. */
export const PARENT_PEDIGREE_TAG = '_PEDI_PARENT';

/** Carries an `X` sex through a GEDCOM 5.5.1 export, whose `SEX` cannot hold it (ADR-010). */
export const SEX_X_TAG = '_EPOCH_SEX';
/**
 * An explicit "this person is public" override (ADR-015). GEDCOM has `RESN` for restricting a record
 * and nothing for the opposite, so `public` is carried the way X is (`_EPOCH_SEX`): a custom line
 * Epoch reads back and other programs ignore.
 */
export const PRIVACY_PUBLIC_TAG = '_EPOCH_PRIVACY';

/**
 * Marks a name that came from the legacy `_MARNM` tag (ADR-013). It is a married name in the model
 * and is written back as `_MARNM`, not as a second `NAME`, so a round trip does not double it.
 */
export const LEGACY_MARRIED_NAME_TAG = '_MARNM';

/**
 * The note Epoch writes under a `NAME` to say when it came into use and from which family (ADR-013).
 * GEDCOM has no date on a name, so this is the standard place that still reads as prose in any program.
 */
export function nameChangeNote(
	dateText: string | null | undefined,
	unionXref: string | null | undefined
): string | null {
	if (!dateText && !unionXref) return null;
	return `Name in use${dateText ? ` from ${dateText}` : ''}${unionXref ? `${dateText ? ',' : ''} through family ${unionXref}` : ''}.`;
}

export const NAME_CHANGE_NOTE = /^Name in use(?: from (.+?))?(?:,? through family (@[^@\s]+@))?\.$/;

const EXTENSIONS_DOC = 'https://github.com/tdack/epoch/blob/main/docs/gedcom-extensions.md';

/**
 * Where each extension tag Epoch defines is documented, for a 7.0 header's `SCHMA`. Tags kept from
 * another program's file are not listed: Epoch does not know their URIs, and 7.0 allows an
 * undocumented extension tag. `_EPOCH_SEX` is absent because only a 5.5.1 export writes it.
 */
export const EXTENSION_TAG_URIS: Readonly<Record<string, string>> = {
	[PARENT_PEDIGREE_TAG]: `${EXTENSIONS_DOC}#_pedi_parent`,
	[PRIVACY_PUBLIC_TAG]: `${EXTENSIONS_DOC}#_epoch_privacy`
};
