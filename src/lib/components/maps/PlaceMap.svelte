<script lang="ts">
	import { onMount } from 'svelte';
	import type { LeafletMap, LayerGroup, Marker } from 'leaflet';
	import { shouldReduceMotion } from '#lib/components/motion.js';
	import type { MapBounds, MapMarker } from '#lib/shared/geo.js';
	import type { LifeStop } from '#lib/shared/life-map.js';
	import { clusterPoints } from './cluster.js';

	type LeafletModule = typeof import('leaflet');

	interface Props {
		/**
		 * The places to pin, clustered by zoom. Leave empty on a map that only shows `pin`. The view
		 * fits these once, when the map starts; later changes redraw the pins and leave the view alone.
		 */
		markers?: MapMarker[];
		/** The tile URL template, from the site settings. Never hard-coded here. */
		tileUrl: string;
		/** HTML credit for the tiles, from the site settings; always shown on the map (OSM tile policy). */
		tileAttribution: string;
		/**
		 * The map's accessible name. Say where the equivalent is: pins are not keyboard targets, so the
		 * page's list or text must carry the same information.
		 */
		label: string;
		/**
		 * A person's stops, for the person page: numbered, coloured by `group`, never clustered (a life
		 * has few). Draws in place of `markers`; the view fits them with `path`.
		 */
		stops?: LifeStop[];
		/** Joined by a line, in order. Used with `stops`. */
		path?: Array<[number, number]>;
		/** One editable pin, for the place page. Null shows none. */
		pin?: { latitude: number; longitude: number } | null;
		/** When true a click on the map or a drag of the pin calls `onpick`. */
		isPicking?: boolean;
		/** Called with degrees when the viewer picks a spot. The caller owns `pin`; the map does not move it. */
		onpick?: (latitude: number, longitude: number) => void;
		/** Called after the map settles on a view, including the first one. */
		onviewportchange?: (bounds: MapBounds) => void;
		/** Size and shape, e.g. `h-80`. The map fills this box. */
		class?: string;
	}

	let {
		markers = [],
		stops = [],
		path = [],
		tileUrl,
		tileAttribution,
		label,
		pin = null,
		isPicking = false,
		onpick,
		onviewportchange,
		class: className = 'h-80'
	}: Props = $props();

	const CLUSTER_CELL_PX = 60;
	const MAX_ZOOM = 19;
	// Past this zoom a cluster is places that share a spot, which more zoom cannot separate.
	const SPLITTING_ZOOM_LIMIT = 17;
	const FIT_MAX_ZOOM = 12;

	let element = $state<HTMLDivElement | null>(null);
	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	let lib = $state.raw<LeafletModule | null>(null);
	let map = $state.raw<LeafletMap | null>(null);
	let zoom = $state(2);

	onMount(() => {
		let isDisposed = false;
		let created: LeafletMap | null = null;
		let observer: ResizeObserver | null = null;
		void (async () => {
			try {
				// Both are dynamic so neither Leaflet nor its stylesheet is in any page's own chunk.
				const [leaflet] = await Promise.all([
					import('leaflet'),
					import('leaflet/dist/leaflet.css')
				]);
				if (isDisposed || !element) return;
				const isCalm = shouldReduceMotion();
				created = new leaflet.LeafletMap(element, {
					zoomAnimation: !isCalm,
					fadeAnimation: !isCalm,
					markerZoomAnimation: !isCalm
				});
				new leaflet.TileLayer(tileUrl, {
					attribution: tileAttribution,
					// So a later export of the map can read pixels; OSM's tile server allows it.
					crossOrigin: true,
					maxZoom: MAX_ZOOM
				}).addTo(created);
				const points: Array<[number, number]> = [
					...markers.map((m): [number, number] => [m.latitude, m.longitude]),
					...stops.map((s): [number, number] => [s.latitude, s.longitude])
				];
				if (points.length > 0)
					created.fitBounds(points, { padding: [30, 30], maxZoom: FIT_MAX_ZOOM, animate: false });
				else if (pin)
					created.setView([pin.latitude, pin.longitude], FIT_MAX_ZOOM, { animate: false });
				else created.setView([20, 0], 2, { animate: false });
				const settled = created;
				const emit = () => {
					zoom = settled.getZoom();
					const b = settled.getBounds();
					onviewportchange?.({
						south: b.getSouth(),
						west: b.getWest(),
						north: b.getNorth(),
						east: b.getEast()
					});
				};
				settled.on('moveend', emit);
				settled.on('click', (event) => {
					if (isPicking) onpick?.(event.latlng.lat, event.latlng.lng);
				});
				observer = new ResizeObserver(() => settled.invalidateSize());
				observer.observe(element);
				lib = leaflet;
				map = created;
				status = 'ready';
				emit();
			} catch {
				if (!isDisposed) status = 'failed';
			}
		})();
		return () => {
			isDisposed = true;
			observer?.disconnect();
			created?.remove();
			map = null;
		};
	});

	/** Links for places that share a spot or sit under a cluster, as a DOM node so names are never parsed as HTML. */
	function popupFor(members: MapMarker[]): HTMLElement {
		const list = document.createElement('ul');
		list.className = 'place-map-popup';
		for (const m of members) {
			const item = document.createElement('li');
			const link = document.createElement('a');
			link.href = m.href;
			link.textContent = m.label;
			item.appendChild(link);
			item.appendChild(
				document.createTextNode(` (${m.count} ${m.count === 1 ? 'fact' : 'facts'})`)
			);
			list.appendChild(item);
		}
		return list;
	}

	function icon(leaflet: LeafletModule, html: string, className: string) {
		return new leaflet.DivIcon({ html, className, iconSize: [30, 30] });
	}

	// Redrawn on every zoom: the grid is in screen pixels, so what clusters depends on it.
	$effect(() => {
		if (!lib || !map) return;
		const leaflet = lib;
		const current = map;
		const group: LayerGroup = new leaflet.LayerGroup().addTo(current);
		const isCalm = shouldReduceMotion();
		for (const cluster of clusterPoints(markers, zoom, CLUSTER_CELL_PX)) {
			const here: [number, number] = [cluster.latitude, cluster.longitude];
			const members = cluster.members;
			const isSingle = members.length === 1;
			const marker: Marker = new leaflet.Marker(here, {
				icon: isSingle
					? icon(leaflet, '', 'place-pin')
					: icon(leaflet, String(members.length), 'place-cluster'),
				keyboard: false,
				title: isSingle ? members[0]!.label : `${members.length} places`
			}).addTo(group);
			const isUnsplittable =
				zoom >= SPLITTING_ZOOM_LIMIT ||
				members.every(
					(m) => m.latitude === members[0]!.latitude && m.longitude === members[0]!.longitude
				);
			if (isSingle || isUnsplittable) marker.bindPopup(popupFor(members));
			else
				marker.on('click', () =>
					current.fitBounds(
						members.map((m): [number, number] => [m.latitude, m.longitude]),
						{ padding: [40, 40], maxZoom: MAX_ZOOM, animate: !isCalm }
					)
				);
		}
		return () => {
			group.remove();
		};
	});

	/** The facts at a stop, as DOM nodes so place names are never parsed as HTML. */
	function stopPopup(stop: LifeStop): HTMLElement {
		const list = document.createElement('ul');
		list.className = 'place-map-popup';
		for (const line of stop.lines) {
			const item = document.createElement('li');
			item.textContent = line;
			list.appendChild(item);
		}
		return list;
	}

	// A person's stops and the line between them. Numbers are generated here, never user text.
	$effect(() => {
		if (!lib || !map || stops.length === 0) return;
		const leaflet = lib;
		const group: LayerGroup = new leaflet.LayerGroup().addTo(map);
		if (path.length > 1)
			new leaflet.Polyline(path, {
				color: '#57534e',
				weight: 2,
				opacity: 0.7,
				interactive: false
			}).addTo(group);
		for (const stop of stops) {
			const text = stop.numbers.join(',');
			const marker = new leaflet.Marker([stop.latitude, stop.longitude], {
				// A zero-size icon with a centred child: a label of any width stays on its coordinate.
				icon: new leaflet.DivIcon({
					html: `<span class="life-stop life-stop-${stop.group}">${text}</span>`,
					className: 'life-stop-icon',
					iconSize: [0, 0]
				}),
				keyboard: false,
				title: stop.lines.join('; ')
			}).addTo(group);
			marker.bindPopup(stopPopup(stop));
		}
		return () => {
			group.remove();
		};
	});

	// The single pin of the place page. Rebuilt when it moves or the mode changes, because Leaflet
	// fixes a marker's draggability when it is made.
	$effect(() => {
		if (!lib || !map || !pin) return;
		const marker = new lib.Marker([pin.latitude, pin.longitude], {
			icon: icon(lib, '', 'place-pin place-pin-active'),
			keyboard: false,
			draggable: isPicking,
			title: isPicking ? 'Drag to move the pin' : 'Location'
		}).addTo(map);
		marker.on('dragend', () => {
			const at = marker.getLatLng();
			onpick?.(at.lat, at.lng);
		});
		return () => {
			marker.remove();
		};
	});
