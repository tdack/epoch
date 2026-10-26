import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../domain/errors';
import { Logger } from '../logging/logger';
import { addTestMember, createTestDatabase, createTestTree, createTestUser } from '../testing/d1';
import type { TestDatabase } from '../testing/d1';
import { GeoService } from './geo-service';
import { SettingsService } from './settings-service';

let t: TestDatabase;
beforeAll(async () => {
	t = await createTestDatabase();
});
afterAll(async () => {
	await t.dispose();
});

const PHOTON = {
	features: [
		{
			geometry: { coordinates: [143.85, -37.56] },
			properties: {
				osm_type: 'R',
				osm_id: 1,
				osm_value: 'city',
				name: 'Ballarat',
				country: 'Australia'
			}
		}
	]
};
const answer = () => Response.json(PHOTON);
const quiet = new Logger();

describe('GeoService.search', () => {
	it('fetches once with the Epoch user agent, then serves the repeat from the cache', async () => {
		const fetchFn = vi.fn(async () => answer());
		const service = new GeoService(t.db, fetchFn as unknown as typeof fetch, quiet);
		const first = await service.search('  Ballarat  ');
		const second = await service.search('ballarat');
		expect(first).toHaveLength(1);
		expect(second).toEqual(first);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
		expect(url.origin).toBe('https://photon.komoot.io');
		expect(url.searchParams.get('q')).toBe('ballarat');
		expect((init.headers as Record<string, string>)['User-Agent']).toMatch(
			/^Epoch\/\S+ \(\+https:\/\/github\.com\/tdack\/epoch\)$/
		);
	});

	it('does not call out for short text or a street address', async () => {
		const fetchFn = vi.fn(async () => answer());
		const service = new GeoService(t.db, fetchFn as unknown as typeof fetch, quiet);
		expect(await service.search('ab')).toEqual([]);
		expect(await service.search('12 High Street')).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('returns nothing and does not call out when the owner has switched geocoding off', async () => {
		const owner = await createTestUser(t.db, 'geo-owner');
		const context = { ...owner.context, user: { ...owner.context.user, isInstallOwner: true } };
		await new SettingsService(t.db).updateSite({ maps: { isGeocodingEnabled: false } }, context);
		const fetchFn = vi.fn(async () => answer());
		const service = new GeoService(t.db, fetchFn as unknown as typeof fetch, quiet);
		expect(await service.search('Melbourne')).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
		await new SettingsService(t.db).updateSite({ maps: null }, context);
	});

	it('returns nothing, and caches nothing, when Photon fails', async () => {
		const failing = vi.fn(async () => new Response('no', { status: 503 }));
		const service = new GeoService(t.db, failing as unknown as typeof fetch, quiet);
		expect(await service.search('Geelong')).toEqual([]);
		const working = vi.fn(async () => answer());
		const retry = new GeoService(t.db, working as unknown as typeof fetch, quiet);
		expect(await retry.search('Geelong')).toHaveLength(1);
		expect(working).toHaveBeenCalledTimes(1);
	});

	it('survives a fetch that throws', async () => {
		const throwing = vi.fn(async () => {
			throw new Error('network down');
		});
		const service = new GeoService(t.db, throwing as unknown as typeof fetch, quiet);
		expect(await service.search('Bendigo')).toEqual([]);
	});
});

describe('GeoService.searchInTree', () => {
	it('lets a contributor search and refuses a viewer and a stranger', async () => {
		const owner = await createTestUser(t.db, 'tree-owner');
		const treeId = await createTestTree(t.db, owner);
		const viewer = await createTestUser(t.db, 'viewer');
		await addTestMember(t.db, treeId, viewer, 'viewer');
		const stranger = await createTestUser(t.db, 'stranger');
		const fetchFn = vi.fn(async () => answer());
		const service = new GeoService(t.db, fetchFn as unknown as typeof fetch, quiet);

		expect(await service.searchInTree(treeId, 'Ballarat', {}, owner.context)).toHaveLength(1);
		await expect(
			service.searchInTree(treeId, 'Ballarat', {}, viewer.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(
			service.searchInTree(treeId, 'Ballarat', {}, stranger.context)
		).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
