/**
 * D1 limits a single query to 100 bound parameters, so a batch insert is chunked by row count times
 * column count, never by row count alone. 70 leaves margin for schema defaults and extra columns.
 */
const MAX_BOUND_PARAMS = 70;

export function chunkByParamLimit<T>(rows: T[], columnsPerRow: number): T[][] {
	const maxRows = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columnsPerRow));
	const chunks: T[][] = [];
	for (let i = 0; i < rows.length; i += maxRows) {
		chunks.push(rows.slice(i, i + maxRows));
	}
	return chunks;
}
