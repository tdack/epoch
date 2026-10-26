/**
 * Reads and writes for "Match places" (ADR-078): which places may be looked up, the candidates
 * found for them, and the run's progress. Candidates are working data, so nothing here goes through
 * the mutation runner or the change log.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbClient } from '../db';
import { placeMatchCandidates, placeMatchRuns } from '../db/schema';
import type { LatLng, MatchCandidateDto, MatchRunDto } from '../../shared/place-match';
import { OSM_TYPES } from '../../shared/places';
import { chunkIds } from './param-chunks';
import { hasNoLocation, visibleFacts, type Scope } from './place-repository';

export interface MatchablePlace {
	id: string;
	name: string;
	facts: number;
}

export interface StoredCandidate {
	rank: number;
	score: number;
	latitude: number;
	longitude: number;
	osmType: (typeof OSM_TYPES)[number] | null;
	osmId: number | null;
	displayName: string;
	kind: string | null;
}

/** The facts that may leave Epoch: no address on the fact (ADR-078), and no location on the place. */
const hasNoAddress = sql` and (e.address is null or trim(e.address) = '')`;
const hasCandidates = sql` and exists (select 1 from place_match_candidates mc where mc.place_id = e.place_id)`;

function runDto(row: typeof placeMatchRuns.$inferSelect): MatchRunDto {
	return {
		status: row.status,
		startedAt: row.startedAt.getTime(),
		finishedAt: row.finishedAt?.getTime() ?? null,
		total: row.totalCount,
		searched: row.searchedCount,
		matched: row.matchedCount,
		skippedByCap: row.skippedByCapCount
	};
}

export class PlaceMatchRepository {
	constructor(private db: DbClient) {}

	/**
	 * The places a run may look up: at least one fact, no location row of any status, and every
	 * fact counted is one the living rule shows (ADR-015) and that carries no address. The scope is
	 * built by the caller from the tree's own cutoff and is always restricted with no creator, so
	 * the viewer-independent rule decides, public tree or not. The most-used places come first, so
	 * a cap drops the ones that matter least. Text that is not geocodable is filtered by the caller.
	 */
	async matchablePlaces(treeId: string, cutoff: string): Promise<MatchablePlace[]> {
		const scope: Scope = { isRestricted: true, cutoff, creatorId: null };
		return this.db.all<MatchablePlace>(sql`
			select f.place_id as id, min(f.place) as name, count(*) as facts
			from (${visibleFacts(treeId, scope, sql`${hasNoLocation}${hasNoAddress}`, null)}) f
			group by f.place_id
			order by count(*) desc, min(f.place) collate nocase, f.place_id`);
	}

	/** Confirmed locations, a random sample of at most `limit`: enough to bias and to measure against. */
	async anchors(treeId: string, limit: number): Promise<LatLng[]> {
		return this.db.all<LatLng>(sql`
			select latitude, longitude from place_locations
			where tree_id = ${treeId} and status = 'confirmed' and latitude is not null and longitude is not null
			order by random() limit ${limit}`);
	}

	/** The place's text, or null when this tree has no such place record. */
	async placeName(treeId: string, placeId: string): Promise<string | null> {
		const [row] = await this.db.all<{ name: string | null }>(sql`
			select (select min(e.place) from events e where e.place_id = p.id) as name
			from places p where p.tree_id = ${treeId} and p.id = ${placeId}`);
		return row ? (row.name ?? '') : null;
	}

	async clearCandidates(treeId: string): Promise<void> {
		await this.db.delete(placeMatchCandidates).where(eq(placeMatchCandidates.treeId, treeId));
	}

	/** Replaces the place's candidates with `rows` (empty clears them), as one batch. */
	async replaceCandidates(
		treeId: string,
		placeId: string,
		rows: readonly StoredCandidate[],
		now: Date
	): Promise<void> {
		const remove = this.db
			.delete(placeMatchCandidates)
			.where(
				and(eq(placeMatchCandidates.treeId, treeId), eq(placeMatchCandidates.placeId, placeId))
			);
		if (rows.length === 0) {
			await remove;
			return;
		}
		await this.db.batch([
			remove,
			this.db
				.insert(placeMatchCandidates)
				.values(rows.map((r) => ({ ...r, treeId, placeId, createdAt: now })))
		]);
	}

	/** The candidates of these places, best first. */
	async candidatesOf(
		treeId: string,
		placeIds: readonly string[]
	): Promise<Map<string, MatchCandidateDto[]>> {
		const found = new Map<string, MatchCandidateDto[]>();
		for (const chunk of chunkIds([...placeIds], 80)) {
			const rows = await this.db
				.select()
				.from(placeMatchCandidates)
				.where(
					and(eq(placeMatchCandidates.treeId, treeId), inArray(placeMatchCandidates.placeId, chunk))
				)
				.orderBy(placeMatchCandidates.placeId, placeMatchCandidates.rank);
			for (const r of rows) {
				const list = found.get(r.placeId) ?? [];
				list.push({
					rank: r.rank,
					score: r.score,
					latitude: r.latitude,
					longitude: r.longitude,
					osmType: OSM_TYPES.find((t) => t === r.osmType) ?? null,
					osmId: r.osmId,
					displayName: r.displayName,
					kind: r.kind
				});
				found.set(r.placeId, list);
			}
		}
		return found;
	}

