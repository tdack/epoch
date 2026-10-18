/**
 * Row operations for sub-trees (docs/proposal-subtrees.md): create, edit and delete one, so each
 * is logged and a delete is undoable like any other change. A merge repoints the sub-trees rooted at
 * the person merged away in `person-merge.ts`.
 */

import type { RowOp, SubtreeRow, TreeRows } from './change-log';
import { ConcurrencyConflictError, NotFoundError, ValidationError } from './errors';
import { isValidTreeSlug } from '../../shared/tree-slug';
import { MAX_SUBTREE_NAME_LENGTH, type UpdateSubtreeInput } from '../../shared/subtrees';

export type SubtreeCommand =
	| {
			kind: 'create_subtree';
			subtreeId: string;
			name: string;
			slug: string;
			rootPersonId: string;
	  }
	| {
			kind: 'update_subtree';
			subtreeId: string;
			subtree: Omit<UpdateSubtreeInput, 'version'>;
			expectedVersion?: number;
	  }
	| { kind: 'delete_subtree'; subtreeId: string; expectedVersion?: number };

export interface SubtreeContext {
	treeId: string;
	/** Epoch milliseconds, stamped on every row written. */
	now: number;
	/** The user making the change, recorded as the author of a sub-tree it creates. */
	actorId: string | null;
}

function requireSubtree(rows: TreeRows, id: string): SubtreeRow {
	const subtree = rows.subtrees.find((s) => s.id === id);
	if (!subtree) throw new NotFoundError('Sub-tree', id);
	return subtree;
}

function validateName(value: string): string {
	const name = value.trim();
	if (!name) throw new ValidationError('A sub-tree needs a name.');
	if (name.length > MAX_SUBTREE_NAME_LENGTH)
		throw new ValidationError(`A sub-tree name is at most ${MAX_SUBTREE_NAME_LENGTH} characters.`);
	return name;
}

function validateSlug(rows: TreeRows, slug: string, selfId: string | null): string {
	if (!isValidTreeSlug(slug))
		throw new ValidationError(
			'A sub-tree address is lower-case letters and digits in hyphen-separated words.'
		);
	if (rows.subtrees.some((s) => s.slug === slug && s.id !== selfId))
		throw new ValidationError(`Another sub-tree of this tree already uses the address “${slug}”.`);
	return slug;
}

function requireRoot(rows: TreeRows, personId: string): void {
	if (!rows.individuals.some((p) => p.id === personId)) throw new NotFoundError('Person', personId);
}

function checkVersion(subtree: SubtreeRow, expected: number | undefined): void {
	if (expected === undefined || subtree.version === expected) return;
	throw new ConcurrencyConflictError(
		`This sub-tree was changed by someone else (you had version ${expected}, it is now ${subtree.version}).`,
		{
			reason: 'STALE_VERSION',
			entity: 'subtree',
			id: subtree.id,
			expectedVersion: expected,
			currentVersion: subtree.version,
			current: {
				name: subtree.name,
				slug: subtree.slug,
				rootPersonId: subtree.rootPersonId,
				position: subtree.position
			}
		}
	);
}

export function buildSubtreeOps(
	rows: TreeRows,
	command: SubtreeCommand,
	ctx: SubtreeContext
): RowOp[] {
	switch (command.kind) {
		case 'create_subtree': {
			requireRoot(rows, command.rootPersonId);
			// New ones go last, so creating never reorders the existing list.
			const position = Math.max(-1, ...rows.subtrees.map((s) => s.position)) + 1;
			const row: SubtreeRow = {
				id: command.subtreeId,
				treeId: ctx.treeId,
				name: validateName(command.name),
				slug: validateSlug(rows, command.slug, null),
				rootPersonId: command.rootPersonId,
				position,
				version: 1,
				createdBy: ctx.actorId,
				createdAt: ctx.now,
				updatedAt: ctx.now
			};
			return [{ table: 'subtree', id: row.id, before: null, after: row }];
		}
		case 'update_subtree': {
			const before = requireSubtree(rows, command.subtreeId);
			checkVersion(before, command.expectedVersion);
			const patch = command.subtree;
			if (patch.rootPersonId !== undefined) requireRoot(rows, patch.rootPersonId);
			if (patch.position !== undefined && !Number.isInteger(patch.position))
				throw new ValidationError('A sub-tree position is a whole number.');
			const after: SubtreeRow = {
				...before,
				name: patch.name !== undefined ? validateName(patch.name) : before.name,
				slug: patch.slug !== undefined ? validateSlug(rows, patch.slug, before.id) : before.slug,
				rootPersonId: patch.rootPersonId ?? before.rootPersonId,
				position: patch.position ?? before.position
			};
			if (JSON.stringify(after) === JSON.stringify(before)) return [];
			return [
				{
					table: 'subtree',
					id: before.id,
					before,
					after: { ...after, version: before.version + 1, updatedAt: ctx.now }
				}
			];
		}
		case 'delete_subtree': {
			const subtree = requireSubtree(rows, command.subtreeId);
			checkVersion(subtree, command.expectedVersion);
			return [{ table: 'subtree', id: subtree.id, before: subtree, after: null }];
		}
	}
}

/**
 * Updates that point the sub-trees rooted at `fromId` at `toId`, for the command that folds one
 * person into another. They ride in the merge's own change, so an undo restores them.
 */
export function subtreeRepointOps(
	rows: TreeRows,
	fromId: string,
	toId: string,
	ctx: Pick<SubtreeContext, 'now'>
): RowOp[] {
	return rows.subtrees
		.filter((s) => s.rootPersonId === fromId)
		.map((s): RowOp => ({
			table: 'subtree',
			id: s.id,
			before: s,
			after: { ...s, rootPersonId: toId, version: s.version + 1, updatedAt: ctx.now }
		}));
}
