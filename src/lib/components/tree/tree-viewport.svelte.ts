/**
 * The pan and zoom of the tree canvas: the d3 zoom behaviour, the fitted view, animated moves and
 * the re-framing that follows a refocus. It owns `transform` and `size` as reactive state, and the
 * canvas reads them to place the scene; nothing here knows what a card or an edge is.
 */

import { easeCubicOut } from 'd3-ease';
import { select } from 'd3-selection';
// Imported for its side effect: it adds `transition` and `interrupt` to selections.
import 'd3-transition';
import {
	zoom,
	zoomIdentity,
	type D3ZoomEvent,
	type ZoomBehavior,
	type ZoomTransform
} from 'd3-zoom';
import { LAYOUT_METRICS, type Point, type TreeLayout } from '#lib/tree-layout/index.js';
import {
	MAX_FIT_ZOOM,
	MAX_ZOOM,
	MIN_ZOOM,
	READABLE_FIT_ZOOM,
	boundsOfPeople,
	immediateFamilyIds
} from './tree-view.js';

const FIT_PADDING_PX = 56;
/** Side padding never takes more than this share of a narrow canvas's width. */
const FIT_PADDING_SHARE = 0.06;
const MIN_FIT_PADDING_PX = 16;
/** Clears the legend toggle pinned to the top and the zoom bar pinned to the bottom. */
const FIT_PADDING_TOP_PX = 56;
const FIT_PADDING_BOTTOM_PX = 72;
/** Canvases narrower than this (a phone, or a narrow window) frame a readable family, not the whole tree. */
const NARROW_CANVAS_PX = 640;

type Bounds = TreeLayout['bounds'];
const ANIMATION_MS = 380;
const ZOOM_BUTTON_MS = 220;

/** Elements that start their own gesture, so a drag on them must not pan the canvas. */
const OWN_GESTURE_SELECTOR =
	'[data-person-id], [data-stub-id], [data-fold-id], [data-collapser-id], [data-edge-id], [data-union-id]';

function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animation needs requestAnimationFrame, which a hidden tab never delivers: a d3 transition
 * started there advances one tick and freezes. Jump straight to the end when nobody can see it.
 */
function canAnimate(): boolean {
	return !prefersReducedMotion() && !document.hidden;
}

export class TreeViewport {
	transform = $state(zoomIdentity);
	size = $state({ width: 1000, height: 600 });

	private svg: Element | null = null;
	private zoomBehavior: ZoomBehavior<Element, unknown> | null = null;
	/** Where the running animation is heading, so a second click builds on it instead of on a mid-flight frame. */
	private animationTarget: ZoomTransform | null = null;
	private lastFitKey: string | null = null;
	private previousPositions = new Map<string, Point>();
	private previousCollapserCount = 0;

	/** Whether the behaviour is installed; a re-frame before that has nothing to move. */
	get isAttached(): boolean {
		return this.zoomBehavior !== null;
	}

