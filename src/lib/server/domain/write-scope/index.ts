/**
 * Which records each command kind reads, by domain (ADR-055). `seedFor` is what the mutation
 * runner asks: a seed when every command in the request has one, else null and the whole tree.
 */

import type { RelationshipCommand } from '../relationship-commands';
import { emptySeed, mergeSeeds, type ScopeSeed } from '../write-scope';
import { EVIDENCE_SCOPES } from './evidence';
import { PERSON_SCOPES } from './person';
import type { CommandKind, ScopeTable } from './types';
import { UNION_SCOPES } from './union';

const SCOPES: ScopeTable[] = [PERSON_SCOPES, EVIDENCE_SCOPES, UNION_SCOPES];

/** One table per kind: a kind named in two domains would silently take the first, so refuse it. */
function seedFunctionFor(kind: CommandKind) {
	const found = SCOPES.filter((table) => table[kind]);
	if (found.length > 1) throw new Error(`Command kind '${kind}' has a scope in two domains`);
	return found[0]?.[kind] as ((command: RelationshipCommand) => ScopeSeed) | undefined;
}

/** The union of the commands' seeds, or null when any of them must load the whole tree. */
export function seedFor(commands: readonly RelationshipCommand[]): ScopeSeed | null {
	if (commands.length === 0) return null;
	let seed = emptySeed();
	for (const command of commands) {
		const seedOfCommand = seedFunctionFor(command.kind);
		if (!seedOfCommand) return null;
		seed = mergeSeeds(seed, seedOfCommand(command));
	}
	return seed;
}
