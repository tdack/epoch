import type { RelationshipCommand } from '../relationship-commands';
import type { ScopeSeed } from '../write-scope';

export type CommandKind = RelationshipCommand['kind'];

/** The command with this kind, so a seed function reads its fields without casts. */
type CommandOf<K extends CommandKind> = Extract<RelationshipCommand, { kind: K }>;

/**
 * A command kind's seed: the records it reads (ADR-055). `isRestricted` is whether the caller has
 * private people hidden; a kind may read less for one who sees everything. A kind with no entry loads the whole
 * tree. An entry may only be added together with an equivalence test (`expectScopedEqualsWhole`)
 * that passes for an unrestricted, a restricted and a contributor-creator viewer.
 */
export type ScopeTable = Partial<{
	[K in CommandKind]: (command: CommandOf<K>, isRestricted: boolean) => ScopeSeed;
}>;