	/**
	 * Install pan and zoom on the svg and watch its size. `onResize` runs when the box changes size,
	 * after `size` is updated, so the canvas can re-fit. Returns the cleanup.
	 */
	attach(svg: Element, onResize: () => void): () => void {
		this.svg = svg;
		this.size = { width: svg.clientWidth || 1000, height: svg.clientHeight || 600 };

		this.zoomBehavior = zoom<Element, unknown>()
			.scaleExtent([MIN_ZOOM, MAX_ZOOM])
			// Dragging a card starts drag-to-relate, not a pan; the wheel still zooms everywhere.
			.filter((event: Event) => {
				if (event.type === 'wheel') return true;
				const target = event.target as Element | null;
				const isOnControl = target?.closest?.(OWN_GESTURE_SELECTOR);
				return !(event as MouseEvent).button && !isOnControl;
			})
			.on('zoom', (event: D3ZoomEvent<Element, unknown>) => {
				this.transform = event.transform;
			})
			.on('end', () => {
				this.animationTarget = null;
			});
		select(svg).call(this.zoomBehavior).on('dblclick.zoom', null);

		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			if (width === this.size.width && height === this.size.height) return;
			this.size = { width, height };
			onResize();
		});
		observer.observe(svg);
		return () => {
			observer.disconnect();
			select(svg).interrupt().on('.zoom', null);
		};
	}

	private moveTo(target: ZoomTransform, options: { isAnimated: boolean; durationMs?: number }) {
		if (!this.svg || !this.zoomBehavior) return;
		const selection = select(this.svg);
		selection.interrupt();
		this.animationTarget = null;
		if (options.isAnimated && canAnimate()) {
			this.animationTarget = target;
			selection
				.transition()
				.duration(options.durationMs ?? ANIMATION_MS)
				.ease(easeCubicOut)
				.call(this.zoomBehavior.transform, target);
		} else {
			selection.call(this.zoomBehavior.transform, target);
		}
	}

	/** The scale that fits `bounds` in the padded canvas, before any clamping. */
	private scaleFor({ minX, maxX, minY, maxY }: Bounds): number {
		const side = Math.max(
			MIN_FIT_PADDING_PX,
			Math.min(FIT_PADDING_PX, this.size.width * FIT_PADDING_SHARE)
		);
		return Math.min(
			(this.size.width - side * 2) / Math.max(1, maxX - minX),
			(this.size.height - FIT_PADDING_TOP_PX - FIT_PADDING_BOTTOM_PX) / Math.max(1, maxY - minY)
		);
	}

	/** Scale `k`, centred on (cx, cy) in layout space, inside the padded canvas. */
	private centredOn(cx: number, cy: number, k: number): ZoomTransform {
		const midY =
			FIT_PADDING_TOP_PX + (this.size.height - FIT_PADDING_TOP_PX - FIT_PADDING_BOTTOM_PX) / 2;
		return zoomIdentity.translate(this.size.width / 2 - cx * k, midY - cy * k).scale(k);
	}

	/** The whole tree, however small that makes it: what the Fit button asks for. */
	private fitTransform(layout: TreeLayout): ZoomTransform {
		const { minX, maxX, minY, maxY } = layout.bounds;
		const k = Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, this.scaleFor(layout.bounds)));
		return this.centredOn((minX + maxX) / 2, (minY + maxY) / 2, k);
	}

	/**
	 * Whether an automatic framing shows the whole tree. A wide canvas always does: a small overview
	 * there still shows the shape of the family beside room to zoom. A narrow one does only while the
	 * names stay readable, since a phone that fits everything shows nothing anyone can read.
	 */
	private shouldFrameWhole(layout: TreeLayout): boolean {
		return this.size.width >= NARROW_CANVAS_PX || this.scaleFor(layout.bounds) >= READABLE_FIT_ZOOM;
	}

	/**
	 * The automatic framing: the whole tree where `shouldFrameWhole` allows, otherwise the focus
	 * person's immediate family at a readable scale. A family too wide even for that stays centred
	 * on the focus person, so the one card the view is about is never pushed off the edge.
	 */
	private frameTransform(layout: TreeLayout): ZoomTransform {
		if (this.shouldFrameWhole(layout)) return this.fitTransform(layout);
		const family = boundsOfPeople(layout, immediateFamilyIds(layout));
		const focus = layout.people.find((p) => p.id === layout.focusPersonId);
		if (!family || !focus) return this.fitTransform(layout);
		const familyK = this.scaleFor(family);
		const k = Math.min(MAX_FIT_ZOOM, Math.max(READABLE_FIT_ZOOM, familyK));
		const cx = familyK >= READABLE_FIT_ZOOM ? (family.minX + family.maxX) / 2 : focus.x;
		return this.centredOn(cx, (family.minY + family.maxY) / 2, k);
	}

	private isBoundsVisible(layout: TreeLayout): boolean {
		const { minX, maxX, minY, maxY } = layout.bounds;
		const [left, top] = this.transform.apply([minX, minY]);
		const [right, bottom] = this.transform.apply([maxX, maxY]);
		return left >= 0 && top >= 0 && right <= this.size.width && bottom <= this.size.height;
	}

	/** Zoom about the centre of the view. */
	zoomBy(factor: number) {
		const base = this.animationTarget ?? this.transform;
		const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.k * factor));
		const centre: [number, number] = [this.size.width / 2, this.size.height / 2];
		const [px, py] = base.invert(centre);
		this.moveTo(zoomIdentity.translate(centre[0] - px * k, centre[1] - py * k).scale(k), {
			isAnimated: true,
			durationMs: ZOOM_BUTTON_MS
		});
	}

	fit(layout: TreeLayout, isAnimated = true) {
		if (layout.people.length > 0) this.moveTo(this.fitTransform(layout), { isAnimated });
	}

	/** Frame the tree as a refocus or a resize does; see `frameTransform`. */
	frame(layout: TreeLayout, isAnimated = true) {
		if (layout.people.length > 0) this.moveTo(this.frameTransform(layout), { isAnimated });
	}

	/** Pan just enough to bring a card centred at (x, y) fully into view. */
	ensureVisible(x: number, y: number) {
		if (!this.svg) return;
		const { transform, size } = this;
		const [sx, sy] = transform.apply([x, y]);
		const halfW = (LAYOUT_METRICS.cardWidth / 2) * transform.k + 16;
		const halfH = (LAYOUT_METRICS.cardHeight / 2) * transform.k + 16;
		const dx = sx - halfW < 0 ? halfW - sx : sx + halfW > size.width ? size.width - halfW - sx : 0;
		const dy =
			sy - halfH < 0 ? halfH - sy : sy + halfH > size.height ? size.height - halfH - sy : 0;
		if (dx !== 0 || dy !== 0)
			this.moveTo(transform.translate(dx / transform.k, dy / transform.k), { isAnimated: true });
	}

	/**
	 * Re-frame when the key changes. The new focus person stays where it was on screen for the first
	 * frame, then the view glides to the fitted position, so a refocus reads as movement rather than a
	 * jump cut. `scene` is the element that fades while it does.
	 */
	reframe(fitKey: string, layout: TreeLayout, scene: Element | null | undefined) {
		if (!this.zoomBehavior) return;
		const isFirst = this.lastFitKey === null;
		if (fitKey !== this.lastFitKey) {
			const anchor = layout.focusPersonId
				? this.previousPositions.get(layout.focusPersonId)
				: undefined;
			if (!isFirst && anchor && canAnimate()) {
				const screen = this.transform.apply([anchor.x, anchor.y]);
				this.moveTo(zoomIdentity.translate(screen[0], screen[1]).scale(this.transform.k), {
					isAnimated: false
				});
				scene?.animate([{ opacity: 0.35 }, { opacity: 1 }], {
					duration: ANIMATION_MS,
					easing: 'ease-out'
				});
			}
			this.moveTo(this.frameTransform(layout), { isAnimated: !isFirst });
			this.lastFitKey = fitKey;
		} else if (
			layout.collapsers.length > this.previousCollapserCount &&
			!this.isBoundsVisible(layout) &&
			this.shouldFrameWhole(layout)
		) {
			// A stub opened onto rows the view does not show; frame them rather than leave them
			// off-screen. Not when that would shrink the names past reading: the opened stub is on screen
			// and its rows grow from it, so a pan reaches them.
			this.moveTo(this.fitTransform(layout), { isAnimated: true });
		}
		this.previousPositions = new Map(layout.people.map((p) => [p.id, { x: p.x, y: p.y }]));
		this.previousCollapserCount = layout.collapsers.length;
	}
}
