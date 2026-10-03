import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import { previewNewTree, type ImportMode, type ImportOptions } from '../gedcom/import-preview';
import { parseGedcom } from '../gedcom/parser';
import { GedcomService } from '../services/gedcom-service';

/** Seeds a tree from GEDCOM text with no authorization, as a queued import does. */
export function importGedcomToDb(
	d1: D1Database,
	treeId: string,
	rawGedcom: string,
	treeName?: string,
	mode: ImportMode = 'replace',
	options: ImportOptions = {}
) {
	return new GedcomService(getDb(d1)).runImport(treeId, rawGedcom, treeName, mode, options);
}

/** The payload an export would serialize for a tree. */
export function getTreeExportData(d1: D1Database, treeId: string) {
	return new GedcomService(getDb(d1)).loadExport(treeId);
}

/** What an import of this text into the tree would do, with no authorization. */
export function previewGedcomImport(d1: D1Database, treeId: string, rawGedcom: string) {
	return new GedcomService(getDb(d1)).previewTree(treeId, rawGedcom);
}

/** What importing this text as a new tree would show. */
export function previewGedcomFile(rawGedcom: string) {
	return previewNewTree(parseGedcom(rawGedcom));
}
