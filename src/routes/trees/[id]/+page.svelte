<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { Loader2 } from '@lucide/svelte';
	import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
	import TreeGestureHint from '#lib/components/tree/TreeGestureHint.svelte';
	import EmptyTreePrompt from '#lib/components/tree/EmptyTreePrompt.svelte';
	import OrreryCanvas from '#lib/components/tree/OrreryCanvas.svelte';
	import PoincareCanvas from '#lib/components/tree/PoincareCanvas.svelte';
	import RibbonsCanvas from '#lib/components/tree/RibbonsCanvas.svelte';
	import RingsCanvas from '#lib/components/tree/RingsCanvas.svelte';
	import TreeCanvas from '#lib/components/tree/TreeCanvas.svelte';
	import TreeToolbar from '#lib/components/tree/TreeToolbar.svelte';
	import { safePalette } from '#lib/shared/palette.js';
	import type { PersonRef, TreeEditActions } from '#lib/components/tree/tree-actions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import {
		ALL_PARENT_CHILD_TYPES,
		DEFAULT_VIEW_STATE,
		HISTORY_KINDS,
		ARRIVAL_COLLATERAL_DEPTH,
		LAYOUT_MODES,
		compactStubId,
		createHistoryCoalescer,
		parseViewState,
		resolveStubTokens,
		serializeViewState,
		shouldResetStubs,
		type HistoryKind,
		type TreeViewState
	} from '#lib/components/tree/tree-url.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import {
		fetchPersonPage,
		recordRecentApi,
		saveDefaultViewMode,
		saveViewMode
	} from '#lib/services/tree-api.js';
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
	import { rememberedFocusKey } from '#lib/services/load-helpers.js';
	import { VIEW_MODE_TRAITS, resolveLayoutMode, type LayoutMode } from '#lib/shared/view-mode.js';
	import { canChangeRecords, canCreateRecords, canImportGedcom } from '#lib/shared/roles.js';
	import type { PageData } from './$types';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	// Checked again here because these colours reach style attributes in every view (ADR-054).
	const palette = $derived(safePalette(data.palette));
	const { editor, marks, toasts, finder, isPublicVisitor, importGedcom } = getTreeContext();
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	/** What the chart offers: a viewer explores, a contributor adds, an editor also changes and deletes. */
	const canCreate = $derived(canCreateRecords(role));
	const canChange = $derived(canChangeRecords(role));
	const historyCoalescer = createHistoryCoalescer();

	// The id, not the address segment, which may be the slug (ADR-045).
	const treeId = $derived(data.summary.tree.id);
	/** The address a navigation is heading for, shown before the load commits it; see `navigate`. */
	let pendingSearch = $state<string | null>(null);
	/**
	 * The view (focus, depths, toggles, opened stubs) lives in the URL so reloads, back/forward and
	 * shared links restore it. Everything below derives from it rather than keeping a second copy.
	 */
	/**
	 * The view saved for this tree: what the viewer chose, else what the owner set. A change made
	 * here shows at once; a reload reads the same from the tree list. Reset when the tree changes.
	 */
	let savedViews = $state<{ treeId: string; member?: LayoutMode | null; tree?: LayoutMode | null }>(
		{ treeId: '' }
	);
	const savedFor = $derived(savedViews.treeId === treeId ? savedViews : { treeId });
	const memberTree = $derived(data.trees.find((t) => t.id === treeId));
	const savedMemberMode = $derived(
		'member' in savedFor ? (savedFor.member ?? null) : (memberTree?.viewMode ?? null)
	);
	const savedTreeMode = $derived(
		'tree' in savedFor ? (savedFor.tree ?? null) : (memberTree?.defaultViewMode ?? null)
	);
	/** A link with no `mode` opens here; the address wins when it names one. */
	const startingMode = $derived(
		resolveLayoutMode({ fromAddress: null, fromMember: savedMemberMode, fromTree: savedTreeMode })
	);
	const view = $derived(
		parseViewState(new URLSearchParams(pendingSearch ?? page.url.search), startingMode)
	);
	/** What the graph on screen was fetched for. The canvas draws with this, and the toolbar shows `view`. */
	const applied = $derived(data.applied);
	const graph = $derived(data.focusGraph?.graph ?? null);
	/** The graph reaches the tree as a window; the editor's dialogs read versions and names from it. */
	$effect(() => {
		editor.graph = graph;
		return () => (editor.graph = null);
	});

	const focusPersonId = $derived(data.focusGraph?.focusPersonId ?? null);
	/** The graph on screen is the whole tree (`scope=all`), which has no focus. */
	const isWholeTreeDrawn = $derived(data.focusGraph?.isWholeTree === true);
	const isWholeTreeTruncated = $derived(
		data.focusGraph?.isWholeTree === true && data.focusGraph.isTruncated
	);
	const focusPerson = $derived.by(() => {
		const person = graph?.people.find((p) => p.id === focusPersonId);
		return person ? { id: person.id, name: person.displayName } : null;
	});
	const expandedStubIds = $derived(
		graph
			? resolveStubTokens(
					applied.expandedStubs,
					graph.people.map((p) => p.id),
					graph.unions.map((u) => u.id)
				)
			: []
	);
	const graphForLayout = $derived(
		graph && view.types.length < ALL_PARENT_CHILD_TYPES.length
			? filterParentChildTypes(graph, view.types)
			: graph
	);
	const mode = $derived(view.layoutMode);
	/** Below this width the gesture hint sits over the chart instead of above it. */
	const PHONE_MAX_WIDTH_PX = 639;
	let isPhone = $state(false);
	$effect(() => {
		const query = matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
		isPhone = query.matches;
		const onChange = (event: MediaQueryListEvent) => (isPhone = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
	/** The overviews do not edit, so the gesture hints leave out the drag and menu actions there. */
	const canEditDrawn = $derived(VIEW_MODE_TRAITS[mode].canEdit);
	/**
	 * A new focus, depth or option waits on the server for its graph, and the 3D views then lay it
	 * out, so the chart on screen is stale for a moment. The address is ahead of the load while this
	 * is true; the badge says so instead of leaving a click looking ignored.
	 */
	const isLoading = $derived(pendingSearch !== null || navigating.to !== null);
	const focusOptions = $derived({
		ancestorDepth: applied.ancestorDepth,
		descendantDepth: applied.descendantDepth,
		shouldIncludeSiblings: applied.shouldIncludeSiblings,
		shouldIncludeStepFamilies: applied.shouldIncludeStepFamilies,
		// Flat draws the hourglass it always has; the wider groups are for the 3D views.
		...(mode === LAYOUT_MODES.FLAT
			? {}
			: {
					collateralDepth: applied.collateralDepth,
					shouldIncludePartnerOrigins: applied.shouldIncludePartnerOrigins
				}),
		expandedStubIds
	});
	// Only the chosen view is laid out, so switching mode costs one layout and no request.
	const layout = $derived(
		graphForLayout && mode === LAYOUT_MODES.FLAT
			? isWholeTreeDrawn
				? layoutWholeTree(graphForLayout)
				: layoutFocusView(graphForLayout, focusPersonId, focusOptions)
			: EMPTY_LAYOUT
	);
	/** The whole tree as a selection, worked out once for whichever WebGL view draws it. */
	const wholeSelection = $derived(
		graphForLayout && isWholeTreeDrawn && VIEW_MODE_TRAITS[mode].isWebGl
			? selectWholeTree(graphForLayout)
			: undefined
	);
	const ringsLayout = $derived(
		graphForLayout && mode === LAYOUT_MODES.RINGS
			? layoutRings(graphForLayout, focusPersonId, focusOptions, undefined, wholeSelection)
			: null
	);
	const poincareLayout = $derived(
		graphForLayout && mode === LAYOUT_MODES.POINCARE
			? layoutPoincare(graphForLayout, focusPersonId, focusOptions, undefined, wholeSelection)
			: null
	);
	const ribbonsLayout = $derived(
		graphForLayout && mode === LAYOUT_MODES.RIBBONS
			? layoutRibbons(
					graphForLayout,
					focusPersonId,
					focusOptions,
					undefined,
					undefined,
					wholeSelection
				)
			: null
	);
	const orreryLayout = $derived(
		graphForLayout && mode === LAYOUT_MODES.ORRERY
			? layoutOrrery(
					graphForLayout,
					focusPersonId,
					focusOptions,
					undefined,
					undefined,
					wholeSelection
				)
			: null
	);

	/**
	 * A view switch redraws the same graph, so what the person opened stays open. Flat ignores the
	 * wider groups, so going back to it also stops fetching them; the other views ask for the groups
	 * and depth their traits name, unless the person already set some.
	 */
	function arrivingAt(
		layoutMode: LayoutMode | undefined,
		change: Partial<TreeViewState>
	): Partial<TreeViewState> {
		if (layoutMode === undefined) return change;
		const traits = VIEW_MODE_TRAITS[layoutMode];
		const hasNoWiderGroups = view.collateralDepth === 0 && !view.shouldIncludePartnerOrigins;
		return {
			...change,
			expandedStubs: view.expandedStubs,
			...(layoutMode === LAYOUT_MODES.FLAT
				? {
						collateralDepth: DEFAULT_VIEW_STATE.collateralDepth,
						shouldIncludePartnerOrigins: DEFAULT_VIEW_STATE.shouldIncludePartnerOrigins
					}
				: {}),
			...(traits.shouldAskWiderGroups && hasNoWiderGroups
				? {
						collateralDepth: ARRIVAL_COLLATERAL_DEPTH,
						shouldIncludePartnerOrigins: true
					}
				: {}),
			...(traits.arrivalDepth !== null
				? {
						ancestorDepth: Math.max(view.ancestorDepth, traits.arrivalDepth),
						descendantDepth: Math.max(view.descendantDepth, traits.arrivalDepth)
					}
				: {})
		};
	}

	/** Re-frame the canvas when this changes. Opening a stub is deliberately not part of it. */
	const viewSignature = $derived(
		JSON.stringify([
			treeId,
			focusPersonId,
			applied.ancestorDepth,
			applied.descendantDepth,
			applied.shouldIncludeSiblings,
			applied.shouldIncludeStepFamilies,
			applied.collateralDepth,
			applied.shouldIncludePartnerOrigins,
			view.types,
			isWholeTreeDrawn,
			mode
		])
	);
	/** Bumped when the data reloads without the person having opened a stub, so an edit re-frames the canvas. */
	let dataVersion = $state(0);
	let lastOpenedStubs = '';
	$effect(() => {
		void data.focusGraph;
		const opened = applied.expandedStubs.join(',');
		untrack(() => {
			if (opened === lastOpenedStubs) dataVersion++;
			lastOpenedStubs = opened;
		});
	});
	const fitKey = $derived(`${viewSignature}|${dataVersion}`);

	// Write the resolved focus back into the address so it always describes the view, without a new
	// history entry and without asking the server again.
	$effect(() => {
		const resolved = focusPersonId;
		if (!resolved || page.url.searchParams.get('focus') === resolved) return;
		untrack(() => {
			const query = serializeViewState({
				...parseViewState(page.url.searchParams, startingMode),
				treeId: null,
				focusId: resolved
			}).toString();
			void goto(query ? `?${query}` : page.url.pathname, {
				shallow: true,
				replace: true,
				state: page.state,
				reset: false
			});
		});
	});

	/**
	 * Change the URL. `kind` decides the history entry: a new focus always gets one, so Back returns
	 * to the previous person, while depth and toggle changes and opened stubs share one entry for as
	 * long as the clicks keep coming, so Back undoes a burst of stepper clicks in one go.
	 */
	function navigate(
		change: Partial<TreeViewState>,
		options: { kind?: HistoryKind; isReplace?: boolean } = {}
	) {
		const currentFocus = view.focusId ?? focusPersonId;
		// Opened branches belong to the person they were opened around, so only a new focus closes them.
		const stubs = shouldResetStubs(change, currentFocus) ? { expandedStubs: [] } : {};
		const query = serializeViewState({
			...view,
			treeId: null,
			focusId: currentFocus,
			...stubs,
			...change
		}).toString();
		// The address only changes once the new graph has loaded, so a second click straight after the
		// first would read the old view. Show the new view at once and let the load catch up. Only one
		// navigation runs at a time: a second would cancel the first, and "replace the last entry"
		// would then overwrite the entry the first should have pushed.
		pendingSearch = query ? `?${query}` : '';
		if (isNavigating)
			queuedNavigation = { query, kind: options.kind, isReplace: options.isReplace };
		else commitNavigation(query, options.kind, options.isReplace);
	}

	let isNavigating = false;
	let queuedNavigation: { query: string; kind?: HistoryKind; isReplace?: boolean } | null = null;

	function commitNavigation(query: string, kind?: HistoryKind, isReplace?: boolean) {
		isNavigating = true;
		void goto(query ? `?${query}` : page.url.pathname, {
			replace: isReplace ?? (kind ? historyCoalescer.shouldReplace(kind) : false),
			// Leave scroll and the focused element alone; the tree view changes in place.
			reset: false
		}).finally(() => {
			isNavigating = false;
			const next = queuedNavigation;
			queuedNavigation = null;
			if (next) commitNavigation(next.query, next.kind, next.isReplace);
			else pendingSearch = null;
		});
	}

	/**
	 * Picking someone in the header finder is opening them: it refocuses and counts as a recent. In
	 * the whole tree that means leaving it, or the choice would change nothing on screen.
	 */
	function pickFocus(id: string) {
		navigate({ ...withOpenDrawer(id), isWholeTree: false }, { kind: HISTORY_KINDS.FOCUS });
		if (isPublicVisitor) return;
		void recordRecentApi(treeId, id)
			.then((updated) => marks.set(updated))
			.catch(() => {
				// Recents are a convenience; a failed record is not worth a message.
			});
	}

	// The header's finder refocuses the chart through this while the chart is on screen.
	$effect(() => {
		finder.pickFocus = pickFocus;
		return () => (finder.pickFocus = null);
	});

	function rememberFocus(id: string) {
		try {
			localStorage.setItem(rememberedFocusKey(treeId), id);
		} catch {
			// Remembering the focus is a convenience only.
		}
	}

	function setFocus(id: string) {
		rememberFocus(id);
		navigate(withOpenDrawer(id), { kind: HISTORY_KINDS.FOCUS });
	}

	/** A new focus takes an open drawer along, so the drawer keeps describing the person at the centre. */
	const withOpenDrawer = (id: string): Partial<TreeViewState> => ({
		focusId: id,
		...(view.personId ? { personId: id } : {})
	});

	// ---- The details drawer ----
	/** The drawer lives in the address, so a reload, Back and a shared link all find it as it was. */
	const selectedPersonId = $derived(view.personId);
	let drawerPage = $state<PersonPageDto | null>(null);
	let drawerError = $state<string | null>(null);
	let drawerRequest = 0;
	/** The card the drawer was opened from, so closing it can hand focus back. */
	let openerCardId: string | null = null;

	$effect(() => {
		const id = selectedPersonId;
		// Reload with the tree: an edit, an undo or a new focus all change what the drawer should say.
		void data.focusGraph;
		if (!id) {
			drawerPage = null;
			drawerError = null;
			return;
		}
		const request = ++drawerRequest;
		fetchPersonPage(treeId, id)
			.then((loaded) => {
				if (request !== drawerRequest) return;
				drawerPage = loaded;
				drawerError = null;
			})
			.catch((cause: Error) => {
				if (request !== drawerRequest) return;
				// The person is gone (deleted, undone away, or a stale link): there is nothing to keep
				// open. Replacing the entry keeps Back from returning to a drawer that cannot open.
				navigate({ personId: null, expandedStubs: view.expandedStubs }, { isReplace: true });
				drawerError = cause.message;
			});
	});

	/** Close the drawer; the tree stays as it is, and focus returns to the card that opened it if it is still drawn. */
	function clearSelection() {
		if (!selectedPersonId) return;
		navigate({ personId: null, expandedStubs: view.expandedStubs }, { kind: HISTORY_KINDS.ADJUST });
		const card = openerCardId;
		openerCardId = null;
		if (!card) return;
		void tick().then(() =>
			document.querySelector<SVGGElement>(`[data-person-id="${CSS.escape(card)}"]`)?.focus()
		);
	}

	function expandStub(id: string) {
		const token = compactStubId(id);
		if (token)
			navigate(
				{ expandedStubs: [...new Set([...view.expandedStubs, token])] },
				{ kind: HISTORY_KINDS.ADJUST }
			);
	}

	function collapseStub(id: string) {
		const token = compactStubId(id);
		navigate(
			{ expandedStubs: view.expandedStubs.filter((t) => t !== token) },
			{ kind: HISTORY_KINDS.ADJUST }
		);
	}

	/** What the 3D canvases' context menus can do; the flat canvas takes the same actions one by one. */
	const actions = $derived<TreeEditActions>({
		onOpenPerson: handleOpenPerson,
		...(canCreate ? { onAddRelationship: addRelationship } : {}),
		...(canChange
			? {
					onEditPerson: editPerson,
					onDeletePerson: editor.requestDeletePerson,
					onRecordDeath: recordDeath,
					onEndPartnership: endPartnership,
					onEditUnion: editor.editUnion,
					onEndUnion: editor.endUnion,
					onRemoveUnion: editor.removeUnion,
					onMergeUnion: editor.mergeUnion,
					mergeableUnionIds: editor.mergeableIds
				}
			: {})
	});

	function editPerson(id: string) {
		void editor.openEditPerson(id);
	}
	function addRelationship(anchor: PersonRef) {
		editor.openRelationship({ id: anchor.id, givenName: anchor.displayName, surname: null });
	}
	function recordDeath(id: string) {
		editor.openRelationship(editor.anchorFor(id), { kind: 'record_death' });
	}
	function endPartnership(id: string) {
		editor.openRelationship(editor.anchorFor(id), { kind: 'end_union' });
	}

	/** Save a default view, showing it at once and saying so when the save fails. */
	async function setDefaultView(scope: 'member' | 'tree', mode: LayoutMode | null) {
		const before = savedFor;
		savedViews = { ...savedFor, [scope]: mode };
		// The public visitor has no saved views, only the one on screen.
		if (isPublicVisitor) return;
		try {
			if (scope === 'member') await saveViewMode(treeId, mode);
			else await saveDefaultViewMode(treeId, mode);
		} catch (cause) {
			savedViews = before;
			toasts.push(cause instanceof Error ? cause.message : 'Could not save the default view', {
				tone: 'error',
				durationMs: 10_000
			});
		}
	}

	/**
	 * A click on a card re-centres the chart, which on a large tree can read as nothing happening, or
	 * as the tree jumping. A short cue names who it is now centred on once the new view has drawn.
	 */
	const RECENTRE_CUE_MS = 1800;
	let recentreTargetId = $state<string | null>(null);
	let recentreCue = $state<string | null>(null);
	// Not the effect's cleanup: clearing the target re-runs the effect, which would cancel it at once.
	let recentreTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!recentreTargetId || isLoading || !focusPerson || focusPerson.id !== recentreTargetId)
			return;
		recentreCue = focusPerson.name;
		recentreTargetId = null;
		clearTimeout(recentreTimer);
		recentreTimer = setTimeout(() => (recentreCue = null), RECENTRE_CUE_MS);
	});
	onDestroy(() => clearTimeout(recentreTimer));

	/** The Whole tree button: everyone the viewer may see, or back to the focus view. */
	function toggleWholeTree() {
		navigate({ isWholeTree: !view.isWholeTree }, { kind: HISTORY_KINDS.ADJUST });
	}

	/** Canvas single-click: refocus the chart only. An already-open drawer follows the focus. */
	function handleFocusPerson(id: string) {
		// The flat whole tree lights no line, so a card there is a way in: focus them and leave it.
		if (isWholeTreeDrawn && mode === LAYOUT_MODES.FLAT) {
			rememberFocus(id);
			navigate({ ...withOpenDrawer(id), isWholeTree: false }, { kind: HISTORY_KINDS.FOCUS });
			return;
		}
		// The first click of a double-click lands here too; re-centring on the person already at the
		// centre would only flash the cue and, before stubs were kept, wipe the branches just opened.
		if (id === (view.focusId ?? focusPersonId)) return;
		recentreCue = null;
		recentreTargetId = id;
		setFocus(id);
	}

	/** Canvas double-click or long-press: focus the person and show their details. */
	function handleOpenPerson(id: string) {
		if (!selectedPersonId) openerCardId = id;
		rememberFocus(id);
		navigate({ focusId: id, personId: id }, { kind: HISTORY_KINDS.FOCUS });
	}

	/** From the drawer: clicking the selected person again closes it; the tree stays focused on them. */
	function handleSelectPerson(id: string) {
		if (selectedPersonId === id) {
			clearSelection();
			return;
		}
		rememberFocus(id);
		navigate({ focusId: id, personId: id }, { kind: HISTORY_KINDS.FOCUS });
	}
