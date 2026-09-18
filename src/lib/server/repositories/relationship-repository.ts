/**
 * Relationship command repository: applies Phase 2 commands to the neutral
 * tables with optimistic concurrency and invariant checks. Each write is a
 * small, compensating-friendly mutation so undo can reverse it later.
 */

import type { DbClient } from '../db';
import { unions, unionPartners, parentChild, individuals } from '../db/schema';
import { eq, and, like } from 'drizzle-orm';
import type { ParentChild, ParentChildType } from '../domain/genealogy-model';
import type { RelationshipCommand } from '../domain/relationship-commands';
import { validateParentChildAssertion } from '../domain/invariants';
import { ValidationError, NotFoundError } from '../domain/errors';

export interface DuplicateCandidate {
	id: string;
	givenName: string | null;
	surname: string | null;
}

export class RelationshipRepository {
	constructor(private db: DbClient) {}

	/** Search for similarly named people (duplicate cues) within a tree. */
	async searchPeople(treeId: string, query: string): Promise<DuplicateCandidate[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const rows = await this.db
			.select({
				id: individuals.id,
				givenName: individuals.givenName,
				surname: individuals.surname
			})
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), like(individuals.givenName, `%${trimmed}%`)))
			.all();

		// Also match on surname for a broader duplicate cue.
		const surnameRows = await this.db
			.select({
				id: individuals.id,
				givenName: individuals.givenName,
				surname: individuals.surname
			})
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), like(individuals.surname, `%${trimmed}%`)))
			.all();

		const byId = new Map<string, DuplicateCandidate>();
		for (const r of [...rows, ...surnameRows]) {
			if (!byId.has(r.id)) byId.set(r.id, r);
		}
		return [...byId.values()];
	}

	/** Load all parent-child assertions for a tree (for invariant checks). */
	async listAssertions(treeId: string): Promise<ParentChild[]> {
		const rows = await this.db
			.select()
			.from(parentChild)
			.where(eq(parentChild.treeId, treeId))
			.all();
		return rows.map((r) => ({
			id: r.id,
			treeId: r.treeId,
			parentId: r.parentId,
			childId: r.childId,
			type: r.type as ParentChildType,
			status: r.status,
			unionId: r.unionId,
			version: r.version,
			createdAt: r.createdAt ?? new Date(),
			updatedAt: r.updatedAt ?? new Date()
		}));
	}

	/** Count the unions a person participates in (for ambiguity cues). */
	async countUnionsForPerson(personId: string): Promise<number> {
		const rows = await this.db
			.select({ id: unionPartners.id })
			.from(unionPartners)
			.where(eq(unionPartners.personId, personId))
			.all();
		return rows.length;
	}

	async applyCommand(treeId: string, command: RelationshipCommand): Promise<void> {
		switch (command.kind) {
			case 'create_union': {
				if (command.personIds.length < 1) {
					throw new ValidationError('A union requires at least one participant');
				}
				const unionId = crypto.randomUUID();
				await this.db.insert(unions).values({ id: unionId, treeId, status: 'active' });

				let order = 0;
				for (const personId of command.personIds) {
					await this.db.insert(unionPartners).values({
						id: crypto.randomUUID(),
						unionId,
						personId,
						order: order++
					});
				}
				return;
			}

			case 'assert_parent_child': {
				const assertions = await this.listAssertions(treeId);
				const violations = validateParentChildAssertion(
					{ parentId: command.parentId, childId: command.childId, type: command.type, unionId: command.unionId },
					treeId,
					assertions,
					assertions
				);
				if (violations.length > 0) {
					throw new ValidationError(violations[0].message);
				}

				await this.db.insert(parentChild).values({
					id: crypto.randomUUID(),
					treeId,
					parentId: command.parentId,
					childId: command.childId,
					type: command.type,
					status: 'active',
					unionId: command.unionId
				});
				return;
			}

			case 'end_union': {
				const union = await this.db
					.select()
					.from(unions)
					.where(and(eq(unions.id, command.unionId), eq(unions.treeId, treeId)))
					.get();
				if (!union) throw new NotFoundError('Union', command.unionId);
				await this.db.update(unions).set({ status: 'ended' }).where(eq(unions.id, command.unionId));
				return;
			}

			case 'remove_parent_child': {
				await this.db
					.delete(parentChild)
					.where(
						and(
							eq(parentChild.parentId, command.parentId),
							eq(parentChild.childId, command.childId),
							eq(parentChild.type, command.type)
						)
					);
				return;
			}
		}
	}
}
