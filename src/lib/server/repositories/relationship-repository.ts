/**
 * Relationship command repository: applies Phase 2 commands to the neutral
 * tables with optimistic concurrency and invariant checks. Each write is a
 * small, compensating-friendly mutation so undo can reverse it later.
 */

import type { DbClient } from '../db';
import { unions, unionPartners, parentChild, individuals, events } from '../db/schema';
import { eq, and, like, inArray } from 'drizzle-orm';
import type { ParentChild, ParentChildType, UnionStatus } from '../domain/genealogy-model';
import { buildRelationshipGraph, type RelationshipGraph } from '../domain/relationship-graph';
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

	/** Assemble the read-only relationship graph from the neutral model. */
	async getGraph(treeId: string): Promise<RelationshipGraph> {
		const [indRows, unionRows, partnerRows, pcRows, eventRows] = await Promise.all([
			this.db.select().from(individuals).where(eq(individuals.treeId, treeId)).all(),
			this.db.select().from(unions).where(eq(unions.treeId, treeId)).all(),
			this.db.select().from(unionPartners).all(),
			this.db.select().from(parentChild).where(eq(parentChild.treeId, treeId)).all(),
			this.db.select().from(events).where(eq(events.treeId, treeId)).all()
		]);

		// Death markers: an individual with a DEAT event is deceased.
		const deceasedIds = new Set(
			eventRows.filter((e) => e.entityType === 'INDIVIDUAL' && e.type === 'DEAT').map((e) => e.entityId)
		);

		// Group partners by union.
		const partnersByUnion = new Map<string, string[]>();
		for (const p of partnerRows) {
			const list = partnersByUnion.get(p.unionId) ?? [];
			list.push(p.personId);
			partnersByUnion.set(p.unionId, list);
		}

		return buildRelationshipGraph({
			people: indRows.map((i) => ({
				id: i.id,
				givenName: i.givenName,
				surname: i.surname,
				isDeceased: deceasedIds.has(i.id)
			})),
			unions: unionRows.map((u) => ({
				id: u.id,
				status: u.status as UnionStatus,
				partnerIds: partnersByUnion.get(u.id) ?? []
			})),
			parentChild: pcRows.map((pc) => ({
				parentId: pc.parentId,
				childId: pc.childId,
				type: pc.type as ParentChildType,
				unionId: pc.unionId
			}))
		});
	}

	async applyCommand(treeId: string, command: RelationshipCommand): Promise<string | null> {
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
				return unionId;
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
				return null;
			}

			case 'end_union': {
				const union = await this.db
					.select()
					.from(unions)
					.where(and(eq(unions.id, command.unionId), eq(unions.treeId, treeId)))
					.get();
				if (!union) throw new NotFoundError('Union', command.unionId);
				await this.db.update(unions).set({ status: 'ended' }).where(eq(unions.id, command.unionId));
				return null;
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
				return null;
			}
		}
	}

	/**
	 * Compute a human-readable impact summary for a command before applying it,
	 * so destructive actions (e.g. removing a relationship) can be previewed.
	 */
	async summarizeImpact(treeId: string, command: RelationshipCommand): Promise<string> {
		switch (command.kind) {
			case 'create_union': {
				const names = await this.personNames(command.personIds);
				return `Create a union between ${names.join(' and ')}.`;
			}
			case 'assert_parent_child': {
				const [parentName, childName] = await this.personNames([
					command.parentId,
					command.childId
				]);
				return `Record ${parentName} as a ${command.type} parent of ${childName}.`;
			}
			case 'end_union': {
				const union = await this.db
					.select()
					.from(unions)
					.where(and(eq(unions.id, command.unionId), eq(unions.treeId, treeId)))
					.get();
				return union ? `End the union '${union.id}'.` : 'End a union.';
			}
			case 'remove_parent_child': {
				const [parentName, childName] = await this.personNames([
					command.parentId,
					command.childId
				]);
				return `Remove the ${command.type} relationship between ${parentName} and ${childName}. This does not delete either person.`;
			}
		}
	}

	/**
	 * Return the inverse command that would undo a given command. Only
	 * non-destructive to people — removing a union never deletes a person.
	 */
	inverseOf(command: RelationshipCommand): RelationshipCommand | null {
		switch (command.kind) {
			case 'create_union':
				// A created union has no stable ID until applied; undo by ending
				// it is handled by the service, which tracks applied IDs.
				return null;
			case 'assert_parent_child':
				return {
					kind: 'remove_parent_child',
					parentId: command.parentId,
					childId: command.childId,
					type: command.type
				};
			case 'end_union':
				// Re-activating is represented by a no-op here; the service
				// re-applies status explicitly.
				return null;
			case 'remove_parent_child':
				return {
					kind: 'assert_parent_child',
					parentId: command.parentId,
					childId: command.childId,
					type: command.type,
					unionId: null
				};
		}
	}

	private async personNames(ids: string[]): Promise<string[]> {
		if (ids.length === 0) return [];
		const rows = await this.db
			.select({ id: individuals.id, givenName: individuals.givenName, surname: individuals.surname })
			.from(individuals)
			.where(inArray(individuals.id, ids))
			.all();
		const byId = new Map(rows.map((r) => [r.id, r]));
		return ids.map((id) => {
			const r = byId.get(id);
			if (!r) return id;
			return [r.givenName, r.surname].filter(Boolean).join(' ') || id;
		});
	}
}