</script>

<div class="flex min-h-[600px] flex-1 flex-col">
	{#if graph}
		<div class="mb-2 sm:mb-3">
			<TreeToolbar
				{view}
				{palette}
				defaults={{
					member: savedMemberMode,
					tree: savedTreeMode,
					canSetTree: role === 'owner'
				}}
				onSetMemberDefault={(mode) => void setDefaultView('member', mode)}
				onSetTreeDefault={(mode) => void setDefaultView('tree', mode)}
				{focusPerson}
				onchangeFocus={() => finder.focusInput?.()}
				onshowDetails={handleOpenPerson}
				onopenProfile={(id) =>
					void goto(`${treePath(data.summary.tree)}/people/${encodeURIComponent(id)}`)}
				onChange={(change) =>
					navigate(
						// Switching view redraws the same graph, so what the person opened stays open. Flat
						// ignores the wider groups, so going back to it also stops fetching them.
						'layoutMode' in change ? arrivingAt(change.layoutMode, change) : change,
						{ kind: HISTORY_KINDS.ADJUST }
					)}
			/>
		</div>
		{#if !isPhone}<TreeGestureHint
				canRelate={canCreate && canEditDrawn}
				hasMenuActions={(canCreate || canChange) && canEditDrawn}
			/>{/if}
		<!-- touch-none covers the overlays too: a pinch that starts on the zoom buttons or legend would
		     otherwise reach the browser and zoom the whole page instead of the chart. -->
		<div class="relative flex flex-1 touch-none flex-col" aria-busy={isLoading}>
			<!-- Before the canvases so the legend, drawn later, stays above it. -->
			{#if isPhone}<TreeGestureHint
					canRelate={canCreate && canEditDrawn}
					hasMenuActions={(canCreate || canChange) && canEditDrawn}
					isOverlay
				/>{/if}
			{#if ringsLayout}
				<RingsCanvas
					layout={ringsLayout}
					{palette}
					isMotionReduced={data.isMotionReduced}
					{fitKey}
					{selectedPersonId}
					isWholeTree={isWholeTreeDrawn}
					isTruncated={isWholeTreeTruncated}
					onToggleWholeTree={toggleWholeTree}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
				/>
			{:else if poincareLayout}
				<PoincareCanvas
					layout={poincareLayout}
					{palette}
					isMotionReduced={data.isMotionReduced}
					{fitKey}
					{selectedPersonId}
					isWholeTree={isWholeTreeDrawn}
					isTruncated={isWholeTreeTruncated}
					onToggleWholeTree={toggleWholeTree}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
				/>
			{:else if ribbonsLayout}
				<RibbonsCanvas
					layout={ribbonsLayout}
					{palette}
					isMotionReduced={data.isMotionReduced}
					{fitKey}
					{selectedPersonId}
					isWholeTree={isWholeTreeDrawn}
					isTruncated={isWholeTreeTruncated}
					onToggleWholeTree={toggleWholeTree}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
				/>
			{:else if orreryLayout}
				<OrreryCanvas
					layout={orreryLayout}
					{palette}
					isMotionReduced={data.isMotionReduced}
					{fitKey}
					{selectedPersonId}
					isWholeTree={isWholeTreeDrawn}
					isTruncated={isWholeTreeTruncated}
					onToggleWholeTree={toggleWholeTree}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
				/>
			{:else}
				<TreeCanvas
					{layout}
					{palette}
					{fitKey}
					isWholeTree={isWholeTreeDrawn}
					isTruncated={isWholeTreeTruncated}
					onToggleWholeTree={toggleWholeTree}
					{selectedPersonId}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
					onEditPerson={actions.onEditPerson}
					onDeletePerson={actions.onDeletePerson}
					onAddRelationship={actions.onAddRelationship}
					onRemoveLink={canChange ? editor.removeLink : undefined}
					onRecordDeath={actions.onRecordDeath}
					onEndPartnership={actions.onEndPartnership}
					onEditUnion={actions.onEditUnion}
					onEndUnion={actions.onEndUnion}
					onRemoveAssertion={canChange ? editor.removeAssertion : undefined}
					onChangeLinkType={canChange ? editor.changeLinkType : undefined}
					onRemoveUnion={actions.onRemoveUnion}
					onMergeUnion={actions.onMergeUnion}
					mergeableUnionIds={editor.mergeableIds}
					partnershipLabels={editor.unionLabels}
					onDragRelate={canCreate ? editor.dragRelate : undefined}
					onExpandStub={expandStub}
					onCollapseStub={collapseStub}
				/>
			{/if}
			{#if recentreCue && !isLoading}
				<!-- Hidden from screen readers: the canvas already announces the new focus. -->
				<div
					class="cue pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center"
					aria-hidden="true"
				>
					<span
						class="max-w-[calc(100%-2rem)] truncate rounded-full border border-stone-300 bg-[#fdfbf7] px-3 py-1 text-sm text-stone-700 shadow-md"
					>
						Centred on <span class="font-semibold text-stone-900">{recentreCue}</span>
					</span>
				</div>
			{/if}
			{#if isLoading}
				<!-- Held back a beat by the animation delay, so a quick load never flashes it. -->
				<div
					class="loading pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center"
					role="status"
				>
					<span
						class="flex items-center gap-2 rounded-full border border-stone-300 bg-[#fdfbf7] px-3 py-1 text-sm font-medium text-stone-700 shadow-md"
					>
						<Loader2 class="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
						Loading…
					</span>
				</div>
			{/if}
		</div>
	{:else}
		<EmptyTreePrompt
			{canCreate}
			canImport={canImportGedcom(role)}
			onAddPerson={editor.openAddPerson}
			onImport={importGedcom}
			onReject={(message) => toasts.push(message, { tone: 'error', durationMs: 10_000 })}
		/>
	{/if}
</div>

{#if selectedPersonId}
	<PersonDrawer
		page={drawerPage}
		{treeId}
		treeSlug={data.summary.tree.slug}
		{role}
		error={drawerError}
		onClose={clearSelection}
		onSelectPerson={handleSelectPerson}
		{editor}
		{toasts}
		{marks}
	/>
{/if}

<style>
	.loading {
		animation: loading-in 150ms ease-out 200ms backwards;
	}
	@keyframes loading-in {
		from {
			opacity: 0;
		}
	}
	.cue {
		animation: cue 1800ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	@keyframes cue {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		12%,
		80% {
			opacity: 1;
			transform: none;
		}
		to {
			opacity: 0;
		}
	}
	@keyframes cue-fade {
		from,
		to {
			opacity: 0;
		}
		12%,
		80% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cue {
			animation-name: cue-fade;
		}
	}
	/* The viewer's own "Reduce animation" (ADR-054), set on the root layout; same fade, no slide. */
	:global([data-reduce-motion]) .cue {
		animation-name: cue-fade;
	}
</style>
