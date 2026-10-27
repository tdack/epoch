/**
 * "Match places" (ADR-078): look up places that have no location on Photon, one run per tree, and
 * keep ranked candidates for a manager to review. Accepting writes through the same location
 * command as setting one by hand, so it is logged and can be undone; the candidates themselves are
 * working data and are not.
 *
 * Only place text that may be shown leaves Epoch: the selection uses the living rule (ADR-015),
 * never the viewer's scope, and skips text that looks like a street address.
 */

import type { Workflow } from '@cloudflare/workers-types';
import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import {
	ConcurrencyConflictError,
	DomainError,
	NotFoundError,
	UnauthorizedError,
	ValidationError
} from '../domain/errors';
import type { AuthenticatedContext } from '../domain/identity';
import { livingCutoff } from '../domain/living-state';
import type { PlaceLocationCommand } from '../domain/place-location-ops';
import { PlaceMatchRepository, type StoredCandidate } from '../repositories/place-match-repository';
import { TreeRepository } from '../repositories/tree-repository';
import { UserRepository } from '../repositories/user-repository';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../shared/lists';
import { isGeocodable, type GeoCandidate } from '../../shared/geo';
import {
	HIGH_MATCH_SCORE,
	MAX_BULK_ACCEPT_PLACES,
	MAX_INLINE_MATCH_PLACES,
	MAX_PLACES_PER_MATCH_RUN,
	MEDIUM_MATCH_SCORE,
	STALE_MATCH_RUN_SECONDS,
	centroidOf,
	rankCandidates,
	type LatLng,
	type MatchCandidateDto,
	type MatchReviewDto
} from '../../shared/place-match';
import type { OSM_TYPES } from '../../shared/places';
import type { PlaceMatchPayload } from '../workflows/place-match-workflow';
import { Logger } from '../logging/logger';
import { GeoService } from './geo-service';
import { MutationRunner, type MutationResult } from './mutation-runner';
import { SettingsService } from './settings-service';
import { requireMemberAction, requireRealUser, requireTreeScope } from './tree-access';

/**
 * The managers' action, as for standardising dates: it sweeps every place, and the people behind
 * them, whatever the reviewer may see, so it is not an editor's.
 */
const MATCH_ACTION = 'tree:update_settings';

/** Confirmed locations the run measures against; enough to bias a region, small enough to carry. */
const MAX_ANCHORS = 200;

const OSM_TYPE_NAMES: Record<NonNullable<GeoCandidate['osmType']>, (typeof OSM_TYPES)[number]> = {
	N: 'node',
	W: 'way',
	R: 'relation'
};

/** What the workflow's first step hands to the rest: small and plain, because a step's result is stored. */
export interface MatchSelection {
	places: Array<{ id: string; name: string }>;
	/** The middle of the tree's confirmed places, to bias Photon; null when there are none. */
	centroid: LatLng | null;
	anchors: LatLng[];
}

type Searcher = Pick<GeoService, 'search'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function stored(ranked: ReturnType<typeof rankCandidates>): StoredCandidate[] {
	return ranked.map((c, rank) => ({
		rank,
		score: c.score,
		latitude: c.latitude,
		longitude: c.longitude,
		osmType: c.osmType ? OSM_TYPE_NAMES[c.osmType] : null,
		osmId: c.osmId,
		displayName: c.displayName,
		kind: c.kind
	}));
}

export class PlaceMatchService {
	private readonly repo: PlaceMatchRepository;
	private readonly users: UserRepository;
	private readonly trees: TreeRepository;
	private readonly settings: SettingsService;
	private readonly geo: Searcher;
	private readonly runner: MutationRunner;

	constructor(
		db: DbClient,
		private readonly now: () => Date = () => new Date(),
		geo?: Searcher,
		private readonly log: Logger = new Logger()
	) {
		this.repo = new PlaceMatchRepository(db);
		this.users = new UserRepository(db);
		this.trees = new TreeRepository(db);
		this.settings = new SettingsService(db);
		this.geo = geo ?? new GeoService(db, undefined, log);
		this.runner = new MutationRunner(db);
	}

	private async requireGeocoding(): Promise<void> {
		if (!(await this.settings.maps()).isGeocodingEnabled)
			throw new ValidationError('Place suggestions are switched off for this install.');
	}

