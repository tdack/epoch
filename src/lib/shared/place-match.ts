/**
 * Scoring and shapes for "Match places" (ADR-078): how well a Photon candidate fits the text a
 * fact carries. Pure, so the same function scores a run in the Workflow and a single "Search
 * again" in a request.
 */

import type { GeoCandidate } from './geo';
import type { OSM_TYPES } from './places';

/** Candidates kept per place; Photon is asked for more, the reviewer sees the best few. */
const MAX_MATCH_CANDIDATES = 5;
/**
 * The most places one run looks up. A run takes about a second a place (Photon's courtesy gap), so
 * this is a half-hour job; a bigger tree runs again after the first batch is reviewed.
 */
export const MAX_PLACES_PER_MATCH_RUN = 2000;
/** The most places a run with no workflow bound looks up inside one request (`vite dev`). */
export const MAX_INLINE_MATCH_PLACES = 20;
/**
 * The places looked up in one workflow step. A step per place would spend two of the instance's
 * steps (lookup and sleep) on each, and the platform limits the steps of an instance, so 2,000
 * places would need over 4,000; ten to a step needs about 400. `GeoService` still spaces its own
 * calls, so the courtesy gap to Photon holds inside a step.
 */
export const MATCH_PLACES_PER_STEP = 10;
/** A run still marked running after this long is taken as dead and may be replaced. */
export const STALE_MATCH_RUN_SECONDS = 6 * 60 * 60;
/**
 * The most places one bulk accept writes in one change. A new location is one statement and the
 * change log adds a few, so the count is far under D1's 1,000 statements per invocation; the limit
 * that binds is CPU, because every command looks for its place's facts in the whole tree's rows.
 * The change log keeps a change as one JSON value of about 1 KB a place, well under a row's 2 MB.
 */
export const MAX_BULK_ACCEPT_PLACES = 100;

/** A score at or above this reads as "High". */
export const HIGH_MATCH_SCORE = 0.75;
/** A score at or above this (and below High) reads as "Medium". */
export const MEDIUM_MATCH_SCORE = 0.5;

export type MatchScoreLabel = 'High' | 'Medium' | 'Low';

export function matchScoreLabel(score: number): MatchScoreLabel {
	if (score >= HIGH_MATCH_SCORE) return 'High';
	return score >= MEDIUM_MATCH_SCORE ? 'Medium' : 'Low';
}

/** One stored candidate, as the review page reads it. */
export interface MatchCandidateDto {
	rank: number;
	score: number;
	latitude: number;
	longitude: number;
	osmType: (typeof OSM_TYPES)[number] | null;
	osmId: number | null;
	displayName: string;
	kind: string | null;
}

export interface MatchPlaceDto {
	id: string;
	name: string;
	facts: number;
	candidates: MatchCandidateDto[];
}

export interface MatchRunDto {
	status: 'running' | 'done' | 'failed';
	startedAt: number;
	finishedAt: number | null;
	total: number;
	searched: number;
	matched: number;
	/** Eligible places the run left for next time because of `MAX_PLACES_PER_MATCH_RUN`. */
	skippedByCap: number;
}

export interface MatchReviewDto {
	run: MatchRunDto | null;
	places: MatchPlaceDto[];
	hasMore: boolean;
	offset: number;
	limit: number;
	/** Unlocated places whose best candidate is High: what "Accept all High" would write. */
	highCount: number;
	isGeocodingEnabled: boolean;
}

/**
 * Weights, summing to 1. The text matters most: a candidate that names the parts of the place as
 * written is the one the writer meant (0.45, the first part counting double because it is the
 * place itself and the rest are where it is). Distance to the tree's confirmed places and the kind
 * of feature each count for 0.2: a tree is usually about one region, and a settlement is what a
 * family-tree place nearly always means. Photon's own rank breaks ties (0.15). With no confirmed
 * location in the tree the distance signal is neutral, not a penalty.
 */
const WEIGHT_TEXT = 0.45;
const WEIGHT_RANK = 0.15;
const WEIGHT_DISTANCE = 0.2;
const WEIGHT_KIND = 0.2;

/** Within this many km of a confirmed place scores full marks; at `FAR_KM` it scores nothing. */
const NEAR_KM = 50;
const FAR_KM = 2500;
/** Each place down Photon's list loses this much of the rank signal. */
const RANK_STEP = 0.25;

const SETTLEMENT_KINDS = new Set([
	'city',
	'town',
	'village',
	'hamlet',
	'suburb',
	'locality',
	'neighbourhood',
	'quarter',
	'borough',
	'municipality'
]);
const ADMINISTRATIVE_KINDS = new Set([
	'county',
	'state',
	'country',
	'district',
	'region',
	'province',
	'administrative',
	'state_district'
]);

