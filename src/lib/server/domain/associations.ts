/**
 * Associations (`ASSO`) are kept as the file wrote them, not modelled (ADR-003), so they are read
 * here from the kept lines each time a page needs them.
 */

import { buildGedcomTree, levelOfLine, type GedcomNode } from '../gedcom/node';

export interface AssociationLine {
	/** The XREF the association points at, as written (`@I5@`). */
	pointer: string;
	/** What the person pointed at was, in plain words ("godfather"); null when the file says nothing. */
	role: string | null;
}

/** GEDCOM 7's `ROLE` values in the words a reader uses. `OTHER` has none of its own: its `PHRASE` says it. */
const ROLE_WORDS: Record<string, string> = {
	CHIL: 'child',
	CLERGY: 'clergy',
	FATH: 'father',
	FRIEND: 'friend',
	GODP: 'godparent',
	HUSB: 'husband',
	MOTH: 'mother',
	MULTIPLE: 'multiple births',
	NGHBR: 'neighbour',
	OFFICIATOR: 'officiator',
	PARENT: 'parent',
	SPOU: 'spouse',
	WIFE: 'wife',
	WITN: 'witness'
};

function roleOf(asso: GedcomNode): string | null {
	const rela = asso.children.find((c) => c.tag === 'RELA')?.value?.trim();
	if (rela) return rela;
	const role = asso.children.find((c) => c.tag === 'ROLE');
	const phrase = role?.children.find((c) => c.tag === 'PHRASE')?.value?.trim();
	if (phrase) return phrase;
	return ROLE_WORDS[role?.value?.trim().toUpperCase() ?? ''] ?? null;
}

/**
 * Every association at the top level of these lines: a person's kept block (`1 ASSO`) or a fact's
 * kept lines (`2 ASSO`). webtrees writes `_ASSO` under a fact, which 5.5.1 does not allow `ASSO`.
 * A pointer at nobody (`@VOID@`) or an escaped `@@` is text, not an association.
 */
export function associationsIn(lines: readonly string[]): AssociationLine[] {
	const levels = lines.map(levelOfLine).filter((level) => level !== null);
	if (levels.length === 0) return [];
	return buildGedcomTree(lines, Math.min(...levels)).flatMap((node) => {
		const pointer = node.rawValue?.trim();
		if (node.tag !== 'ASSO' && node.tag !== '_ASSO') return [];
		if (!pointer || node.isAtEscaped || !/^@[^@\s]+@$/.test(pointer) || pointer === '@VOID@')
			return [];
		return [{ pointer, role: roleOf(node) }];
	});
}
