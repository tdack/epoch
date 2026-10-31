/**
 * The `NAME` line as written, kept beside the name parts that were read from it.
 *
 * The line is rebuilt from the parts on export (ADR-013), which reorders a suffix, adds empty
 * slashes to a name that had none and cannot say "this name had no TYPE". A name the file wrote in
 * another form therefore keeps what it wrote as marker lines at the head of its `gedcom_extra`, so
 * no column and no migration is needed. The markers are level 0, which no sub-line of a `NAME` can
 * be, and are split off before export writes the rest.
 *
 * The original is used only while the parts still build the same canonical line as they did on
 * import. An edit to any part changes the canonical line, and the name is written from its parts.
 */

interface NameValueParts {
	prefix?: string | null;
	givenName?: string | null;
	surnamePrefix?: string | null;
	surname?: string | null;
	suffix?: string | null;
}

/** The `NAME` payload Epoch writes for these parts. */
export function canonicalNameValue(parts: NameValueParts): string {
	const given = [parts.prefix, parts.givenName].filter(Boolean).join(' ');
	const surname = [parts.surnamePrefix, parts.surname].filter(Boolean).join(' ');
	return `${given} /${surname}/${parts.suffix ? ` ${parts.suffix}` : ''}`.trim();
}

const RAW_MARKER = '0 _NAME_RAW ';
const CANON_MARKER = '0 _NAME_CANON ';
const UNTYPED_MARKER = '0 _NAME_UNTYPED';
const LINE_ONLY_MARKER = '0 _NAME_LINE_ONLY';

interface NameMarkers {
	/** The `NAME` payload as the file wrote it, when it was not the canonical form. */
	rawValue?: string;
	/** What the parts built on import; the raw payload is written only while that is still true. */
	canonValue?: string;
	/** The file's `NAME` had no `TYPE`, though it is not the first, which reads back as `aka`. */
	isUntyped?: boolean;
	/** The file gave the name on the `NAME` line alone, with no `GIVN`, `SURN` or other part sub-lines. */
	isLineOnly?: boolean;
}

const isSingleLine = (s: string) => !/[\r\n]/.test(s);

/** The marker lines for a name read from a file; empty when the canonical form says it all. */
export function nameMarkerLines(markers: NameMarkers): string[] {
	const lines: string[] = [];
	let hasRaw = false;
	if (
		markers.rawValue &&
		markers.canonValue !== undefined &&
		markers.rawValue !== markers.canonValue &&
		isSingleLine(markers.rawValue) &&
		isSingleLine(markers.canonValue)
	) {
		lines.push(RAW_MARKER + markers.rawValue, CANON_MARKER + markers.canonValue);
		hasRaw = true;
	}
	if (markers.isUntyped) lines.push(UNTYPED_MARKER);
	if (markers.isLineOnly && hasRaw) lines.push(LINE_ONLY_MARKER);
	return lines;
}

/** Separates the marker lines from the real sub-lines of a stored `gedcom_extra`. */
export function splitNameMarkers(extra: string[] | null | undefined): {
	extra: string[];
} & NameMarkers {
	const out: NameMarkers = {};
	const rest: string[] = [];
	for (const line of extra ?? []) {
		if (line.startsWith(RAW_MARKER)) out.rawValue = line.slice(RAW_MARKER.length);
		else if (line.startsWith(CANON_MARKER)) out.canonValue = line.slice(CANON_MARKER.length);
		else if (line === UNTYPED_MARKER) out.isUntyped = true;
		else if (line === LINE_ONLY_MARKER) out.isLineOnly = true;
		else rest.push(line);
	}
	return { ...out, extra: rest };
}
