/**
 * The slice of Leaflet 2.0 that `PlaceMap.svelte` uses. 2.0.0-alpha.1 ships no types, and
 * `@types/leaflet` describes 1.x (a global `L` and factory functions), so this declares only what
 * the one component calls. Delete it if a typed release lands.
 */
declare module 'leaflet' {
	type LatLngTuple = [number, number];

	interface LatLngLike {
		lat: number;
		lng: number;
	}

	interface Bounds {
		getSouth(): number;
		getWest(): number;
		getNorth(): number;
		getEast(): number;
	}

	class Layer {
		addTo(target: LeafletMap | LayerGroup): this;
		remove(): this;
		on(type: string, listener: (event: { latlng: LatLngLike }) => void): this;
		bindPopup(content: HTMLElement | string): this;
	}

	class LayerGroup extends Layer {
		clearLayers(): this;
	}

	class TileLayer extends Layer {
		constructor(
			urlTemplate: string,
			options: { attribution: string; crossOrigin: boolean; maxZoom: number }
		);
	}

	class Polyline extends Layer {
		constructor(
			latlngs: LatLngTuple[],
			options: { color: string; weight: number; opacity: number; interactive: boolean }
		);
	}

	class DivIcon {
		constructor(options: { html: string; className: string; iconSize: LatLngTuple });
	}

	class Marker extends Layer {
		constructor(
			latlng: LatLngTuple,
			options: { icon: DivIcon; keyboard: boolean; title?: string; draggable?: boolean }
		);
		setLatLng(latlng: LatLngTuple): this;
		getLatLng(): LatLngLike;
		getElement(): HTMLElement | undefined;
	}

	class LeafletMap {
		constructor(
			element: HTMLElement,
			options: {
				zoomAnimation: boolean;
				fadeAnimation: boolean;
				markerZoomAnimation: boolean;
			}
		);
		setView(center: LatLngTuple, zoom: number, options?: { animate: boolean }): this;
		fitBounds(
			bounds: LatLngTuple[],
			options: { padding: LatLngTuple; maxZoom: number; animate: boolean }
		): this;
		getZoom(): number;
		getBounds(): Bounds;
		invalidateSize(): this;
		on(type: string, listener: (event: { latlng: LatLngLike }) => void): this;
		off(type: string, listener?: (event: { latlng: LatLngLike }) => void): this;
		remove(): this;
	}
}
