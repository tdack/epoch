/** Grouping of change records for a list in a dialog, in the order a person reads them. */

import type { RecordChange } from './impact';

export const ENTITY_ORDER = [
	'person',
	'name',
	'union',
	'partner',
	'link',
	'event',
	'media',
	'source',
	'repository',
	'source_link',
	'citation',
	'note',
	'note_link',
	'task'
] as const;

export function groupRecords(
	records: RecordChange[]
): Array<{ entityType: string; records: RecordChange[] }> {
	return ENTITY_ORDER.map((entityType) => ({
		entityType,
		records: records.filter((r) => r.entityType === entityType)
	})).filter((g) => g.records.length > 0);
}
