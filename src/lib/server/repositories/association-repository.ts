/**
 * The kept GEDCOM lines that can hold an association (`ASSO`): a person's kept blocks and a fact's
 * kept lines. Associations are not modelled (ADR-003), so they are found by their text.
 */

import { and, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '../db';
import { events, gedcomPreserved, individuals } from '../db/schema';
import type { EventRow } from '../domain/change-log';

/** `ASSO @I1@` also matches inside `_ASSO @I1@`; `instr`, not `LIKE`, since an XREF may hold `_`. */
function namesAny(column: SQL | typeof gedcomPreserved.lines, xrefs: readonly string[]): SQL {
	return or(...xrefs.map((xref) => sql`instr(${column}, ${`ASSO ${xref}`}) > 0`))!;
}

export class AssociationRepository {
	constructor(private db: DbClient) {}

	/** Person-level kept blocks owned by any of these XREFs or naming one in an association. */
	async keptBlocks(
		treeId: string,
		xrefs: readonly string[]
	): Promise<Array<{ ownerXref: string | null; lines: string[] }>> {
		if (xrefs.length === 0) return [];
		const rows = await this.db
			.select({ ownerXref: gedcomPreserved.ownerXref, lines: gedcomPreserved.lines })
			.from(gedcomPreserved)
			.where(
				and(
					eq(gedcomPreserved.treeId, treeId),
					or(inArray(gedcomPreserved.ownerXref, [...xrefs]), namesAny(gedcomPreserved.lines, xrefs))
				)
			)
			.orderBy(gedcomPreserved.order)
			.all();
		return rows.map((r) => ({ ownerXref: r.ownerXref, lines: r.lines as string[] }));
	}

	/**
	 * Facts whose kept lines name any of these XREFs in an association. This reads every fact of the
	 * tree that has kept lines; shortcut: no index can find text inside them, so a tree of very many
	 * imported facts would want associations stored as rows instead.
	 */
	async factsNaming(treeId: string, xrefs: readonly string[]): Promise<EventRow[]> {
		if (xrefs.length === 0) return [];
		return (await this.db
			.select()
			.from(events)
			.where(
				and(
					eq(events.treeId, treeId),
					isNotNull(events.gedcomExtra),
					namesAny(sql`${events.gedcomExtra}`, xrefs)
				)
			)
			.all()) as EventRow[];
	}

	/** The person each XREF names: by their own, else by one a merge left on the survivor (ADR-022). */
	async peopleByXref(treeId: string, xrefs: readonly string[]): Promise<Map<string, string>> {
		const wanted = [...new Set(xrefs)];
		const found = new Map<string, string>();
		if (wanted.length === 0) return found;
		for (const row of await this.db
			.select({ id: individuals.id, xref: individuals.xrefId })
			.from(individuals)
			.where(and(eq(individuals.treeId, treeId), inArray(individuals.xrefId, wanted)))
			.all())
			if (row.xref) found.set(row.xref, row.id);
		const merged = wanted.filter((x) => !found.has(x));
		if (merged.length === 0) return found;
		const list = sql.join(
			merged.map((x) => sql`${x}`),
			sql`, `
		);
		for (const row of await this.db.all<{ id: string; xref: string }>(
			sql`select i.id as id, j.value as xref from individuals i, json_each(i.xref_aliases) j
				where i.tree_id = ${treeId} and i.xref_aliases is not null and j.value in (${list})`
		))
			found.set(row.xref, row.id);
		return found;
	}
}
