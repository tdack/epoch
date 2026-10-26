/**
 * Place search through Photon (ADR-078). It only ever sends the typed place text: no tree, person
 * or date. Every failure reads as "no suggestions", because typing a place must never break.
 */

import pkg from '../../../../package.json';
import { isGeocodable, normaliseGeoQuery, type GeoCandidate } from '../../shared/geo';
import type { DbClient } from '../db';
import type { AuthenticatedContext } from '../domain/identity';
import { MAX_GEO_CANDIDATES, PHOTON_PLACE_LAYERS, candidatesFromPhoton } from '../domain/photon';
import { Logger } from '../logging/logger';
import { GeoCacheRepository } from '../repositories/geo-cache-repository';
import { UserRepository } from '../repositories/user-repository';
import { SettingsService } from './settings-service';
import { requireTreeAction } from './tree-access';

const USER_AGENT = `Epoch/${pkg.version} (+https://github.com/tdack/epoch)`;
const REQUEST_TIMEOUT_MS = 5000;
/** About two calls a second. Courtesy to a free public server, not a policy it publishes. */
const MIN_CALL_GAP_MS = 500;
/** The languages Photon answers in; any other value is a 400 from it. */
const PHOTON_LANGUAGES = ['en', 'de', 'fr', 'it'];

// Per isolate, so it is a courtesy and not a guarantee: another isolate has its own clock.
let nextCallAt = 0;
async function waitForTurn(): Promise<void> {
	const slot = Math.max(Date.now(), nextCallAt);
	nextCallAt = slot + MIN_CALL_GAP_MS;
	const wait = slot - Date.now();
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export interface GeoSearchOptions {
	/** Result language; anything Photon does not offer falls back to English. */
	lang?: string;
	/** Prefer results near here; rounded in the cache key so nearby asks share an answer. */
	latitude?: number;
	longitude?: number;
}

export class GeoService {
	private readonly cache: GeoCacheRepository;
	private readonly users: UserRepository;
	private readonly settings: SettingsService;

	constructor(
		db: DbClient,
		// Wrapped, not `fetch` itself: called as `this.fetchFn(...)`, the Workers runtime throws
		// "Illegal invocation" because `this` is not the global object.
		private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
		private readonly log: Logger = new Logger()
	) {
		this.cache = new GeoCacheRepository(db);
		this.users = new UserRepository(db);
		this.settings = new SettingsService(db);
	}

	/**
	 * Only someone who can add a place may ask: it spends the shared Photon allowance, and the
	 * route is deny-by-default like every tree route.
	 */
	async searchInTree(
		treeId: string,
		query: string,
		options: GeoSearchOptions,
		context: AuthenticatedContext
	): Promise<GeoCandidate[]> {
		await requireTreeAction(this.users, treeId, context, 'record:create');
		return this.search(query, options);
	}

	/** Up to eight candidates; empty when refused, switched off or unavailable. Never throws. */
	async search(query: string, options: GeoSearchOptions = {}): Promise<GeoCandidate[]> {
		const text = normaliseGeoQuery(query);
		// Each early return is logged with its reason, so an empty answer can be told apart in the
		// Worker's logs: refused text, the switch, a cached answer, or what Photon said.
		if (!isGeocodable(text)) {
			this.log.info('Place search refused', { query: text, reason: 'not geocodable' });
			return [];
		}
		try {
			const maps = await this.settings.maps();
			if (!maps.isGeocodingEnabled) {
				this.log.info('Place search refused', { query: text, reason: 'switched off' });
				return [];
			}

			const lang = PHOTON_LANGUAGES.includes(options.lang ?? '') ? options.lang! : 'en';
			const hasBias = Number.isFinite(options.latitude) && Number.isFinite(options.longitude);
			const bias = hasBias
				? `${options.latitude!.toFixed(1)},${options.longitude!.toFixed(1)}`
				: '';
			// The server is part of the key: a different Photon may answer differently.
			const key = [maps.photonUrl, text, lang, bias].join('|');

			const cached = await this.cache.find(key);
			if (cached !== null) {
				const results = JSON.parse(cached) as GeoCandidate[];
				this.log.info('Place search answered from cache', { query: text, count: results.length });
				return results;
			}

			const url = new URL('/api', maps.photonUrl);
			url.searchParams.set('q', text);
			url.searchParams.set('limit', String(MAX_GEO_CANDIDATES));
			url.searchParams.set('lang', lang);
			for (const layer of PHOTON_PLACE_LAYERS) url.searchParams.append('layer', layer);
			if (hasBias) {
				url.searchParams.set('lat', String(options.latitude));
				url.searchParams.set('lon', String(options.longitude));
			}

			await waitForTurn();
			const response = await this.fetchFn(url, {
				headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (!response.ok) {
				const body = (await response.text().catch(() => '')).slice(0, 300);
				throw new Error(`Photon answered ${response.status}: ${body}`);
			}
			const json: unknown = await response.json();
			const results = candidatesFromPhoton(json);
			const features = (json as { features?: unknown } | null)?.features;
			this.log.info('Place search answered by Photon', {
				query: text,
				url: url.toString(),
				features: Array.isArray(features) ? features.length : null,
				count: results.length
			});
			// An empty answer is not kept: it may be a Photon hiccup, and kept it would hide the place forever.
			if (results.length > 0) await this.cache.save(key, JSON.stringify(results), new Date());
			return results;
		} catch (cause) {
			this.log.warn('Place search failed', {
				query: text,
				reason: cause instanceof Error ? cause.message : 'unknown'
			});
			return [];
		}
	}
}