	/**
	 * Unlocated places that have candidates, best top candidate first. Counted over the facts the
	 * scope shows; the review is a manager's, so that is every fact.
	 */
	async reviewPlaces(
		treeId: string,
		scope: Scope,
		page: { offset: number; limit: number }
	): Promise<{ rows: MatchablePlace[]; hasMore: boolean }> {
		const rows = await this.db.all<MatchablePlace>(sql`
			select f.place_id as id, min(f.place) as name, count(*) as facts
			from (${visibleFacts(treeId, scope, sql`${hasNoLocation}${hasCandidates}`, null)}) f
			group by f.place_id
			order by (select mc.score from place_match_candidates mc where mc.place_id = f.place_id and mc.rank = 0) desc,
				min(f.place) collate nocase, f.place_id
			limit ${page.limit + 1} offset ${page.offset}`);
		return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
	}

	/**
	 * Places still unlocated and still with a fact whose best candidate scores at least `minScore`.
	 * A place that was located, or lost its facts to a rename, since the run is left out, so a bulk
	 * accept never trips on it. Returns the place's key because a command needs it.
	 */
	async topCandidatesAtOrAbove(
		treeId: string,
		minScore: number,
		limit: number
	): Promise<Array<StoredCandidate & { placeId: string; placeKey: string }>> {
		return this.db.all(sql`
			select c.place_id as placeId, p.name_key as placeKey, c.rank as rank, c.score as score,
				c.latitude as latitude, c.longitude as longitude, c.osm_type as osmType,
				c.osm_id as osmId, c.display_name as displayName, c.kind as kind
			from place_match_candidates c
			join places p on p.id = c.place_id
			where c.tree_id = ${treeId} and c.rank = 0 and c.score >= ${minScore}
				and not exists (select 1 from place_locations pl where pl.id = c.place_id)
				and exists (select 1 from events e where e.place_id = c.place_id and e.tree_id = ${treeId})
			order by c.score desc, c.place_id
			limit ${limit}`);
	}

	/** How many places `topCandidatesAtOrAbove` would return with no limit. */
	async countAtOrAbove(treeId: string, minScore: number): Promise<number> {
		const [row] = await this.db.all<{ n: number }>(sql`
			select count(*) as n from place_match_candidates c
			where c.tree_id = ${treeId} and c.rank = 0 and c.score >= ${minScore}
				and not exists (select 1 from place_locations pl where pl.id = c.place_id)
				and exists (select 1 from events e where e.place_id = c.place_id and e.tree_id = ${treeId})`);
		return row?.n ?? 0;
	}

	async deleteCandidatesOf(treeId: string, placeIds: readonly string[]): Promise<void> {
		for (const chunk of chunkIds([...placeIds], 80))
			await this.db
				.delete(placeMatchCandidates)
				.where(
					and(eq(placeMatchCandidates.treeId, treeId), inArray(placeMatchCandidates.placeId, chunk))
				);
	}

	async run(treeId: string): Promise<MatchRunDto | null> {
		const row = await this.db
			.select()
			.from(placeMatchRuns)
			.where(eq(placeMatchRuns.treeId, treeId))
			.get();
		return row ? runDto(row) : null;
	}

	/**
	 * Takes the tree's single run slot: an insert, or an update only when the last run is not
	 * running (or has been running so long it is dead). One statement, so two starts cannot both win.
	 */
	async tryStartRun(
		treeId: string,
		startedBy: string | null,
		now: Date,
		staleBefore: Date
	): Promise<boolean> {
		const won = await this.db
			.insert(placeMatchRuns)
			.values({ treeId, status: 'running', startedBy, startedAt: now })
			.onConflictDoUpdate({
				target: placeMatchRuns.treeId,
				set: {
					status: 'running',
					startedBy,
					startedAt: now,
					finishedAt: null,
					totalCount: 0,
					searchedCount: 0,
					matchedCount: 0,
					skippedByCapCount: 0
				},
				setWhere: sql`${placeMatchRuns.status} <> 'running' or ${placeMatchRuns.startedAt} < ${Math.floor(staleBefore.getTime() / 1000)}`
			})
			.returning({ treeId: placeMatchRuns.treeId });
		return won.length > 0;
	}

	async setTotals(treeId: string, total: number, skippedByCap: number): Promise<void> {
		await this.db
			.update(placeMatchRuns)
			.set({ totalCount: total, skippedByCapCount: skippedByCap })
			.where(eq(placeMatchRuns.treeId, treeId));
	}

	async addProgress(treeId: string, searched: number, matched: number): Promise<void> {
		await this.db
			.update(placeMatchRuns)
			.set({
				searchedCount: sql`${placeMatchRuns.searchedCount} + ${searched}`,
				matchedCount: sql`${placeMatchRuns.matchedCount} + ${matched}`
			})
			.where(eq(placeMatchRuns.treeId, treeId));
	}

	async finishRun(treeId: string, status: 'done' | 'failed', now: Date): Promise<void> {
		await this.db
			.update(placeMatchRuns)
			.set({ status, finishedAt: now })
			.where(and(eq(placeMatchRuns.treeId, treeId), eq(placeMatchRuns.status, 'running')));
	}
}
