import type { RelationshipGraph } from '#lib/shared/relationship-graph.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import { VIEW_MODE_TRAITS, type LayoutMode } from '#lib/shared/view-mode.js';
import {
	EMPTY_LAYOUT,
	filterParentChildTypes,
	layoutFocusView,
	layoutWholeTree
} from '#lib/tree-layout/index.js';
import { layoutOrrery } from '#lib/tree-layout/orrery.js';
import { layoutPoincare } from '#lib/tree-layout/poincare.js';
import { layoutRibbons } from '#lib/tree-layout/ribbons.js';
import { layoutRings } from '#lib/tree-layout/rings.js';
import { selectWholeTree } from '#lib/tree-layout/whole-tree.js';
import { ALL_PARENT_CHILD_TYPES, LAYOUT_MODES, resolveStubTokens } from './tree-url.js';

interface ViewLayoutsOptions {
	graph: () => RelationshipGraph | null;
	mode: () => LayoutMode;
	/** The parent-child types the viewer chose to draw. */
	types: () => ParentChildType[];
	focusPersonId: () => string | null;
	isWholeTreeDrawn: () => boolean;
	/** What the graph on screen was fetched for; the layouts draw with this, not with the address. */
	applied: () => {
		ancestorDepth: number;
		descendantDepth: number;
		shouldIncludeSiblings: boolean;
		shouldIncludeStepFamilies: boolean;
		collateralDepth: number;
		shouldIncludePartnerOrigins: boolean;
		expandedStubs: string[];
	};
}

/**
 * The layout of whichever view is chosen. Only that one is computed, so switching mode costs one
 * layout and no request; the others stay null (flat's `layout` stays empty).
 */
export function createViewLayouts({
	graph,
	mode,
	types,
	focusPersonId,
	isWholeTreeDrawn,
	applied
}: ViewLayoutsOptions) {
	const expandedStubIds = $derived.by(() => {
		const drawn = graph();
		return drawn
			? resolveStubTokens(
					applied().expandedStubs,
					drawn.people.map((p) => p.id),
					drawn.unions.map((u) => u.id)
				)
			: [];
	});
	const graphForLayout = $derived.by(() => {
		const drawn = graph();
		return drawn && types().length < ALL_PARENT_CHILD_TYPES.length
			? filterParentChildTypes(drawn, types())
			: drawn;
	});
	const focusOptions = $derived.by(() => {
		const options = applied();
		return {
			ancestorDepth: options.ancestorDepth,
			descendantDepth: options.descendantDepth,
			shouldIncludeSiblings: options.shouldIncludeSiblings,
			shouldIncludeStepFamilies: options.shouldIncludeStepFamilies,
			// Flat draws the hourglass it always has; the wider groups are for the 3D views.
			...(mode() === LAYOUT_MODES.FLAT
				? {}
				: {
						collateralDepth: options.collateralDepth,
						shouldIncludePartnerOrigins: options.shouldIncludePartnerOrigins
					}),
			expandedStubIds
		};
	});
	const layout = $derived(
		graphForLayout && mode() === LAYOUT_MODES.FLAT
			? isWholeTreeDrawn()
				? layoutWholeTree(graphForLayout)
				: layoutFocusView(graphForLayout, focusPersonId(), focusOptions)
			: EMPTY_LAYOUT
	);
	/** The whole tree as a selection, worked out once for whichever WebGL view draws it. */
	const wholeSelection = $derived(
		graphForLayout && isWholeTreeDrawn() && VIEW_MODE_TRAITS[mode()].isWebGl
			? selectWholeTree(graphForLayout)
			: undefined
	);
	const rings = $derived(
		graphForLayout && mode() === LAYOUT_MODES.RINGS
			? layoutRings(graphForLayout, focusPersonId(), focusOptions, undefined, wholeSelection)
			: null
	);
	const poincare = $derived(
		graphForLayout && mode() === LAYOUT_MODES.POINCARE
			? layoutPoincare(graphForLayout, focusPersonId(), focusOptions, undefined, wholeSelection)
			: null
	);
	const ribbons = $derived(
		graphForLayout && mode() === LAYOUT_MODES.RIBBONS
			? layoutRibbons(
					graphForLayout,
					focusPersonId(),
					focusOptions,
					undefined,
					undefined,
					wholeSelection
				)
			: null
	);
	const orrery = $derived(
		graphForLayout && mode() === LAYOUT_MODES.ORRERY
			? layoutOrrery(
					graphForLayout,
					focusPersonId(),
					focusOptions,
					undefined,
					undefined,
					wholeSelection
				)
			: null
	);
	return {
		get layout() {
			return layout;
		},
		get rings() {
			return rings;
		},
		get poincare() {
			return poincare;
		},
		get ribbons() {
			return ribbons;
		},
		get orrery() {
			return orrery;
		}
	};
}