/** Settlement 1, administrative 0.6, a farm or building and anything unknown 0.2. */
function kindScore(kind: string | null): number {
	const value = (kind ?? '').toLowerCase();
	if (SETTLEMENT_KINDS.has(value)) return 1;
	if (ADMINISTRATIVE_KINDS.has(value)) return 0.6;
	return 0.2;
}

/** Lower case, accents and punctuation removed, spaces collapsed: "Zürich." and "zurich" agree. */
export function foldMatchText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * Short forms a family-tree place often carries, folded. Only the English-speaking states and
 * countries the trees here mostly use; anything else simply fails to match, which costs score, not
 * correctness. shortcut: a fixed list, extend it when a tree needs another.
 */
const ABBREVIATIONS: Record<string, string> = {
	vic: 'victoria',
	nsw: 'new south wales',
	qld: 'queensland',
	sa: 'south australia',
	wa: 'western australia',
	tas: 'tasmania',
	nt: 'northern territory',
	act: 'australian capital territory',
	aus: 'australia',
	nz: 'new zealand',
	uk: 'united kingdom',
	usa: 'united states',
	us: 'united states',
	eng: 'england',
	scot: 'scotland',
	ire: 'ireland',
	can: 'canada'
};

function partMatchesField(part: string, field: string): boolean {
	if (field === '') return false;
	const full = ABBREVIATIONS[part] ?? part;
	return (
		field === part ||
		field === full ||
		` ${field} `.includes(` ${part} `) ||
		(full !== part && ` ${field} `.includes(` ${full} `))
	);
}

/** 0 to 1: the share of the text's comma-separated parts the candidate names, the first part doubled. */
function textScore(text: string, candidate: ScoredCandidate): number {
	const parts = text
		.split(',')
		.map(foldMatchText)
		.filter((p) => p !== '');
	if (parts.length === 0) return 0;
	const fields = [
		candidate.name,
		candidate.city,
		candidate.county,
		candidate.state,
		candidate.country
	].map((f) => foldMatchText(f ?? ''));
	let matched = 0;
	let total = 0;
	parts.forEach((part, i) => {
		const weight = i === 0 ? 2 : 1;
		total += weight;
		if (fields.some((field) => partMatchesField(part, field))) matched += weight;
	});
	return matched / total;
}

function haversineKm(a: LatLng, b: LatLng): number {
	const rad = Math.PI / 180;
	const dLat = (b.latitude - a.latitude) * rad;
	const dLng = (b.longitude - a.longitude) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
	return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Neutral when the tree has no confirmed place to measure against. */
function distanceScore(candidate: LatLng, anchors: readonly LatLng[]): number {
	if (anchors.length === 0) return 0.5;
	let nearest = Infinity;
	for (const anchor of anchors) nearest = Math.min(nearest, haversineKm(candidate, anchor));
	if (nearest <= NEAR_KM) return 1;
	if (nearest >= FAR_KM) return 0;
	return 1 - (nearest - NEAR_KM) / (FAR_KM - NEAR_KM);
}

export interface LatLng {
	latitude: number;
	longitude: number;
}

type ScoredCandidate = Pick<
	GeoCandidate,
	'name' | 'city' | 'county' | 'state' | 'country' | 'kind' | 'latitude' | 'longitude'
>;

export interface ScoreInput {
	/** The place as the fact wrote it. */
	text: string;
	candidate: ScoredCandidate;
	/** Zero-based position in Photon's answer. */
	rank: number;
	/** The tree's confirmed locations, or a sample of them. */
	anchors: readonly LatLng[];
}

/** How well the candidate fits, 0 to 1. */
export function scoreCandidate({ text, candidate, rank, anchors }: ScoreInput): number {
	const rankScore = Math.max(0, 1 - rank * RANK_STEP);
	const score =
		WEIGHT_TEXT * textScore(text, candidate) +
		WEIGHT_RANK * rankScore +
		WEIGHT_DISTANCE * distanceScore(candidate, anchors) +
		WEIGHT_KIND * kindScore(candidate.kind);
	return Math.min(1, Math.max(0, score));
}

/** The best `MAX_MATCH_CANDIDATES`, scored and in descending order; ties keep Photon's order. */
export function rankCandidates(
	text: string,
	candidates: readonly GeoCandidate[],
	anchors: readonly LatLng[]
): Array<GeoCandidate & { score: number }> {
	return candidates
		.map((candidate, rank) => ({
			...candidate,
			score: scoreCandidate({ text, candidate, rank, anchors })
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_MATCH_CANDIDATES);
}

/** The middle of the anchors, to bias Photon toward the tree's region; null when there are none. */
export function centroidOf(points: readonly LatLng[]): LatLng | null {
	if (points.length === 0) return null;
	const sum = points.reduce(
		(acc, p) => ({ latitude: acc.latitude + p.latitude, longitude: acc.longitude + p.longitude }),
		{ latitude: 0, longitude: 0 }
	);
	return { latitude: sum.latitude / points.length, longitude: sum.longitude / points.length };
}