	/** Takes the tree's run slot and starts the workflow; refuses while a run is going. */
	async start(
		treeId: string,
		context: AuthenticatedContext,
		workflow: Workflow<PlaceMatchPayload> | undefined
	): Promise<{ instanceId: string }> {
		requireRealUser(context);
		await requireMemberAction(this.users, treeId, context.user.id, MATCH_ACTION);
		await this.requireGeocoding();

		const now = this.now();
		const staleBefore = new Date(now.getTime() - STALE_MATCH_RUN_SECONDS * 1000);
		if (!(await this.repo.tryStartRun(treeId, context.user.id, now, staleBefore)))
			throw new ConcurrencyConflictError('A place match is already running for this tree.', {
				reason: 'MATCH_RUNNING'
			});

		const instanceId = `placematch_${treeId}_${now.getTime()}`;
		if (!workflow) return this.runInline(treeId, context.user.id, instanceId);
		try {
			await workflow.create({ id: instanceId, params: { treeId, userId: context.user.id } });
		} catch {
			// The slot was taken but nothing will ever give it back.
			await this.repo.finishRun(treeId, 'failed', this.now());
			throw new DomainError('Place matching could not be started', 'INTERNAL_ERROR', 503);
		}
		return { instanceId };
	}

	/**
	 * With no workflow bound (`vite dev`, or an install without the binding), a small run happens in
	 * the request, as a small export does. A larger one is refused: one request must not spend
	 * minutes calling Photon.
	 */
	private async runInline(
		treeId: string,
		userId: string,
		instanceId: string
	): Promise<{ instanceId: string }> {
		try {
			const selection = await this.selectForRun(treeId, userId);
			if (selection.places.length > MAX_INLINE_MATCH_PLACES)
				throw new DomainError(
					`Without the matching workflow, at most ${MAX_INLINE_MATCH_PLACES} places can be matched at a time`,
					'INTERNAL_ERROR',
					503
				);
			await this.matchPlaces(treeId, selection.places, selection);
			await this.finish(treeId, 'done');
		} catch (error) {
			await this.finish(treeId, 'failed');
			throw error;
		}
		return { instanceId };
	}

	/**
	 * The workflow's first step: authorise again (the run is later than the request), choose the
	 * places, and clear the last run's candidates. The places are those with a fact, no location
	 * row, and every fact counted shown by the living rule; text that fails `isGeocodable` is left
	 * out here as well as in the search, so it is not counted as a place to do.
	 */
	async selectForRun(treeId: string, userId: string | undefined): Promise<MatchSelection> {
		// A job with no requester must not look anything up (ADR-015).
		if (!userId) throw new UnauthorizedError('Forbidden: a place match needs a requester');
		await requireMemberAction(this.users, treeId, userId, MATCH_ACTION);
		await this.requireGeocoding();
		const privacy = await this.trees.privacySettings(treeId);
		if (!privacy) throw new NotFoundError('Tree', treeId);
		// Always the tree's real rule: the public tree's "show everyone" cutoff would send living people.
		const cutoff = livingCutoff(this.now(), privacy.maxAliveYears, privacy.recentDeathYears);

		const matchable = await this.repo.matchablePlaces(treeId, cutoff);
		const eligible = matchable.filter((p) => isGeocodable(p.name));
		const places = eligible.slice(0, MAX_PLACES_PER_MATCH_RUN);
		const anchors = (await this.repo.anchors(treeId, MAX_ANCHORS)).map((a) => ({
			latitude: round2(a.latitude),
			longitude: round2(a.longitude)
		}));
		this.log.info('Place match selected places', {
			treeId,
			cutoff,
			matchable: matchable.length,
			notGeocodable: matchable.length - eligible.length,
			selected: places.length,
			skippedByCap: eligible.length - places.length,
			anchors: anchors.length
		});
		await this.repo.clearCandidates(treeId);
		await this.repo.setTotals(treeId, places.length, eligible.length - places.length);
		return {
			places: places.map((p) => ({ id: p.id, name: p.name })),
			centroid: centroidOf(anchors),
			anchors
		};
	}

	/**
	 * Looks up each place and keeps its best candidates. A place Photon has nothing for keeps the
	 * candidates it had, since an empty answer is also what an outage and the off switch return.
	 * The switch is checked first, so turning it off stops a run instead of letting it finish empty.
	 */
	async matchPlaces(
		treeId: string,
		places: ReadonlyArray<{ id: string; name: string }>,
		selection: Pick<MatchSelection, 'centroid' | 'anchors'>
	): Promise<{ searched: number; matched: number }> {
		await this.requireGeocoding();
		let matched = 0;
		for (const place of places) {
			const found = await this.geo.search(place.name, selection.centroid ?? {});
			const ranked = rankCandidates(place.name, found, selection.anchors);
			this.log.info('Place match looked up a place', {
				treeId,
				placeId: place.id,
				query: place.name,
				found: found.length,
				best: ranked[0]
					? { name: ranked[0].displayName, kind: ranked[0].kind, score: ranked[0].score }
					: null
			});
			if (ranked.length === 0) continue;
			await this.repo.replaceCandidates(treeId, place.id, stored(ranked), this.now());
			matched++;
		}
		await this.repo.addProgress(treeId, places.length, matched);
		return { searched: places.length, matched };
	}

