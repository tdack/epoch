import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import { GedcomRepository } from '../repositories/gedcom-repository';
import { exportPayloadFrom } from './export-payload';
import {
	previewAgainstTree,
	previewNewTree,
	type ImportMode,
	type ImportOptions,
	type ImportPreview
} from './import-preview';
import { foldIntoExistingAliases, mergeExactDuplicateFamilies } from './duplicate-families';
import { parseGedcom } from './parser';

export type { ImportMode, ImportOptions, ImportPreview };

export function previewGedcomFile(rawGedcom: string): ImportPreview {
	return previewNewTree(parseGedcom(rawGedcom));
}

export async function previewGedcomImport(
	d1: D1Database,
	treeId: string,
	rawGedcom: string
): Promise<ImportPreview> {
	const repo = new GedcomRepository(getDb(d1));
	const fresh = parseGedcom(rawGedcom);
	if (!(await repo.treeExists(treeId))) return previewNewTree(fresh);
	// A family that was merged into another the last time counts as that one, so the counts match what the import will do.
	const parsed = foldIntoExistingAliases(fresh, await repo.aliasesInTree(treeId)).parsed;
	return previewAgainstTree(treeId, fresh, parsed, await repo.previewRows(treeId));
}

export async function importGedcomToDb(
	d1: D1Database,
	treeId: string,
	rawGedcom: string,
	treeName?: string,
	mode: ImportMode = 'replace',
	options: ImportOptions = {}
): Promise<{
	individualsCount: number;
	familiesCount: number;
	eventsCount: number;
	mergedFamiliesCount: number;
}> {
	const repo = new GedcomRepository(getDb(d1));
	const folded = options.shouldMergeDuplicateFamilies
		? mergeExactDuplicateFamilies(parseGedcom(rawGedcom))
		: { parsed: parseGedcom(rawGedcom), mergedCount: 0 };
	let parsed = folded.parsed;
	const isExistingTree = await repo.treeExists(treeId);
	if (isExistingTree && mode === 'merge') {
		// A family merged into another in an earlier import must not come back under its old XREF.
		parsed = foldIntoExistingAliases(parsed, await repo.aliasesInTree(treeId)).parsed;
	}
	const written = await repo.writeImport({ treeId, treeName, parsed, mode, isExistingTree });
	return { ...written, mergedFamiliesCount: folded.mergedCount };
}

export async function getTreeExportData(d1: D1Database, treeId: string) {
	return exportPayloadFrom(treeId, await new GedcomRepository(getDb(d1)).loadExportRows(treeId));
}
