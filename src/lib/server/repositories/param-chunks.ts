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

/** A lookup by id list binds one parameter per id plus a few fixed ones, so 90 stays under D1's 100. */
export const IDS_PER_QUERY = 90;

/** Split an id list into runs of at most `size`, for a statement that binds each id `ids per statement` times. */
export function chunkIds<T>(ids: readonly T[], size: number = IDS_PER_QUERY): T[][] {
	const parts: T[][] = [];
	for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size));
	return parts;
}
