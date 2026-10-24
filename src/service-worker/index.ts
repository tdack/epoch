import { self as sw } from '$app/service-worker';
import { version } from '$app/env';
import { immutable, assets } from '$app/manifest';
import { resolve } from '$app/paths';
import { isHandledRequest, isShellFile } from '#lib/shared/service-worker-rules';

const CACHE_NAME = `epoch-shell-${version}`;
// Private family data: only immutable assets and the offline page are ever cached. Pages, /api and
// /media are never stored, because devices may be shared (ADR-077).
const PRECACHE = [
	...immutable.map((a) => resolve(a.path)),
	...assets.map((a) => resolve(a.path)).filter(isShellFile)
];
const OFFLINE_URL = '/offline.html';

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (!isHandledRequest(request.method, url.origin, sw.location.origin)) return;

	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
	} else if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error())
		);
	}
});
