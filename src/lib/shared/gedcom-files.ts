/** What a GEDCOM file picker offers: plain GEDCOM in either extension, and a GEDZip archive. */
export const GEDCOM_FILE_ACCEPT = '.ged,.gedcom,.gdz';

/**
 * Whether a dropped file looks like GEDCOM. By name only, as the picker's `accept` is: browsers give
 * these files no reliable media type, and the server reads the content anyway.
 */
export function isGedcomFileName(name: string): boolean {
	return /\.(ged|gedcom|gdz)$/i.test(name);
}