	async finish(treeId: string, status: 'done' | 'failed'): Promise<void> {
		await this.repo.finishRun(treeId, status, this.now());
	}

	/** The run, and the unlocated places that have candidates, best first. */
	async review(
		treeId: string,
		query: { offset?: number; limit?: number },
		context: AuthenticatedContext
	): Promise<MatchReviewDto> {
		const scope = await requireTreeScope(
			this.users,
			this.trees,
			treeId,
			context,
			MATCH_ACTION,
			this.now()
		);
		const page = {
			offset: Math.max(0, query.offset ?? 0),
			limit: Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
		};
		const { rows, hasMore } = await this.repo.reviewPlaces(treeId, scope, page);
		const candidates = await this.repo.candidatesOf(
			treeId,
			rows.map((r) => r.id)
		);
		return {
			run: await this.repo.run(treeId),
			places: rows.map((r) => ({ ...r, candidates: candidates.get(r.id) ?? [] })),
			hasMore,
			...page,
			highCount: await this.repo.countAtOrAbove(treeId, HIGH_MATCH_SCORE),
			isGeocodingEnabled: (await this.settings.maps()).isGeocodingEnabled
		};
	}

	/** One search for text the reviewer edited; replaces that place's candidates, even with none. */
	async searchAgain(
		treeId: string,
		placeId: string,
		text: string,
		context: AuthenticatedContext
	): Promise<MatchCandidateDto[]> {
		requireRealUser(context);
		await requireMemberAction(this.users, treeId, context.user.id, MATCH_ACTION);
		if ((await this.repo.placeName(treeId, placeId)) === null)
			throw new NotFoundError('Place', placeId);
		await this.requireGeocoding();
		if (!isGeocodable(text)) throw new ValidationError('That text cannot be searched for.');
		const anchors = (await this.repo.anchors(treeId, MAX_ANCHORS)).map((a) => ({
			latitude: round2(a.latitude),
			longitude: round2(a.longitude)
		}));
		const found = await this.geo.search(text, centroidOf(anchors) ?? {});
		await this.repo.replaceCandidates(
			treeId,
			placeId,
			stored(rankCandidates(text, found, anchors)),
			this.now()
		);
		return (await this.repo.candidatesOf(treeId, [placeId])).get(placeId) ?? [];
	}

	/**
	 * Accepts the best candidate of up to `MAX_BULK_ACCEPT_PLACES` places scoring at least
	 * `minScore`, as one change and one undo. Only places still unlocated and still with a fact are
	 * taken, so a rename or a hand-set location since the run cannot fail or overwrite the batch.
	 * `remaining` says whether to call again.
	 */
	async acceptMatches(
		treeId: string,
		minScore: number,
		context: AuthenticatedContext
	): Promise<{ accepted: number; remaining: number; change: MutationResult['change'] }> {
		requireRealUser(context);
		await this.runner.requireAccess(treeId, context, MATCH_ACTION);
		if (!(minScore >= MEDIUM_MATCH_SCORE && minScore <= 1))
			throw new ValidationError('Accept matches scoring from 0.5 to 1.');
		const top = await this.repo.topCandidatesAtOrAbove(treeId, minScore, MAX_BULK_ACCEPT_PLACES);
		if (top.length === 0) return { accepted: 0, remaining: 0, change: null };

		const commands: PlaceLocationCommand[] = top.map((c) => ({
			kind: 'set_place_location',
			placeId: c.placeId,
			placeKey: c.placeKey,
			latitude: c.latitude,
			longitude: c.longitude,
			source: 'photon',
			osmType: c.osmType,
			osmId: c.osmId,
			displayName: c.displayName,
			shouldSkipIfLocated: true
		}));
		const { change } = await this.runner.run(treeId, context, {
			kind: 'set_place_location',
			summary: (rows) =>
				commands.length === 1
					? describeCommand(commands[0]!, rows)
					: `Set the location of ${commands.length} places`,
			commands,
			requiredAction: () => 'record:edit'
		});
		await this.repo.deleteCandidatesOf(
			treeId,
			top.map((c) => c.placeId)
		);
		return {
			accepted: top.length,
			remaining: await this.repo.countAtOrAbove(treeId, minScore),
			change
		};
	}
}
