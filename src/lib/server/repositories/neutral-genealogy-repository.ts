/**
 * Neutral-model read repository.
 *
 * Reads the Phase 1 neutral tables (`unions`, `union_partners`, `parent_child`,
 * `person_names`) and returns graph-shaped DTOs without gendered assumptions or
 * special-case columns. Parentage is always a set of per-parent assertions;
 * partners are always an ordered participant list.
 */

import type { DbClient } from '../db';
import { unions, unionPartners, parentChild, personNames } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { ParentChildType, UnionStatus } from '../domain/genealogy-model';

export interface PersonDto {
	id: string;
	names: Array<{
		givenName: string | null;
		surname: string | null;
		type: string;
		isPreferred: boolean;
	}>;
	/** Parentage grouped by union context (null key = direct assertion). */
	parentsByUnion: Record<string, Array<{ parentId: string; type: ParentChildType }>>;
	/** Unions this person participates in as a partner. */
	unionIds: string[];
}

export interface UnionDto {
	id: string;
	status: UnionStatus;
	partners: Array<{ personId: string; order: number }>;
	children: Array<{ childId: string; parentId: string; type: ParentChildType }>;
}

export class NeutralGenealogyRepository {
	constructor(private db: DbClient) {}

	async getPerson(treeId: string, personId: string): Promise<PersonDto | null> {
		const names = await this.db
			.select()
			.from(personNames)
			.where(eq(personNames.personId, personId))
			.all();

		const assertions = await this.db
			.select()
			.from(parentChild)
			.where(eq(parentChild.childId, personId))
			.all();

		const parentsByUnion: PersonDto['parentsByUnion'] = {};
		for (const a of assertions) {
			const key = a.unionId ?? '__direct__';
			if (!parentsByUnion[key]) parentsByUnion[key] = [];
			parentsByUnion[key].push({ parentId: a.parentId, type: a.type as ParentChildType });
		}

		const participations = await this.db
			.select({ unionId: unionPartners.unionId })
			.from(unionPartners)
			.where(eq(unionPartners.personId, personId))
			.all();

		if (names.length === 0 && assertions.length === 0 && participations.length === 0) {
			return null;
		}

		return {
			id: personId,
			names: names.map((n) => ({
				givenName: n.givenName,
				surname: n.surname,
				type: n.type,
				isPreferred: n.isPreferred
			})),
			parentsByUnion,
			unionIds: participations.map((p) => p.unionId)
		};
	}

	async getUnion(treeId: string, unionId: string): Promise<UnionDto | null> {
		const union = await this.db.select().from(unions).where(eq(unions.id, unionId)).get();
		if (!union) return null;

		const partners = await this.db
			.select()
			.from(unionPartners)
			.where(eq(unionPartners.unionId, unionId))
			.all();

		const childAssertions = await this.db
			.select()
			.from(parentChild)
			.where(eq(parentChild.unionId, unionId))
			.all();

		return {
			id: unionId,
			status: union.status as UnionStatus,
			partners: partners.map((p) => ({ personId: p.personId, order: p.order })),
			children: childAssertions.map((c) => ({
				childId: c.childId,
				parentId: c.parentId,
				type: c.type as ParentChildType
			}))
		};
	}

	async listUnions(treeId: string): Promise<UnionDto[]> {
		const unionRows = await this.db.select().from(unions).where(eq(unions.treeId, treeId)).all();

		return Promise.all(unionRows.map((u) => this.getUnion(treeId, u.id) as Promise<UnionDto>));
	}
}
