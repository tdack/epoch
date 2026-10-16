/**
 * The proof that a command kind may plan over a scoped snapshot (ADR-055, layer b): planning the
 * same commands over the whole tree and over `selectScope(whole, seed)` must give the same ops,
 * summary, labels, preview and, when planning fails, the same error class and message.
 *
 * It runs the code the mutation runner runs (`planFor`, `visibleRows`, `describeOps` with
 * `makeLabeler`, `previewOf`), each side with a fresh deterministic clock, so a difference can only
 * come from the rows. A seed that leaves out something a planner reads shows up here as a different
 * result or a different error.
 */

import { expect } from 'vitest';
import type { DbClient } from '../db';
import { describeOps, type RowOp, type TreeRows } from '../domain/change-log';
import { describeCommand } from '../domain/command-summary';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { makeLabeler } from '../domain/tree-labels';
import { selectScope, type ScopeSeed } from '../domain/write-scope';
import { FOLLOW_UP_WHOLE, seedWithFollowUp } from '../domain/write-scope/follow-up';
import type { ImpactSummary, RecordChange } from '../../shared/impact';
import { MutationRunner, previewOf } from '../services/mutation-runner';
import type { ViewerScope } from '../services/tree-access';
import { TEST_TREE_ID, sequentialIds } from './rows';

const FIXED_NOW_MS = 1_700_000_000_000;

/** What a failure looked like, compared by class and message and nothing else. */
export interface Failure {
	name: string;
	message: string;
}

/** Everything a write shows or stores that comes from planning. */
export interface PlanOutcome {
	ops?: RowOp[];
	summary?: string;
	labels?: RecordChange[];
	preview?: ImpactSummary;
	failure?: Failure;
}

export interface ScopeFor {
	/** An unrestricted viewer: sees everyone. */
	unrestricted: ViewerScope;
	/** A viewer or contributor with no authorship: private people are absent. */
	restricted: ViewerScope;
	/** A contributor, who still sees the people they created while those are private. */
	contributor: ViewerScope;
}

const BASE_SCOPE: ViewerScope = {
	role: 'owner',
	isPublic: false,
	isOutsider: false,
	userId: 'user-1',
	creatorId: null,
	isRestricted: false,
	cutoff: '1950-01-01',
	shouldShowPrivateStructure: false
};

/** The three viewers ADR-055 requires every enabled kind to agree for. */
export function viewerScopes(creatorId = 'creator-1'): ScopeFor {
	return {
		unrestricted: BASE_SCOPE,
		restricted: { ...BASE_SCOPE, role: 'viewer', isRestricted: true },
		contributor: {
			...BASE_SCOPE,
			role: 'contributor',
			userId: creatorId,
			creatorId,
			isRestricted: true
		}
	};
}

function failureOf(error: unknown): Failure {
	return error instanceof Error
		? { name: error.constructor.name, message: error.message }
		: { name: typeof error, message: String(error) };
}

/**
 * Plan over these rows the way a write does. The database is never touched: planning, masking and
 * describing are pure, and the runner only holds the handle, so a stand-in is enough.
 */
export function planOutcome(
	rows: TreeRows,
	commands: RelationshipCommand[],
	scope: ViewerScope,
	options: { headline?: (rows: TreeRows) => string; summary?: (rows: TreeRows) => string } = {}
): PlanOutcome {
	const runner = new MutationRunner({} as DbClient, {
		now: () => FIXED_NOW_MS,
		newId: sequentialIds('new')
	});
	const outcome: PlanOutcome = {};
	try {
		const ops = runner.planFor(TEST_TREE_ID, rows, commands, scope);
		outcome.ops = ops;
		// What the runner writes and shows back is described from the rows the caller may see.
		const seen = runner.visibleRows(rows, scope);
		const sentence = (all: TreeRows) =>
			commands.map((command) => describeCommand(command, all)).join(' ');
		outcome.summary = (options.summary ?? sentence)(seen);
		outcome.labels = describeOps(ops, makeLabeler(seen, ops));
		outcome.preview = previewOf(seen, commands, ops, options.headline ?? sentence);
	} catch (error) {
		outcome.failure = failureOf(error);
	}
	return outcome;
}

export interface EquivalenceInput {
	whole: TreeRows;
	commands: RelationshipCommand[];
	scope: ViewerScope;
	/** The seed the kind under test would use; it may depend on the commands. */
	seed: ScopeSeed | ((commands: RelationshipCommand[]) => ScopeSeed);
	/** Names the case in a failure. */
	label?: string;
	headline?: (rows: TreeRows) => string;
	summary?: (rows: TreeRows) => string;
}

/**
 * The rows the runner would plan over for this seed: the first selection, and the second over the
 * merged seed when the seed opts into a follow-up and the first snapshot has something to follow.
 */
export function selectScopeWithFollowUp(whole: TreeRows, seed: ScopeSeed): TreeRows {
	const first = selectScope(whole, seed);
	const next = seedWithFollowUp(first, seed);
	if (next === FOLLOW_UP_WHOLE) return whole;
	return next ? selectScope(whole, next) : first;
}

/**
 * Asserts the scoped outcome equals the whole-tree outcome, and returns the whole-tree one so a
 * test can also assert the case is not vacuous (a command that fails both ways proves little).
 */
export function expectScopedEqualsWhole(input: EquivalenceInput): PlanOutcome {
	const seed = typeof input.seed === 'function' ? input.seed(input.commands) : input.seed;
	const options = { headline: input.headline, summary: input.summary };
	const whole = planOutcome(input.whole, input.commands, input.scope, options);
	const scoped = planOutcome(
		selectScopeWithFollowUp(input.whole, seed),
		input.commands,
		input.scope,
		options
	);
	expect(scoped, input.label).toEqual(whole);
	return whole;
}
