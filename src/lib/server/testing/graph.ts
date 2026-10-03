import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { maskRows } from '../domain/privacy-mask';
import { graphFromRows, type RelationshipGraph } from '../domain/relationship-graph';
import { MutationRunner } from '../services/mutation-runner';

/**
 * Every person, union and parent-child link of a tree, masked as the viewer's window is. Only
 * tests that assert on the whole graph want this; no screen or endpoint loads a whole tree, which
 * is why it lives here and not on a service.
 */
export async function wholeGraph(
	db: DbClient,
	treeId: string,
	context: AuthenticatedContext
): Promise<RelationshipGraph> {
	const runner = new MutationRunner(db);
	const scope = await runner.scopeFor(treeId, context, 'tree:view');
	const rows = await runner.store.loadRows(treeId);
	if (!scope.isRestricted) return graphFromRows(rows);
	const { rows: masked, placeholderIds } = maskRows(
		rows,
		scope.cutoff,
		scope.shouldShowPrivateStructure,
		scope.creatorId
	);
	return graphFromRows(masked, placeholderIds);
}
