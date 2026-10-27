/** A cell as the report shows it; null is an empty cell. */
type CsvCell = string | number | null;

/**
 * A spreadsheet reads a cell that starts with one of these as a formula, and a family tree holds
 * text typed by other people, so such a cell is made text with a leading apostrophe.
 */
const FORMULA_START = /^[=+\-@]/;

function csvCell(cell: CsvCell): string {
	let text = cell === null ? '' : String(cell);
	if (FORMULA_START.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180: comma separated, CRLF line ends, cells quoted when they hold a comma, quote or line break. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
	return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