</script>

<div class="relative {className}">
	<div
		bind:this={element}
		role="region"
		aria-label={label}
		class="place-map absolute inset-0 rounded-xl border border-stone-200 bg-stone-100"
		class:is-picking={isPicking}
		data-testid="place-map"
	></div>
	{#if status !== 'ready'}
		<p class="absolute inset-0 grid place-items-center text-sm text-stone-600" role="status">
			{status === 'loading' ? 'Loading map…' : 'The map could not load.'}
		</p>
	{/if}
</div>

<style>
	/* Leaflet builds these nodes, so Svelte's scoping cannot reach them. */
	.place-map {
		z-index: 0;
	}
	.place-map.is-picking :global(.leaflet-container),
	.place-map.is-picking {
		cursor: crosshair;
	}
	.place-map :global(.place-pin) {
		background: var(--color-emerald-800);
		border: 2px solid white;
		border-radius: 50% 50% 50% 0;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
		height: 22px !important;
		margin: -22px 0 0 -11px !important;
		transform: rotate(-45deg);
		width: 22px !important;
	}
	.place-map :global(.place-pin-active) {
		background: var(--color-amber-600);
	}
	.place-map :global(.place-cluster) {
		align-items: center;
		background: var(--color-emerald-800);
		border: 3px solid rgb(255 255 255 / 0.85);
		border-radius: 50%;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
		color: var(--color-amber-50);
		display: flex;
		font-size: 12px;
		font-weight: 600;
		justify-content: center;
		margin: -15px 0 0 -15px !important;
	}
	.place-map :global(.life-stop) {
		align-items: center;
		background: var(--color-stone-700);
		border: 2px solid white;
		border-radius: 999px;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
		color: white;
		display: flex;
		font-size: 12px;
		font-weight: 600;
		height: 24px;
		justify-content: center;
		min-width: 24px;
		padding: 0 6px;
		transform: translate(-50%, -50%);
		width: max-content;
	}
	/* An undated stop has no number: a small dot. */
	.place-map :global(.life-stop:empty) {
		height: 14px;
		min-width: 14px;
		padding: 0;
	}
	.place-map :global(.life-stop-birth) {
		background: var(--color-emerald-700);
	}
	.place-map :global(.life-stop-partnership) {
		background: var(--color-rose-700);
	}
	.place-map :global(.life-stop-residence) {
		background: var(--color-sky-700);
	}
	.place-map :global(.life-stop-death) {
		background: var(--color-stone-800);
	}
	.place-map :global(.life-stop-other) {
		background: var(--color-amber-700);
	}
	.place-map :global(.place-map-popup) {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.place-map :global(.place-map-popup a) {
		color: var(--color-emerald-800);
		font-weight: 600;
	}
</style>
